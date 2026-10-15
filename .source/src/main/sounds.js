'use strict'

// The two short sounds, and how long each one lasts.
//
// They are played in the Panel, because Web Audio can make a clean tone without
// shipping any audio files. The durations are declared here because the speech
// has to wait for the sound to finish — otherwise the voice starts over the alert
// and the alert stops doing its job of being recognised by ear.

const fs = require('node:fs')
const { Sound } = require('../core/effects')

const DURATIONS = Object.freeze({
  [Sound.listeningStarted]: 150,
  [Sound.listeningStopped]: 150,
  // Two notes rather than one: a permission request has to be told apart from an
  // answer arriving, by ear alone.
  [Sound.permissionNeeded]: 620,
})

/**
 * Plays a sound in a Session's own panel and says how long the caller should
 * wait before speaking. The panel is passed in rather than held, so each window
 * plays its own alerts.
 */
function play(sound, contents) {
  const duration = DURATIONS[sound] ?? 0
  if (contents && !contents.isDestroyed()) {
    contents.send('sound:play', sound)
  }
  return duration
}

function durationOf(sound) {
  return DURATIONS[sound] ?? 0
}

// --- The Plan block's two sounds ---------------------------------------------
//
// A step done and a plan done: the Windows files the terminal mod played, so
// the ear that learnt them there knows them here. They are read here, once
// each, and their bytes go to the plan's own window, which plays them — so the
// panel's content policy never has to let in a file from outside the app, and
// no PowerShell is started for every step, as the mod did. Nothing waits for
// them: speech goes on as it would have.

const PLAN_SOUND_FILES = Object.freeze({
  step: 'C:\\Windows\\Media\\Windows Notify System Generic.wav',
  done: 'C:\\Windows\\Media\\tada.wav',
})

function createPlanSounds({ read = fs.readFileSync, files = PLAN_SOUND_FILES } = {}) {
  /** Each file's bytes, or null when it could not be read: silence, not an error. */
  const held = new Map()

  function bytesOf(sound) {
    if (!held.has(sound)) {
      let bytes = null
      try {
        bytes = read(files[sound])
      } catch {
        // A Windows without its media files plays nothing.
      }
      held.set(sound, bytes)
    }
    return held.get(sound)
  }

  /** Plays 'step' or 'done' in a Session's own panel; anything else is silence. */
  function play(sound, contents) {
    if (!Object.hasOwn(files, sound)) return
    if (!contents || contents.isDestroyed()) return
    const bytes = bytesOf(sound)
    if (!bytes) return
    contents.send('sound:chime', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }

  return { play }
}

/** One for every window, so each file is read once for the whole app. */
const planSounds = createPlanSounds()

module.exports = { play, durationOf, DURATIONS, createPlanSounds, planSounds, PLAN_SOUND_FILES }
