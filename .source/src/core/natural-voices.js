'use strict'

// The voices Jarvis brings with it, which since 8 September 2026 are the only
// voices there are: the machine's own are no longer offered. See
// Docs/decisions/0010-a-neural-voice-of-our-own.md and
// Docs/decisions/0025-jarvis-reads-in-its-own-voices.md.
//
// Read in three places that must not drift apart: the script that downloads
// them, the script that packages them, and the host that speaks with them. That
// is why the catalogue lives in the core as plain data rather than being spelled
// out again in each of them.

const path = require('node:path')

/** Where the voices sit, inside the Resources compartment both platforms share. */
const FOLDER = 'voices'

/**
 * The pronunciation rules, shared by every voice whatever its language. Each
 * download carries its own copy of these 18 MB; one is kept and the rest are
 * thrown away.
 */
const PRONUNCIATION = 'espeak-ng-data'

/** The file each voice's folder holds, named the same way for every voice. */
const WEIGHTS = 'model.onnx'
const TOKENS = 'tokens.txt'

/**
 * Every voice, in the order the Settings sheet offers them. First in a language
 * is the one Jarvis reads with until the user says otherwise, so the order here
 * is a decision and not an accident.
 *
 * `id` is both the folder on disk and half of the stored name, so renaming one
 * silently changes somebody's saved choice. Don't.
 *
 * `archive` is the name sherpa-onnx publishes the voice under. Most come from
 * the Piper project and the recordings behind them are CC0. Miro and Dii do
 * not: they are TigreGotico's, published CC BY-NC-ND 4.0 — attribution
 * required, no commercial use, no derivatives. Each folder keeps whatever paper
 * came with it, so that stays traceable after packaging; a Jarvis that ever
 * becomes a commercial product has to drop those two or license them.
 */
const VOICES = Object.freeze([
  {
    // High rather than medium, and a deeper voice than Faber: 115 Hz against
    // 166 Hz measured on the same sentence. Added 8 September 2026, when the
    // machine's own voices were removed and the reading had to stand on what
    // Jarvis carries alone. Trained by TigreGotico on a real speaker and
    // fine-tuned to Brazilian Portuguese from their European voice.
    id: 'pt_BR-miro-high',
    archive: 'vits-piper-pt_BR-miro-high',
    label: 'Miro',
    culture: 'pt-BR',
    gender: 'Male',
  },
  {
    // The one female Brazilian voice Jarvis has ever carried, which is what
    // 0022 kept the system voices for and 0025 accepted losing. It arrived by
    // accident: it was fetched to be compared with Miro, and turned out to be
    // both female and the clearest of the four tried — Whisper transcribed it
    // word for word where it stumbled on the other three.
    id: 'pt_BR-dii-high',
    archive: 'vits-piper-pt_BR-dii-high',
    label: 'Dii',
    culture: 'pt-BR',
    gender: 'Female',
  },
  {
    id: 'pt_BR-faber-medium',
    archive: 'vits-piper-pt_BR-faber-medium',
    label: 'Faber',
    culture: 'pt-BR',
    gender: 'Male',
  },
  {
    id: 'pt_BR-cadu-medium',
    archive: 'vits-piper-pt_BR-cadu-medium',
    label: 'Cadu',
    culture: 'pt-BR',
    gender: 'Male',
  },
  {
    id: 'pt_BR-jeff-medium',
    archive: 'vits-piper-pt_BR-jeff-medium',
    label: 'Jeff',
    culture: 'pt-BR',
    gender: 'Male',
  },
  {
    id: 'en_US-lessac-medium',
    archive: 'vits-piper-en_US-lessac-medium',
    label: 'Lessac',
    culture: 'en-US',
    gender: 'Female',
  },
  {
    id: 'en_US-amy-medium',
    archive: 'vits-piper-en_US-amy-medium',
    label: 'Amy',
    culture: 'en-US',
    gender: 'Female',
  },
])

/**
 * The prefix every name carries. It is part of the stored name rather than a
 * separate field because the name is all that is saved, and it still earns its
 * place now that nothing else is offered: a preferences file written when the
 * machine's own voices were is told apart by it, and read with one of ours.
 */
const PREFIX = 'jarvis:'

/** The name a voice is stored and asked for by. */
function nameOf(voice) {
  return `${PREFIX}${voice.id}`
}

/** Whether a stored voice name is one of ours rather than one left from before. */
function isOurs(name) {
  return typeof name === 'string' && name.startsWith(PREFIX)
}

/** The voice a stored name refers to, or null if it names none of ours. */
function find(name) {
  if (!isOurs(name)) return null
  const id = name.slice(PREFIX.length)
  return VOICES.find((each) => each.id === id) ?? null
}

/**
 * The reading rate, translated. The Settings sheet offers −10 to 10, the scale
 * Windows' synthesis API used and the one the slider was built for; this engine
 * takes a multiplier instead, so the scale is mapped rather than passed through.
 * Eight per cent a step is what those numbers used to mean.
 *
 * Bounded at both ends: half speed is the slowest that still sounds like
 * speech, and double is the fastest that stays a sentence.
 */
function speedFor(rate) {
  const bounded = Math.max(-10, Math.min(10, Number(rate) || 0))
  return Math.max(0.5, Math.min(2, 1.08 ** bounded))
}

/** Where the download script writes, and the host reads. */
function folderFor(root, voice) {
  return path.join(root, FOLDER, voice.id)
}

function pronunciationFolder(root) {
  return path.join(root, FOLDER, PRONUNCIATION)
}

module.exports = {
  FOLDER,
  PRONUNCIATION,
  WEIGHTS,
  TOKENS,
  VOICES,
  PREFIX,
  nameOf,
  isOurs,
  find,
  speedFor,
  folderFor,
  pronunciationFolder,
}
