'use strict'

// What the shell Jarvis opens must not inherit.
//
// Jarvis is usually started from the Start menu, where none of this arises. But
// it can be started from inside a Claude Code session — during development it
// always is — and Claude Code marks its child processes with a handful of
// variables that say "you are already inside a session". A shell that inherits
// them starts a Claude Code that believes it is its own child: it stops saving
// the conversation, and prints a warning about it above the prompt on every
// screen the user looks at.
//
// The session Jarvis opens is a new one and has to start clean. Found in use on
// 1 September 2026.

/**
 * The marks of a session already running. Every one of these is set by Claude
 * Code for the lifetime of one session — none is configuration a person would
 * set on purpose, which is why they can be dropped without asking.
 */
const SESSION_MARKERS = Object.freeze([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
])

/**
 * The environment as the shell should see it: everything Jarvis was given,
 * minus the marks of the session Jarvis itself was started from.
 *
 * Deliberate configuration is left alone. `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`
 * and anything else a person sets in their own environment is not on the list
 * and travels through untouched.
 */
function forShell(environment) {
  const clean = {}
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (SESSION_MARKERS.includes(name)) continue
    clean[name] = value
  }
  return clean
}

module.exports = { forShell, SESSION_MARKERS }
