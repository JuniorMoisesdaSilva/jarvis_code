import { describe, expect, it } from 'vitest'
import {
  loudnessOf,
  voicedShare,
  isSilence,
  SILENCE_THRESHOLD,
} from '../src/main/loudness.js'

// Handed silence, Whisper does not return nothing — it invents a short word, and
// that word would be typed into the terminal as though it had been dictated.
// This is the guard, and it was written after watching that happen.

function tone({ amplitude, seconds = 1, frequency = 200 }) {
  const samples = new Float32Array(Math.round(seconds * 16000))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / 16000)
  }
  return samples
}

/** A sentence with the pauses a real one has. */
function speechWithPauses() {
  const samples = new Float32Array(16000 * 4)
  const words = tone({ amplitude: 0.09, seconds: 0.5 })
  for (const start of [0, 16000, 32000, 48000]) samples.set(words, start)
  return samples
}

describe('measuring a recording', () => {
  it('measures a tone at about its root-mean-square', () => {
    // A sine wave's RMS is its amplitude over the square root of two.
    expect(loudnessOf(tone({ amplitude: 1 }))).toBeCloseTo(1 / Math.SQRT2, 2)
  })

  it('survives being handed nothing at all', () => {
    expect(loudnessOf(null)).toBe(0)
    expect(loudnessOf(undefined)).toBe(0)
    expect(voicedShare(null)).toBe(0)
  })

  it('reports no voice in a buffer of zeroes', () => {
    expect(voicedShare(new Float32Array(16000))).toBe(0)
  })

  it('reports the whole of a continuous tone as voice', () => {
    expect(voicedShare(tone({ amplitude: 0.08 }))).toBe(1)
  })
})

describe('telling a sentence from a quiet room', () => {
  it('calls a buffer of zeroes silence', () => {
    expect(isSilence(new Float32Array(16000))).toBe(true)
  })

  it('calls an empty buffer silence rather than dividing by zero', () => {
    expect(isSilence(new Float32Array(0))).toBe(true)
  })

  it('calls a room hum silence', () => {
    expect(isSilence(tone({ amplitude: 0.0008 }))).toBe(true)
  })

  it('does not call speech silence', () => {
    expect(isSilence(tone({ amplitude: 0.08 }))).toBe(false)
  })

  it('does not call a quiet speaker silence either', () => {
    // Somebody speaking softly from across the room must still be heard.
    expect(isSilence(tone({ amplitude: 0.02 }))).toBe(false)
  })

  it('does not call a sentence with pauses in it silence', () => {
    expect(isSilence(speechWithPauses())).toBe(false)
  })

  it('is not fooled by one loud click in an otherwise silent recording', () => {
    // A door, a keyboard, a chair. Loud on average, and nobody spoke.
    const samples = new Float32Array(16000)
    for (let i = 0; i < 40; i += 1) samples[i] = 0.9
    expect(isSilence(samples)).toBe(true)
  })

  it('is not fooled by a few scattered clicks either', () => {
    const samples = new Float32Array(16000 * 10)
    for (const at of [0, 40000, 90000, 150000]) samples[at] = 0.95
    expect(isSilence(samples)).toBe(true)
  })

  it('hears half a second of speech in ten seconds of quiet', () => {
    // The shortest thing worth dictating — "sim", "não", "para" — must survive.
    const samples = new Float32Array(16000 * 10)
    samples.set(tone({ amplitude: 0.09, seconds: 0.6 }), 16000)
    expect(isSilence(samples)).toBe(false)
  })

  it('lets the threshold be raised, for a noisier room', () => {
    const quiet = tone({ amplitude: 0.02 })
    expect(isSilence(quiet)).toBe(false)
    expect(isSilence(quiet, 0.5)).toBe(true)
  })

  it('sits well clear of both an idle microphone and speech', () => {
    expect(SILENCE_THRESHOLD).toBeGreaterThan(loudnessOf(tone({ amplitude: 0.001 })))
    expect(SILENCE_THRESHOLD).toBeLessThan(loudnessOf(tone({ amplitude: 0.03 })))
  })
})
