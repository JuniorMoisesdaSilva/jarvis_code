'use strict'

// Which open Session a payload heard on the pipe belongs to, and which of its
// doors it goes through.
//
// Kept apart from the registry (sessions.js) so the routing can be tested
// without a window: it needs only what each Session answers about itself.

const { decode, decodeStatus } = require('../core/hook-payload')

/**
 * Which Session a hook event belongs to. An event from the terminal a window
 * opened is that window's, whatever it was holding. Otherwise a Claude Code
 * session a window has already adopted wins by its id, so two windows open on
 * the same folder each keep their own conversation. A first event — no window
 * owns that id yet — goes to a window on that folder that has not adopted a
 * session, then to any window on that folder, and only then to a window open
 * on a folder above it.
 */
function routeHook(sessions, incoming) {
  const sessionId = incoming.event.sessionId
  const cwd = incoming.workingDirectory

  for (const session of sessions) {
    if (session.ownsTerminal(incoming.terminal ?? null)) return session
  }
  for (const session of sessions) {
    if (session.ownsClaudeSession(sessionId)) return session
  }
  // A window open on that very folder before one open on a folder above it:
  // Claude Code reports the folder its shell is in, which may be inside a
  // project, and inside a project may also be another project.
  for (const exactly of [true, false]) {
    for (const session of sessions) {
      if (session.matchesProject(cwd, { exactly }) && !session.hasActiveSession()) return session
    }
    for (const session of sessions) {
      if (session.matchesProject(cwd, { exactly })) return session
    }
  }
  return null
}

/**
 * One payload heard on the pipe, to the Session it belongs to. The status line
 * knocks on the same pipe: its reading goes to the same Session a hook from
 * there would, but only to its Deck — it is never spoken.
 */
function deliver(payload, sessions) {
  const reading = decodeStatus(payload)
  if (reading) {
    routeHook(sessions, reading)?.receiveStatus(reading)
    return
  }
  const incoming = decode(payload)
  if (!incoming) return
  routeHook(sessions, incoming)?.receive(incoming)
}

module.exports = { routeHook, deliver }
