'use strict'

// Reading answers aloud.
//
// One set of voices: the ones Jarvis ships. They are neural, they sound
// markedly better than anything the machine has of its own, and they are files
// the app already carries, so the list is known the moment it starts. The
// machine's own voices were offered underneath them behind a switch until 8
// September 2026; see Docs/decisions/0025-jarvis-reads-in-its-own-voices.md for
// why the switch and the host behind it are gone.
//
// The host synthesises to a file and Jarvis plays it in the Panel. Playing it
// there rather than in the host is what lets the Panel show how far along the
// reading is, and it is why stopping is instant: the sound is ours to cut.

const { PORTUGUESE } = require('../core/language')
const natural = require('./natural-voice')
const preferences = require('./preferences')

let listeners = {}
let currentId = null
let nextId = 1

function emit(name, payload) {
  const handler = listeners[name]
  if (handler) handler(payload)
}

/**
 * A voice Jarvis carries to read with when the chosen one cannot be used —
 * which is what a preferences file naming one of the machine's own voices now
 * asks for, and what any name the shipped host does not know asks for.
 *
 * The alternative is what this replaces: the shipped host does not recognise the
 * name, declines the reading, and the answer goes unread with nothing said. A
 * different voice is a small surprise; silence is a broken app.
 *
 * The language is recovered from the stored choices, because a Reading carries a
 * voice and not a language, and reading Portuguese in an English voice would be
 * a worse rescue than the one being rescued from.
 */
function standIn(voice) {
  const ours = natural.installedVoices()
  if (ours.length === 0) return ''

  let language = null
  try {
    const { voices } = preferences.read()
    language = Object.keys(voices ?? {}).find((each) => voices[each] === voice) ?? null
  } catch {
    // Nothing stored to learn from; the default language is the better guess.
  }

  const prefix = (language ?? PORTUGUESE).slice(0, 2).toLowerCase()
  const match = ours.find((each) => (each.culture ?? '').toLowerCase().startsWith(prefix))
  return (match ?? ours[0]).name
}

/** The voices Jarvis carries, which is every voice there is. */
function installedVoices() {
  return natural.installedVoices()
}

function start() {
  natural.start()
  // Nothing to wait for: the list is the voices we shipped, and they are files
  // we already have. Announce them so a Settings sheet opened before the first
  // reading is not looking at an empty box.
  queueMicrotask(() => emit('onVoices', installedVoices()))
}

/**
 * Starts reading. The voice is chosen explicitly rather than left to a default:
 * the language a Reading is in is the conversation's, and the first voice in the
 * list is not always the one for it.
 */
function speak(text, { voice, rate = 0 }) {
  start()
  const id = `read-${nextId}`
  nextId += 1
  currentId = id

  const reading = { id, text, voice: voice ?? '', rate }
  return natural.speak(reading) || natural.speak({ ...reading, voice: standIn(voice) })
}

/** Loads a voice before it is needed, so the first reading does not wait. */
function warmUp(voice) {
  return natural.warmUp(voice)
}

/**
 * Nothing to tell the host: it plays nothing. Forgetting the reading is
 * enough — its file will arrive and be dropped, and the Panel is told separately
 * to stop the sound it already has.
 */
function stop() {
  currentId = null
}

/** The voices that can read a language. */
function voicesFor(language) {
  const prefix = language.slice(0, 2).toLowerCase()
  return installedVoices().filter((each) =>
    (each.culture ?? '').toLowerCase().startsWith(prefix),
  )
}

/**
 * Whether a language can be read at all. With the voices packaged this is
 * always true; a build assembled without them can read nothing, and the Panel
 * has to say so rather than fall silent for reasons nobody can see.
 */
function canRead(language) {
  return voicesFor(language).length > 0
}

/** What the user does about a language nothing can read. */
function howToInstallVoice(language) {
  const name = language === PORTUGUESE ? 'Portuguese (Brazil)' : 'English'
  return (
    `Jarvis has no ${name} voice to read with. Its own voices are missing from ` +
    'this folder — fetch them again with `npm run fetch-assets`, which puts them ' +
    'back in Resources.'
  )
}

function on(handlers) {
  listeners = { ...listeners, ...handlers }
}

function shutdown() {
  natural.shutdown()
}

/**
 * A reading already replaced still finishes synthesising, and its file arrives
 * after the new one started. Playing it would be the wrong voice reading the
 * wrong answer.
 */
function audioArrived({ id, path }) {
  if (id !== currentId) return
  currentId = null
  emit('onAudio', { id, path })
}

natural.on({
  onAudio: audioArrived,
  onError: (message) => emit('onError', message),
})

module.exports = {
  start,
  speak,
  warmUp,
  stop,
  installedVoices,
  voicesFor,
  canRead,
  howToInstallVoice,
  on,
  shutdown,
}
