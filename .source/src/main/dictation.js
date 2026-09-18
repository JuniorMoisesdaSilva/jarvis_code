'use strict'

// Dictation: the microphone, and Whisper.
//
// Whisper transcribes in blocks rather than word by word, so a Dictation has two
// stages. While the user speaks, the last few seconds are transcribed over and
// over to produce a Preview — provisional text that may correct itself. When
// they stop, the whole recording is transcribed once more, and only that result
// is the Dictation. See Docs/decisions/0003-whisper-locally-with-a-preview-pass.md.

const path = require('node:path')
const fs = require('node:fs')
const { Worker } = require('node:worker_threads')
const { app, BrowserWindow } = require('electron')
const models = require('./models')
const { isSilence } = require('./loudness')
const { onDisk } = require('./unpacked')

const SECOND = 16000
/** How much of the tail the Preview looks at. Bounded, so it stays quick. */
const PREVIEW_WINDOW = 8 * SECOND
const PREVIEW_EVERY = 2500
/** Long enough to be speech rather than a click on the button. */
const MINIMUM_AUDIO = Math.round(0.35 * SECOND)
let microphone = null
let worker = null
let workerModel = null

let recording = false
let chunks = []
let recorded = 0
let previewTimer = null
let previewRunning = false
let nextRequest = 1
let pendingFinal = null
let listeners = {}
let language = 'pt'
let microphoneReady = false
let captureWanted = false

function emit(name, payload) {
  const handler = listeners[name]
  if (handler) handler(payload)
}

// Where a downloaded model is kept: the hidden data compartment inside the
// folder, so a model fetched on one machine is there on the next; when Jarvis is
// running from outside its folder it falls back to the system's user-data
// folder. The shipped model is read where it lies (see shippedDirectory) and is
// the common case, so this location is only reached when the user chose a model
// that did not ship.
function cacheDirectory() {
  return require('./data-location').where().modelsDir
}

/**
 * The copy that travels with the app. One model ships — the recommended one —
 * so that a machine which has never run Jarvis can hear the first thing said to
 * it, offline, with nothing to download. See
 * Docs/decisions/0010-a-neural-voice-of-our-own.md.
 */
function shippedDirectory() {
  return onDisk(require('./data-location').where().listeningModelDir)
}

/**
 * Whether a model is really in this folder — both weight files, under the names
 * the pipeline opens them by.
 *
 * A folder with something in it used to be enough, and an interrupted download
 * leaves plenty: the description files, and a decoder that never finished. The
 * app read that as the model being here, said nothing about a download, and
 * fetched the missing gigabyte again in silence every time the user pressed to
 * talk. Found on 6 September 2026, with 1.3 GB of abandoned halves on disk.
 */
function holdsModel(folder, name) {
  const home = path.join(folder, ...models.model(name).id.split('/'))
  return models.weights(name).every((file) => fs.existsSync(path.join(home, ...file.split('/'))))
}

/**
 * Where to look for a model, and where a missing one is put. The shipped copy is
 * read where it lies rather than being copied into place: it is complete, so
 * nothing is ever written there, and an app folder the user cannot write to is
 * not a thing to find out about at the first Dictation.
 */
function cacheDirectoryFor(name) {
  return holdsModel(shippedDirectory(), name) ? shippedDirectory() : cacheDirectory()
}

/** Whether the chosen model is already here, shipped or downloaded. */
function isModelPresent(name) {
  return holdsModel(shippedDirectory(), name) || holdsModel(cacheDirectory(), name)
}

function ensureWorker(name) {
  if (worker && workerModel === name) return worker
  if (worker) {
    worker.terminate()
    worker = null
  }

  workerModel = name
  // A worker thread starts from a path on disk, not from inside the archive.
  worker = new Worker(onDisk(path.join(__dirname, 'whisper-worker.js')), {
    workerData: {
      model: models.model(name).id,
      cacheDir: cacheDirectoryFor(name),
      quantization: models.quantization(name),
    },
  })

  worker.on('message', (message) => {
    if (message.type === 'downloading') {
      emit('onDownloading', { progress: message.progress, file: message.file })
      return
    }
    if (message.type === 'ready') {
      emit('onReady')
      return
    }
    if (message.type === 'result') {
      if (message.kind === 'preview') {
        previewRunning = false
        // A Preview that finished after the user stopped speaking is stale.
        if (recording && message.text !== '') emit('onPreview', message.text)
      } else if (message.id === pendingFinal) {
        pendingFinal = null
        emit('onFinal', message.text)
      }
      // A final for a Dictation that was cancelled is dropped here. Without
      // this, the sentence you threw away arrives during the next one and gets
      // typed into the terminal.
      return
    }
    if (message.type === 'error') {
      if (message.kind === 'preview') {
        previewRunning = false
        // A failed Preview is not worth telling anybody about: the final pass is
        // what matters, and it has its own report.
        return
      }
      if (message.id !== pendingFinal) return
      pendingFinal = null
      emit('onFailed', message.message)
    }
  })

  worker.on('error', (error) => {
    previewRunning = false
    pendingFinal = null
    emit('onFailed', error?.message ?? String(error))
  })

  return worker
}

/**
 * Asks the capture window to start. On the very first Dictation that window has
 * only just been created and its scripts have not run, so the request waits for
 * it to say it is listening — otherwise the first Dictation of a session records
 * nothing at all and comes back empty.
 */
function askToCapture() {
  if (microphoneReady) {
    microphoneWindow().webContents.send('microphone:start')
    return
  }
  captureWanted = true
  microphoneWindow()
}

/** Called when the capture window reports that its scripts are running. */
function markReady() {
  microphoneReady = true
  if (!captureWanted) return
  captureWanted = false
  // The user may have cancelled while we were waiting for the window.
  if (recording) microphoneWindow().webContents.send('microphone:start')
}

function microphoneWindow() {
  if (microphone && !microphone.isDestroyed()) return microphone

  microphone = new BrowserWindow({
    show: false,
    // A window with no size still runs its scripts, and this one is never seen.
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'microphone.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  microphone.loadFile(path.join(__dirname, '..', 'renderer', 'microphone.html'))
  microphone.on('closed', () => {
    microphoneReady = false
  })
  return microphone
}

/** Loads the model ahead of time, so the first Dictation is not the slow one. */
function warmUp(modelName) {
  if (!isModelPresent(modelName)) return false
  ensureWorker(modelName).postMessage({ type: 'load' })
  return true
}

function audioSoFar(limit) {
  const total = limit ? Math.min(recorded, limit) : recorded
  const out = new Float32Array(total)
  let at = total
  for (let i = chunks.length - 1; i >= 0 && at > 0; i -= 1) {
    const chunk = chunks[i]
    const take = Math.min(chunk.length, at)
    out.set(chunk.subarray(chunk.length - take), at - take)
    at -= take
  }
  return out
}

function requestTranscription(kind, audio) {
  const id = nextRequest
  nextRequest += 1
  const copy = audio.slice(0)
  ensureWorker(workerModel).postMessage(
    { type: 'transcribe', id, kind, audio: copy.buffer, language },
    [copy.buffer],
  )
  return id
}

function schedulePreview() {
  clearInterval(previewTimer)
  previewTimer = setInterval(() => {
    if (!recording || previewRunning) return
    if (recorded < MINIMUM_AUDIO) return
    const tail = audioSoFar(PREVIEW_WINDOW)
    if (isSilence(tail)) return
    previewRunning = true
    requestTranscription('preview', tail)
  }, PREVIEW_EVERY)
}

/** Begins listening. The Preview starts arriving a couple of seconds later. */
function start({ modelName, languageCode }) {
  language = languageCode
  chunks = []
  recorded = 0
  recording = true
  ensureWorker(modelName)
  askToCapture()
  schedulePreview()
}

function stopCapture() {
  recording = false
  captureWanted = false
  clearInterval(previewTimer)
  previewTimer = null
  if (microphone && !microphone.isDestroyed()) {
    microphone.webContents.send('microphone:stop')
  }
}

/**
 * Ends listening and asks for the text. Silence produces an empty result rather
 * than nothing at all, so the core always hears back.
 */
function finish() {
  stopCapture()
  const audio = audioSoFar()
  chunks = []
  if (audio.length < MINIMUM_AUDIO || isSilence(audio)) {
    emit('onFinal', '')
    return
  }
  pendingFinal = requestTranscription('final', audio)
}

/** Throws away what was said. Nothing is transcribed and nothing is delivered. */
function cancel() {
  stopCapture()
  chunks = []
  recorded = 0
  pendingFinal = null
}

/** Called with each batch of audio from the capture window. */
function collect(buffer) {
  if (!recording) return
  const samples = new Float32Array(buffer)
  chunks.push(samples)
  recorded += samples.length
}

function on(handlers) {
  listeners = { ...listeners, ...handlers }
}

function isRecording() {
  return recording
}

function isWaitingForFinal() {
  return pendingFinal !== null
}

function shutdown() {
  cancel()
  if (worker) {
    worker.terminate()
    worker = null
  }
  if (microphone && !microphone.isDestroyed()) microphone.destroy()
  microphone = null
  microphoneReady = false
}

module.exports = {
  markReady,
  start,
  finish,
  cancel,
  collect,
  warmUp,
  isModelPresent,
  isRecording,
  isWaitingForFinal,
  cacheDirectory,
  on,
  shutdown,
}
