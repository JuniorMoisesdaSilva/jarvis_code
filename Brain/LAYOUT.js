#!/usr/bin/env node
'use strict'

// Claude Code status line. It prints nothing, so Claude Code draws no line
// under its prompt: what that line used to show — the folder, the branch, the
// model, the context and the plan limits — is shown by Jarvis's Gauge (CTX),
// first in the Mods group.
//
// It still runs, because the status line is the only place Claude Code tells
// anyone the context, the cost and the plan limits. It reads the payload and
// hands it to Jarvis, together with two things the payload does not carry as
// a person reads them: the folder with the home abbreviated as ~
// (`jarvis_folder`) and the git branch, or an empty string outside a
// repository (`jarvis_branch`). See `report` below.
//
// Written in Node rather than PowerShell because Node is a safe thing to
// require: Claude Code itself does not run without it.

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

function readPayload() {
  let raw = ''
  try {
    raw = fs.readFileSync(0, 'utf8')
  } catch {
    return null
  }
  // Tolerate a leading byte-order mark, or anything else ahead of the JSON:
  // when the console's input encoding is not UTF-8 those bytes decode to
  // arbitrary characters, so drop everything before the first brace.
  const brace = raw.indexOf('{')
  if (brace > 0) raw = raw.slice(brace)
  if (raw.trim() === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** The branch, or an empty string when this is not a repository or has none checked out. */
function branchOf(cwd) {
  try {
    const inside = execFileSync('git', ['--no-optional-locks', '-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (inside !== 'true') return ''
    const branch = execFileSync('git', ['--no-optional-locks', '-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return branch
  } catch {
    // No git, or not a repository. Either way there is no branch to tell.
    return ''
  }
}

// --- Reporting to Jarvis ------------------------------------------------------

/** The longest the script stays alive for Jarvis, after everything is printed. */
const REPORT_CAP = 300

/**
 * The pipe Jarvis listens on. Spelt again from the app's hook-channel.js,
 * because this file is carried in Brain and cannot reach the app's code; a test
 * keeps the two the same.
 */
function channelAddress(env = process.env) {
  if (env.JARVIS_PIPE) return env.JARVIS_PIPE
  const who = (os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '')
  return `\\\\.\\pipe\\jarvis-hook-${who}`
}

/**
 * Sends the payload down Jarvis's pipe, tagged as a status reading, with the
 * folder and branch, and marked with the terminal it ran in when that is one
 * of Jarvis's own. With no Jarvis the connection fails at once; with one that
 * never answers it is cut off at the cap. Every failure is silent: the status
 * line is Claude Code's, not Jarvis's.
 */
function report(data, place) {
  try {
    const reading = { ...data, ...place, jarvis_reading: 'status' }
    if (process.env.JARVIS_TERMINAL) reading.jarvis_terminal = process.env.JARVIS_TERMINAL
    const socket = net.connect(channelAddress(), () => socket.end(JSON.stringify(reading)))
    socket.on('error', () => socket.destroy())
    // Unref'd, so a report that finished sooner never waits for it.
    setTimeout(() => socket.destroy(), REPORT_CAP).unref()
  } catch {
    // Nothing to report to, or nothing worth reporting.
  }
}

/** The folder as a person reads it — the home abbreviated as ~ — and its branch. */
function placeOf(data) {
  const cwd = data.workspace?.current_dir ?? data.cwd ?? process.cwd()
  const home = os.homedir()
  const folder =
    home && cwd.toLowerCase().startsWith(home.toLowerCase()) ? `~${cwd.slice(home.length)}` : cwd
  return { jarvis_folder: folder, jarvis_branch: branchOf(cwd) }
}

function main() {
  const data = readPayload()
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return
  report(data, placeOf(data))
}

main()
