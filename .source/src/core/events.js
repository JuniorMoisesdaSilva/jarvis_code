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
   * terminal that understands a request rather than a shell command. `source` is the tool's own word for why it
   * started: `startup`, `resume`, `clear` or `compact`.
   */
  sessionStarted: (sessionId, source = null) => ({ type: 'sessionStarted', sessionId, source }),
  /** The session ended; there is no point in still talking to it. */
  sessionEnded: (sessionId) => ({ type: 'sessionEnded', sessionId }),

  // --- What only the Deck reads ---------------------------------------------
  //
  // Nothing below is spoken or written to the Transcript: these exist so the
  // Deck can show what Claude Code is doing. A call names the subagent it was
  // made in (`agentId`, `agentType`), and both are null in the main
  // conversation. `detail` is the one field worth showing, unmasked here — the
  // Deck masks it before keeping it.

  /** A tool is about to run. */
  toolStarted: (sessionId, call) => ({ type: 'toolStarted', sessionId, ...toolCall(call) }),
  /**
   * A tool ran, and took `durationMs`. `plan` is what it did to a plan, for a
   * call that carries one — see `planOf` in hook-payload.js — and null otherwise.
   */
  toolFinished: (sessionId, call) => ({
    type: 'toolFinished',
    sessionId,
    ...toolCall(call),
    durationMs: call.durationMs ?? null,
    plan: call.plan ?? null,
  }),
  /** A tool ran and failed; `interrupted` when the user stopped it. */
  toolFailed: (sessionId, call) => ({
    type: 'toolFailed',
    sessionId,
    ...toolCall(call),
    error: call.error ?? null,
    interrupted: call.interrupted === true,
    durationMs: call.durationMs ?? null,
  }),
  /** Auto mode refused a call, for `reason`. */
  permissionDenied: (sessionId, call) => ({
    type: 'permissionDenied',
    sessionId,
    ...toolCall(call),
    reason: call.reason ?? null,
  }),
  subagentStarted: (sessionId, { agentId, agentType }) => ({
    type: 'subagentStarted',
    sessionId,
    agentId,
    agentType: agentType ?? null,
  }),
  /** A subagent finished; its own transcript is where its tokens are. */
  subagentStopped: (sessionId, { agentId, agentType, transcriptPath, lastMessage }) => ({
    type: 'subagentStopped',
    sessionId,
    agentId,
    agentType: agentType ?? null,
    transcriptPath: transcriptPath ?? null,
    lastMessage: lastMessage ?? null,
  }),
  /** The context is about to be summarised; `trigger` is `manual` or `auto`. */
  compactionStarted: (sessionId, trigger = null) => ({ type: 'compactionStarted', sessionId, trigger }),
  compactionFinished: (sessionId, trigger = null) => ({ type: 'compactionFinished', sessionId, trigger }),
  /**
   * The turn ended with nothing to say: a Stop whose last message is blank.
   * Only the Deck hears it — the core has nothing to speak or write.
   */
  turnEnded: (sessionId) => ({ type: 'turnEnded', sessionId }),
  /** The turn ended on an error rather than an answer. */
  turnFailed: (sessionId, error = null, details = null) => ({
    type: 'turnFailed',
    sessionId,
    error,
    details,
  }),
}

/**
 * What Claude Code's status line reports: the only source of the context and
 * the plan limits. Not an Agent event — it never speaks and never
 * reaches the Transcript or the core; the Deck alone reads it.
 *
 * `figures` holds `contextPercent`, `fiveHour` and `sevenDay` (each
 * `{ percent, resetsAt }` in milliseconds, or null when the plan does not report
 * it), `model`, `effort`, and the `folder` and git `branch` it runs in.
 * Anything not reported yet is null, never zero.
 */
const status = {
  reported: (sessionId, figures) => ({ type: 'statusReported', sessionId, figures }),
}

/**
 * What Jarvis found out for the Deck by itself, rather than being told: a
 * subagent's figures, read once from its transcript after it stopped. `figures`
 * is `{ tokens: { input, output, cacheRead, cacheCreation }, outOfOutput }`, or
 * null when the transcript could not be read — the figures then stay blank.
 */
const measured = {
  subagent: (sessionId, agentId, figures) => ({ type: 'subagentMeasured', sessionId, agentId, figures: figures ?? null }),
}

/**
 * The fields every tool call carries, in one order, with nulls for the absent.
 * `spawn` is set only on a call that starts a subagent — `{ agentType, task,
 * background }` — and is how a subagent's card learns what it was asked to do.
 */
function toolCall({ toolName, toolUseId, detail, agentId, agentType, permissionMode, effort, spawn }) {
  return {
    toolName: toolName ?? 'unknown',
    toolUseId: toolUseId ?? null,
    detail: detail ?? null,
    agentId: agentId ?? null,
    agentType: agentType ?? null,
    permissionMode: permissionMode ?? null,
    effort: effort ?? null,
    spawn: spawn ?? null,
  }
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

module.exports = { agent, status, measured, user, incoming }
