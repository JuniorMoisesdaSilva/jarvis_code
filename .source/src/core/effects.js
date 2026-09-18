'use strict'

// Everything the core can ask the outside world to do.
//
// The core never talks to the terminal, the microphone or the synthesizer — it
// returns effects, and the adapters carry them out. That shape is what makes it
// possible to exercise the whole app in tests without touching audio, terminal
// or disk.

/** Short sounds that tell the kind of event apart by ear. */
const Sound = Object.freeze({
  listeningStarted: 'listeningStarted',
  listeningStopped: 'listeningStopped',
  permissionNeeded: 'permissionNeeded',
})

/** The kinds of line the written Transcript can hold. */
const EntryKind = Object.freeze({
  userVoice: 'userVoice',
  userTyped: 'userTyped',
  assistant: 'assistant',
  permission: 'permission',
})

/**
 * One line of the readable written Transcript. Deliberately without a timestamp:
 * the adapter that writes to disk stamps the time, so the core's tests do not
 * depend on the clock.
 */
function entry(kind, text) {
  return { kind, text }
}

const effect = {
  /** Types text into the terminal's input line without submitting it. */
  sendTextToTerminal: (text) => ({ type: 'sendTextToTerminal', text }),
  /**
   * Types a command and presses Enter. Only Command shortcuts do this — never
   * Dictation, whose text is a recognition engine's guess.
   */
  runInTerminal: (command) => ({ type: 'runInTerminal', command }),
  speak: (text, language) => ({ type: 'speak', text, language }),
  stopSpeaking: () => ({ type: 'stopSpeaking' }),
  /** Hold the reading where it is, and let a held reading go on. */
  pauseSpeaking: () => ({ type: 'pauseSpeaking' }),
  resumeSpeaking: () => ({ type: 'resumeSpeaking' }),
  /** Play a stored past reading again, by its id — no re-synthesis. */
  replayReading: (id) => ({ type: 'replayReading', id }),
  startListening: (language) => ({ type: 'startListening', language }),
  /** Ends listening and asks the engine for the final text. */
  stopListening: () => ({ type: 'stopListening' }),
  /** Throws away what was said without delivering any text. */
  cancelListening: () => ({ type: 'cancelListening' }),
  play: (sound) => ({ type: 'play', sound }),
  log: (transcriptEntry) => ({ type: 'log', entry: transcriptEntry }),
}

module.exports = { Sound, EntryKind, entry, effect }
