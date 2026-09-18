'use strict'

// Telling a sentence from a quiet room.
//
// This matters more than it looks. Handed silence, Whisper does not return
// nothing — it invents a short word, and that word would be typed into the
// terminal as though it had been dictated.
//
// The measure is the share of the recording that is loud enough to be voice, not
// the loudness of the recording as a whole. One door slamming in an otherwise
// silent minute is loud on average and still not somebody speaking.

/**
 * Below this a twentieth of a second is a quiet room. Set from measurement: an
 * idle microphone on this machine sits near 0.0005, and speech runs above 0.01.
 */
const SILENCE_THRESHOLD = 0.004

/** Twenty milliseconds, which is the usual unit for looking at speech. */
const FRAME = 320

/** Less voice than this in the recording and there was no sentence in it. */
const MIN_VOICED_SHARE = 0.05

/** Loudness of a recording, as a plain root-mean-square of its samples. */
function loudnessOf(audio, from = 0, to = audio?.length ?? 0) {
  if (!audio || to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i += 1) sum += audio[i] * audio[i]
  return Math.sqrt(sum / (to - from))
}

/** The share of the recording loud enough to be someone speaking. */
function voicedShare(audio, threshold = SILENCE_THRESHOLD) {
  if (!audio || audio.length === 0) return 0
  let frames = 0
  let voiced = 0
  for (let at = 0; at < audio.length; at += FRAME) {
    const end = Math.min(at + FRAME, audio.length)
    frames += 1
    if (loudnessOf(audio, at, end) >= threshold) voiced += 1
  }
  return frames === 0 ? 0 : voiced / frames
}

function isSilence(audio, threshold = SILENCE_THRESHOLD) {
  return voicedShare(audio, threshold) < MIN_VOICED_SHARE
}

module.exports = { loudnessOf, voicedShare, isSilence, SILENCE_THRESHOLD, MIN_VOICED_SHARE, FRAME }
