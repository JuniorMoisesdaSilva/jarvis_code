'use strict'

// The voices Jarvis brings with it, and the process that speaks them.
//
// The weights sit beside the app rather than in a folder the user has to fill:
// a machine that has never run Jarvis reads aloud the first time it is opened,
// offline, with no Windows voice installed and nothing to download. Which
// voices those are is `src/core/natural-voices.js`; this file is where they are
// found on disk and how the process that uses them is kept alive.
//
// Synthesis happens in helpers/voice-host.js, in a process of its own — the
// reason is written down there. See
// Docs/decisions/0010-a-neural-voice-of-our-own.md.

const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { app } = require('electron')
const natural = require('../core/natural-voices')
const { onDisk } = require('./unpacked')

const HOST = onDisk(path.join(__dirname, 'helpers', 'voice-host.js'))

let host = null
let listeners = {}
let restarts = 0
let catalogue = null
let closing = false

const MAX_RESTARTS = 3

function emit(name, payload) {
  const handler = listeners[name]
  if (handler) handler(payload)
}

/**
 * Where the models really are. Packaged, they are outside the archive: the
 * engine opens them with its own file calls and knows nothing about Electron's
 * archive format. In development this is the repository root and changes
 * nothing.
 */
/**
 * The compartment the voices are read from. One copy, at the folder's root, so
 * Windows and macOS speak in the same voices from the same files rather than
 * carrying one set each. See docs/decisions/0019.
 */
function root() {
  return onDisk(require('./data-location').where().resourcesDir)
}

/**
 * The voices whose files are actually there, worked out once. A build packaged
 * without running `npm run fetch-assets` has the catalogue and none of the
 * weights, and offering a voice that cannot speak is worse than offering none:
 * the app falls back to Windows' voices, which is what it did before.
 */
function available() {
  if (catalogue) return catalogue

  const pronunciation = natural.pronunciationFolder(root())
  if (!fs.existsSync(pronunciation)) {
    // Without the pronunciation rules no voice can say anything, whatever
    // weights are on disk.
    catalogue = []
    return catalogue
  }

  catalogue = natural.VOICES.filter((voice) => {
    const folder = natural.folderFor(root(), voice)
    return (
      fs.existsSync(path.join(folder, natural.WEIGHTS)) &&
      fs.existsSync(path.join(folder, natural.TOKENS))
    )
  })
  return catalogue
}

/** The voice list, in the shape the Settings sheet and the core expect. */
function installedVoices() {
  return available().map((voice) => ({
    name: natural.nameOf(voice),
    label: voice.label,
    culture: voice.culture,
    gender: voice.gender,
    // Said rather than inferred: the Settings sheet groups the two sets apart,
    // and working that out from a field that happens to be absent on the other
    // side would break the day the other side gains one.
    natural: true,
  }))
}

function handleMessage(message) {
  switch (message.event) {
    case 'ready':
      restarts = 0
      break

    case 'audio':
      emit('onAudio', { id: message.id, path: message.path })
      break

    case 'error':
      emit('onError', message.message)
      break

    default:
      break
  }
}

function start() {
  if (host || available().length === 0) return
  closing = false

  host = fork(HOST, [], {
    // Electron's binary is the only interpreter a packaged app has. Told to run
    // as Node, it is one.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })

  let problems = ''
  host.stderr?.setEncoding('utf8')
  host.stderr?.on('data', (chunk) => {
    problems += chunk
  })

  host.on('message', handleMessage)

  host.on('exit', () => {
    host = null
    // A host we asked to leave is not a host that died.
    if (closing) return
    // The voice dying mid-session should not take read-aloud away for good, but
    // a host that cannot start must not be restarted forever either.
    if (restarts < MAX_RESTARTS) {
      restarts += 1
      setTimeout(start, 500)
    } else {
      emit('onError', problems.trim() || 'The voice stopped and would not restart.')
    }
  })
}

/** Where a voice's three files are, in the shape the host is told them in. */
function locate(voice) {
  const folder = natural.folderFor(root(), voice)
  return {
    id: voice.id,
    weights: path.join(folder, natural.WEIGHTS),
    tokens: path.join(folder, natural.TOKENS),
    pronunciation: natural.pronunciationFolder(root()),
  }
}

/** The voice a name refers to, if it is one of ours and really here. */
function ours(name) {
  const chosen = natural.find(name)
  if (!chosen) return null
  return available().some((each) => each.id === chosen.id) ? chosen : null
}

function tell(message) {
  start()
  if (!host) return false
  try {
    host.send(message)
    return true
  } catch {
    return false
  }
}

/**
 * Reads, if the name is one of ours. Answers whether it took the work, so the
 * caller can hand a name it does not recognise to Windows instead.
 */
function speak({ id, text, voice, rate }) {
  const chosen = ours(voice)
  if (!chosen) return false
  return tell({
    command: 'speak',
    id,
    text,
    speed: natural.speedFor(rate),
    voice: locate(chosen),
  })
}

/**
 * Loads a voice ahead of being asked to read with it. Two seconds of weights
 * come off the disk the first time, and the first answer of a session should not
 * be the one that waits for them.
 */
function warmUp(voice) {
  const chosen = ours(voice)
  if (!chosen) return false
  return tell({ command: 'warm', voice: locate(chosen) })
}

function on(handlers) {
  listeners = { ...listeners, ...handlers }
}

function shutdown() {
  closing = true
  if (!host) return
  const leaving = host
  host = null
  try {
    leaving.send({ command: 'quit' })
  } catch {
    // Already gone.
  }
  setTimeout(() => {
    if (!leaving.killed) leaving.kill()
  }, 300)
}

module.exports = { start, speak, warmUp, installedVoices, on, shutdown }
