// Collects raw microphone frames into batches worth sending.
//
// The audio thread hands over 128 frames at a time. Posting each one separately
// would mean a thousand messages a second for no benefit.

const BATCH = 4096

class Collector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(BATCH)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.filled] = channel[i]
      this.filled += 1
      if (this.filled === BATCH) {
        this.port.postMessage(this.buffer.slice(0))
        this.filled = 0
      }
    }

    return true
  }
}

registerProcessor('collector', Collector)
