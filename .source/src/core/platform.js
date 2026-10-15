'use strict'

// The handful of answers that depend on the machine Jarvis runs on — the shell
// a Session opens with, which stored paths are usable, how the status line is
// run — decided in one file rather than sprinkled through the app.
//
// Pure by construction: every function takes what it needs rather than reading
// it, and the callers that do not care pass nothing.

/** The machine Jarvis is running on right now. */
function current() {
  return { platform: process.platform, env: process.env }
}

/**
 * The shell a Session opens with when the user has not chosen one: PowerShell,
 * which every Windows machine has.
 */
function defaultShell() {
  return 'powershell.exe'
}

/**
 * Whether a stored path is one Windows could have written.
 *
 * The preferences file is plain JSON and can be written by hand, or carried in
 * from somewhere else. A POSIX path — `/bin/zsh`, `/Users/someone/Code` — is
 * nothing Windows can use: kept, the first opens a Session on a shell that does
 * not exist, and the second offers to reopen a project that was never here.
 *
 * Shape, not existence. It asks whether the path is shaped like a Windows one,
 * not whether it is on the disk today — a project moved or deleted is a
 * different question, and answering it here would throw away a perfectly good
 * preference every time a drive was not mounted yet. A bare name — `bash`,
 * `pwsh.exe` — names no place, so there is nothing in it to reject.
 */
function isNativePath(candidate) {
  const value = String(candidate ?? '').trim()
  if (value === '') return false
  return !value.startsWith('/')
}

/**
 * The command Claude Code is told to run for the status line.
 *
 * The status line is part of the Carried personality — the behaviour Jarvis
 * applies to whatever machine it is plugged into. It is a Node script, and Node
 * is already there: Claude Code itself does not run without it.
 */
function statusLineCommand(script) {
  return `node "${String(script).replace(/\\/g, '/')}"`
}

/**
 * The MCP server entry for Jarvis's plan tool (Brain/PLAN.js), as Claude Code
 * keeps it in its user-scope list: run by Node, like the status line, with the
 * script named by forward slashes as the status line names its own.
 */
function planServer(script) {
  return { type: 'stdio', command: 'node', args: [String(script).replace(/\\/g, '/')] }
}

/**
 * The file name at the end of a path, whichever separator wrote it.
 *
 * `path.basename` only splits the separator of the platform it is running on,
 * and a path typed by hand or written by another tool may use either. This
 * answers the same for both.
 */
function fileName(candidate) {
  const parts = String(candidate ?? '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

module.exports = { defaultShell, isNativePath, statusLineCommand, planServer, fileName, current }
