'use strict'

// Connect and Disconnect, as the order of their two writers.
//
// Connect is the personality — settings, placements and the plan server in
// Claude Code's MCP list — and the hooks, among them the one approval Jarvis
// grants: the plan tool's (ADR 0034). The approval must never be on a host
// without the server it approves, so the server goes first and the hooks
// second, and a Connect that fails at either step takes back what it did:
// nothing is left half connected. Disconnect undoes the two the other way round
// — the approval first — and tries both even when the first fails, reporting
// the first failure once both have been tried.
//
// The two writers are handed in, so the order is tested without a disk.

/** Runs `undo`, swallowing a failure: a rollback must not hide why it was needed. */
function quietly(undo) {
  try {
    undo()
  } catch {
    // The failure that started the rollback is the one reported.
  }
}

/**
 * @param personality `{ apply, remove }` — the Carried personality, with the server.
 * @param hooks       `{ install, uninstall }` — Jarvis's hooks, with the approval.
 */
function connect({ personality, hooks }) {
  try {
    personality.apply()
  } catch (error) {
    quietly(() => personality.remove())
    throw error
  }
  try {
    hooks.install()
  } catch (error) {
    quietly(() => hooks.uninstall())
    quietly(() => personality.remove())
    throw error
  }
}

function disconnect({ personality, hooks }) {
  const failures = []
  for (const undo of [() => hooks.uninstall(), () => personality.remove()]) {
    try {
      undo()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw failures[0]
}

module.exports = { connect, disconnect }
