'use strict'

// What the relay does when Claude Code is about to run Jarvis's own plan tool:
// answer "allow", and nothing else (ADR 0034).
//
// The hook is matched to `mcp__jarvis__update_plan` alone and is waited for,
// so its standard output is the decision. It is printed whatever the payload
// says: the matcher already chose the tool, and a decision that hung on parsing
// would stop the work over a progress bar. The payload is still read to the
// end, so Claude Code never writes into a pipe nobody is reading.
//
// Like the relay it requires nothing but Node: a packaged app runs it from
// outside the archive.

const fs = require('node:fs')

const DECISION = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'Jarvis’s plan tool only draws a progress bar.',
  },
}

function approve() {
  try {
    fs.readFileSync(0)
  } catch {
    // No standard input to speak of; the answer is the same.
  }
  process.stdout.write(JSON.stringify(DECISION), () => process.exit(0))
}

module.exports = { approve, DECISION }
