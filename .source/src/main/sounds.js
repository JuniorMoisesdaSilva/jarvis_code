'use strict'

// The two short sounds, and how long each one lasts.
//
// They are played in the Panel, because Web Audio can make a clean tone without
// shipping any audio files. The durations are declared here because the speech
// has to wait for the sound to finish — otherwise the voice starts over the alert
// and the alert stops doing its job of being recognised by ear.

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

module.exports = { play, durationOf, DURATIONS }
