'use strict'

// Capturing the microphone. This page is never shown; it exists because
// getUserMedia lives in a window, not in the main process.

const SAMPLE_RATE = 16000

let context = null
let stream = null
let node = null

async function start() {
  if (context) return

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (error) {
    // On Windows there is no per-app microphone grant to ask for: desktop apps
    // share one system switch, so a refusal here means that switch is off.
    window.jarvis.denied(error?.name ?? 'unknown')
    return
  }

  // Asking for the rate Whisper wants lets Chromium do the resampling, which it
  // does better than a hand-written decimator would.
  context = new AudioContext({ sampleRate: SAMPLE_RATE })
  await context.audioWorklet.addModule('microphone-worklet.js')

  node = new AudioWorkletNode(context, 'collector')
  node.port.onmessage = (event) => window.jarvis.audio(event.data.buffer)

  context.createMediaStreamSource(stream).connect(node)
  window.jarvis.started(context.sampleRate)
}

async function stop() {
  if (node) {
    node.port.onmessage = null
    node.disconnect()
    node = null
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  if (context) {
    await context.close()
    context = null
  }
}

window.jarvis.onStart(() => {
  start()
})

window.jarvis.onStop(() => {
  stop()
})

// Last: a start message sent before this line runs would be dropped, and the
// first dictation of the session would record nothing at all.
window.jarvis.ready()
