'use strict'

// The registry of open Sessions, and the broker of the resources there is only
// one of.
//
// Each Session is a window with its own terminal, rail, core and state. But the
// machine has one microphone, one synthesiser, and Claude Code reports through
// one channel — so those are shared, and handed to a single Session at a time:
//
//   - the voice goes to whoever last began reading; a new reading stops the old;
//   - the microphone goes to the focused window, the one you are looking at;
//   - a hook event goes to the Session whose project it came from.
//
// The global adapters are wired here, once, and route into the right Session.

const { createWindow } = require('./workspace')
const { createSession } = require('./app-model')
const { deliver } = require('./hook-routing')
const speech = require('./speech')
const dictation = require('./dictation')
const hooks = require('./hooks')
const preferences = require('./preferences')
const models = require('./models')

const all = new Set()
let focused = null
let voiceOwner = null
let micOwner = null
let wired = false

/** The Session that owns a webContents (a pane), for routing IPC by sender. */
function sessionForContents(webContents) {
  for (const session of all) {
    if (session.ownsContents(webContents)) return session
  }
  return null
}

/** Every open Session refreshes its Connect state after one of them changes it. */
function broadcastHookState() {
  for (const session of all) session.refreshHookState()
}

// The voice and the microphone are one machine each. Taking one stops the other
// too, across every window: a reading must never play into an open microphone,
// and a microphone must never open over a reading. Within one window the core
// already does this on mic-press; these cross-stops carry the same rule between
// windows. The `isReading`/`isListening` checks keep a stale owner — one that
// finished on its own — from being sent a pointless stop.
function stopOtherVoice(session) {
  if (voiceOwner && voiceOwner !== session && voiceOwner.isReading()) voiceOwner.stopReadingLocally()
}
function stopOtherMic(session) {
  if (micOwner && micOwner !== session && micOwner.isListening()) micOwner.stopListeningLocally()
}

/** Give the single voice to a Session, silencing any other reading or mic. */
function acquireVoice(session) {
  stopOtherVoice(session)
  stopOtherMic(session)
  voiceOwner = session
}

/** Give the single microphone to a Session, silencing any other mic or reading. */
function acquireMic(session) {
  stopOtherMic(session)
  stopOtherVoice(session)
  micOwner = session
}

/** Is another window reading aloud right now? A new reading defers to this. */
function isVoiceBusy(session) {
  return Boolean(voiceOwner && voiceOwner !== session && voiceOwner.isReading())
}

/** The Spine is one choice for every window: each catches up when one changes it. */
function broadcastSpine() {
  for (const session of all) session.actions.reloadSpine()
}

/** The Commands and the Skills are one list for every window: each redraws when one reorders them. */
function broadcastShortcuts() {
  for (const session of all) session.actions.reloadShortcuts()
}

const deps = { acquireVoice, acquireMic, broadcastHookState, broadcastSpine, broadcastShortcuts, isVoiceBusy }

/** Wire the shared adapters once, routing each into the right Session. */
function wireSharedAdapters() {
  if (wired) return
  wired = true

  speech.on({
    onAudio: ({ path: file }) => voiceOwner?.playAudio(file),
    onFinished: () => voiceOwner?.speechFinished(),
    // The voice list is a fact about the machine, not any one window.
    onVoices: () => {
      for (const session of all) session.voicesArrived()
    },
    onError: (message) => (voiceOwner ?? focused)?.voiceError(message),
  })

  dictation.on({
    onPreview: (text) => micOwner?.dictationPreview(text),
    onFinal: (text) => micOwner?.dictationFinal(text),
    onDownloading: (report) => micOwner?.dictationDownloading(report.progress),
    // The model arriving is machine-wide: every window can dictate now.
    onReady: () => {
      for (const session of all) session.dictationReady()
    },
    onFailed: (message) => micOwner?.dictationFailed(message),
  })

  hooks.listen((payload) => deliver(payload, all))
}

/** Opens a new window and its Session, and returns it. */
function openWindow() {
  const handle = createWindow({
    onFocus: () => {
      // The window in front owns the microphone by simply being looked at.
      focused = sessionForWindow(handle)
    },
  })

  const session = createSession({ win: handle, deps })
  session.handle = handle
  all.add(session)
  focused = session

  handle.window().on('closed', () => {
    session.close()
    all.delete(session)
    if (voiceOwner === session) voiceOwner = null
    if (micOwner === session) micOwner = null
    if (focused === session) focused = all.values().next().value ?? null
  })

  session.begin()
  // The voice list is broadcast once, at startup. A window opened after that has
  // missed it, so it is given the news now — otherwise it never warms a voice.
  if (speech.installedVoices().length > 0) session.voicesArrived()
  return session
}

function sessionForWindow(handle) {
  for (const session of all) {
    if (session.handle === handle) return session
  }
  return null
}

/** Start the shared engines once, then open the first window. */
function start() {
  wireSharedAdapters()
  speech.start()
  const stored = safeSettings()
  dictation.warmUp(stored.model ?? models.DEFAULT)
  return openWindow()
}

function safeSettings() {
  try {
    return preferences.read()
  } catch {
    return preferences.DEFAULTS
  }
}

/** The tray and a second launch bring Jarvis forward — or open a window if none. */
function showOrOpen() {
  const session = focused ?? all.values().next().value
  if (session) session.handle.show()
  else openWindow()
}

function count() {
  return all.size
}

function focusedSession() {
  return focused
}

function currentMicOwner() {
  return micOwner
}

/** A stored list or setting changed: every open window catches up. */
function reloadAll() {
  for (const session of all) {
    session.actions.reloadShortcuts()
    session.actions.reloadSettings()
  }
}

function shutdown() {
  hooks.stopListening()
  for (const session of all) session.close()
  dictation.shutdown()
  speech.shutdown()
}

module.exports = {
  start,
  openWindow,
  showOrOpen,
  sessionForContents,
  focused: focusedSession,
  micOwner: currentMicOwner,
  reloadAll,
  count,
  shutdown,
}
