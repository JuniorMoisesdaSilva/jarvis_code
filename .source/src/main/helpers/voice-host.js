'use strict'

// Jarvis' own voice: a long-lived host around the neural voices the app ships.
//
// It lives in a process of its own for a reason that is not obvious. The
// synthesis engine brings its own copy of ONNX Runtime, and so does Whisper;
// Windows answers a request for a DLL that is already loaded under the same
// bare file name with the copy it has, so reading and listening would share one
// runtime, and which version won would depend on which the user did first. A
// separate process makes the question disappear.
//
// It synthesises to a file and hands back the path rather than playing
// anything, exactly as the Windows host does — the Panel plays both, which is
// what lets it draw a progress bar and stop instantly. See
// Docs/decisions/0010-a-neural-voice-of-our-own.md.
//
// It knows nothing about which voices exist or where they live: every `speak`
// carries the three paths it needs. That keeps this file to synthesis alone, and
// it means the host requires nothing from the app — which matters, because a
// packaged app runs it from outside the archive, where the rest of the app is
// not resolvable.
//
// Commands arrive as messages on the Node IPC channel and events leave the same
// way. The Windows host uses JSON over stdio because PowerShell has nothing
// better; this one does, so it uses it.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const FOLDER = path.join(os.tmpdir(), 'jarvis-voice')

/**
 * Loaded engines by voice id, oldest first. Each holds its weights in memory —
 * about 60 MB — so they are not all kept. Two covers the case that actually
 * happens: an answer in Portuguese followed by one in English.
 */
const LIMIT = 2
const loaded = new Map()

let sherpa = null

function emit(payload) {
  if (process.send) process.send(payload)
}

function engineFor({ id, weights, tokens, pronunciation }) {
  const already = loaded.get(id)
  if (already) return already

  sherpa = sherpa ?? require('sherpa-onnx-node')
  const engine = new sherpa.OfflineTts({
    model: {
      vits: { model: weights, tokens, dataDir: pronunciation },
      // Two threads is where the gain flattens for a model this size, and it
      // leaves the machine to the agent the user is actually waiting on.
      numThreads: 2,
      provider: 'cpu',
      debug: false,
    },
    // The engine would otherwise hold every sentence of a long answer at once;
    // one at a time keeps the peak memory flat however long the answer is.
    maxNumSentences: 1,
  })

  loaded.set(id, engine)
  while (loaded.size > LIMIT) loaded.delete(loaded.keys().next().value)
  return engine
}

function speak(message) {
  const id = String(message.id)
  const audio = engineFor(message.voice).generate({
    text: String(message.text ?? ''),
    sid: 0,
    // Already a multiplier when it gets here. Translating the Settings sheet's
    // -10 to 10 is done where it can be tested, which is not in here.
    speed: Number(message.speed) || 1,
    // The engine hands back its samples as an external buffer by default —
    // memory it owns, wrapped rather than copied. V8 refuses those inside
    // Electron's sandbox, and this process is Electron's binary running as
    // Node, so it is inside it: without this the first reading fails with
    // "External buffers are not allowed" and nothing about the message says
    // where it came from. One copy of a few hundred kilobytes is the price.
    enableExternalBuffer: false,
  })

  // A file per reading, named after it: the previous reading may still be
  // playing in the Panel, and two of them must never share a handle.
  const file = path.join(FOLDER, `${id}.wav`)
  sherpa.writeWave(file, { samples: audio.samples, sampleRate: audio.sampleRate })
  emit({ event: 'audio', id, path: file })
}

fs.mkdirSync(FOLDER, { recursive: true })

process.on('message', (message) => {
  try {
    switch (message?.command) {
      case 'speak':
        speak(message)
        break
      // Reading the weights off the disk takes about two seconds, and the
      // first answer of a session should not be the one that pays for it.
      case 'warm':
        engineFor(message.voice)
        break
      case 'quit':
        process.exit(0)
        break
      default:
        break
    }
  } catch (error) {
    emit({ event: 'error', id: message?.id ?? null, message: error?.message ?? String(error) })
  }
})

emit({ event: 'ready' })
