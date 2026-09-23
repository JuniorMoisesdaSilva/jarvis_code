'use strict'

// Jarvis's own vocabulary for what happens, not Claude Code's. The translation
// from the tool's hook format happens in `hook-payload.js`, at a single point,
// so a change to that format does not spread through the core.

/** Events arriving from Claude Code, delivered by its hook system. */
const agent = {
  /** Claude Code finished answering. The text arrives ready in the event. */
  assistantFinished: (sessionId, text) => ({ type: 'assistantFinished', sessionId, text }),
  /** Claude Code stopped and is waiting for authorization. */
  permissionRequested: (sessionId, toolName, detail = null) => ({
    type: 'permissionRequested',
    sessionId,
    toolName,
    detail,
  }),
  /**
   * A message was sent to Claude Code — dictated or typed. This is what
   * completes the written Transcript: Jarvis sees what you say, but what you
   * type straight into the terminal only reaches it through here.
   */
  userPromptSubmitted: (sessionId, text) => ({ type: 'userPromptSubmitted', sessionId, text }),
  /**
   * Claude Code opened in a folder. The first moment there is something in the
   * terminal that understands a request rather than a shell command — which is
   * what the memory prompt waits for. `source` is the tool's own word for why it
   * started: `startup`, `resume`, `clear` or `compact`.
   */
  sessionStarted: (sessionId, source = null) => ({ type: 'sessionStarted', sessionId, source }),
  /** The session ended; there is no point in still talking to it. */
  sessionEnded: (sessionId) => ({ type: 'sessionEnded', sessionId }),
}

/**
 * An Agent event together with the folder its session is running in.
 *
 * The folder travels with the event because Jarvis's hooks are global: every
 * Claude Code session on the machine sends events, including ones Jarvis did not
 * open. Without it the core could not tell the right session apart.
 *
 * The path arrives here **already normalized** — resolving links and casing
 * touches the disk and is the adapter's job. The core compares text.
 *
 * `terminal` names the terminal Jarvis opened when the session runs in one of
 * them, and is null for any other window. The folder alone cannot tell a new
 * session in Jarvis's own terminal from a second window on the same project.
 */
function incoming(event, workingDirectory = null, terminal = null) {
  return { event, workingDirectory, terminal }
}

/** Things the user does — in the Panel, on the keyboard, or at the microphone. */
const user = {
  /**
   * A project was opened in the Panel. The path arrives normalized; `terminal`
   * is the name of the terminal opened for it, which is what marks the sessions
   * started there.
   */
  projectOpened: (path, terminal = null) => ({ type: 'projectOpened', path, terminal }),
  projectClosed: () => ({ type: 'projectClosed' }),
  /** Reconnection to a session already running when Jarvis launched. */
  sessionRestored: (sessionId) => ({ type: 'sessionRestored', sessionId }),
  /** The session vanished without notice — usually the terminal was closed. */
  sessionLost: () => ({ type: 'sessionLost' }),
  shortcutPressed: (shortcut) => ({ type: 'shortcutPressed', shortcut }),
  micPressed: () => ({ type: 'micPressed' }),
  dictationPartial: (text) => ({ type: 'dictationPartial', text }),
  dictationFinal: (text) => ({ type: 'dictationFinal', text }),
  cancelDictationPressed: () => ({ type: 'cancelDictationPressed' }),
  stopSpeechPressed: () => ({ type: 'stopSpeechPressed' }),
  repeatLastPressed: () => ({ type: 'repeatLastPressed' }),
  /** Card controls for the reading in progress: hold it, let it go on, or start
   * the same audio over from the beginning. */
  pauseSpeechPressed: () => ({ type: 'pauseSpeechPressed' }),
  resumeSpeechPressed: () => ({ type: 'resumeSpeechPressed' }),
  /** Play one of the last few readings again, from its stored audio. */
  replayReadingPressed: (id) => ({ type: 'replayReadingPressed', id }),
  autoReadSet: (enabled) => ({ type: 'autoReadSet', enabled }),
  languageToggled: () => ({ type: 'languageToggled' }),
  speechFinished: () => ({ type: 'speechFinished' }),
}

module.exports = { agent, user, incoming }
