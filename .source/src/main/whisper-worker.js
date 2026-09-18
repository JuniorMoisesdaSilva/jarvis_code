'use strict'

// Whisper, on its own thread.
//
// Transcription takes seconds of solid CPU. On the main thread that would freeze
// every window in the app, including the Panel that is supposed to be showing
// the Preview as the user speaks.

const { parentPort, workerData } = require('node:worker_threads')

const SECOND = 16000
// Whisper itself only ever looks at 30 seconds at a time. Anything longer has to
// be handed over in overlapping windows, or the tail is silently dropped.
const WINDOW_LIMIT = 28

let transcriber = null
let loading = null

async function load() {
  if (transcriber) return transcriber
  if (loading) return loading

  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = workerData.cacheDir
    env.allowLocalModels = true

    transcriber = await pipeline('automatic-speech-recognition', workerData.model, {
      dtype: workerData.quantization ?? 'q8',
      progress_callback: (report) => {
        if (report.status === 'progress' && typeof report.progress === 'number') {
          parentPort.postMessage({
            type: 'downloading',
            file: report.file,
            progress: report.progress,
            total: report.total ?? null,
          })
        }
      },
    })
    return transcriber
  })()

  return loading
}

async function transcribe({ id, audio, language }) {
  const engine = await load()
  const seconds = audio.length / SECOND

  const options = { language, task: 'transcribe' }
  if (seconds > WINDOW_LIMIT) {
    options.chunk_length_s = 30
    options.stride_length_s = 5
  }

  const result = await engine(audio, options)
  return typeof result?.text === 'string' ? result.text.trim() : ''
}

parentPort.on('message', async (message) => {
  try {
    if (message.type === 'load') {
      await load()
      parentPort.postMessage({ type: 'ready' })
      return
    }

    if (message.type === 'transcribe') {
      const text = await transcribe({
        id: message.id,
        audio: new Float32Array(message.audio),
        language: message.language,
      })
      parentPort.postMessage({ type: 'result', id: message.id, kind: message.kind, text })
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      id: message.id ?? null,
      kind: message.kind ?? null,
      message: error?.message ?? String(error),
    })
  }
})
