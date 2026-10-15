'use strict'

// What Claude Code actually runs when one of its events fires.
//
// This was Jarvis itself in helper mode until the cost of that was measured:
// forwarding one line of JSON meant starting Electron — Chromium, the GPU
// process, the whole stack — and then exiting. A quarter of a second warm, two
// full seconds cold, paid on every prompt submitted, every answer finished and
// every permission asked. Worse on the way out: at the end of a session Claude
// Code is already shutting down and stops waiting, so the hook was cancelled
// before Electron had finished starting and the terminal printed
// "SessionEnd hook failed: Hook cancelled" in place of a goodbye.
//
// It is the same binary, told to be Node instead of Electron, running this file
// instead of the app. Around eighty milliseconds, and nothing left to cancel.
//
// It requires nothing but Node and the one module holding the address, for the
// same reason the voice host does: a packaged app runs it from outside the
// archive, where the rest of the app is not resolvable.

const fs = require('node:fs')
const net = require('node:net')

const { channelAddress } = require('./hook-channel')

// Long enough for a pipe that is listening, short enough that a pipe that is
// not never becomes the agent's problem.
const PATIENCE = 1500
const CEILING = 3000

/**
 * Exit code zero always: a hook that reports failure interrupts the agent, and
 * a voice assistant that is closed is not the agent's business.
 */
function leave() {
  process.exit(0)
}

/**
 * The read is a plain synchronous read of file descriptor zero, and has to be.
 * `process.stdin` in Electron's main process ends immediately with nothing in
 * it — the event is sitting on that very handle, and the stream never delivers
 * it. Nothing errors along the way: the hook fires, the helper exits cleanly
 * with a zero, and Jarvis is simply never told. Every answer went unspoken for
 * that reason until 1 September 2026, which is why the relay is tested by
 * spawning the real thing rather than by calling this file.
 */
function eventOnStandardInput() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    // No standard input to speak of, so there is nothing to forward.
    return ''
  }
}

/**
 * The event, with the mark of the terminal it ran in when that is one of
 * Jarvis's own.
 *
 * Claude Code says which folder a session runs in, never which window. Two
 * sessions in the same folder look alike, so the terminal Jarvis opens puts its
 * name in the environment, Claude Code hands the environment down to its hooks,
 * and this is where it is read. Anything that is not a JSON object is forwarded
 * as it came: refusing it is Jarvis's decision, not the relay's.
 */
function marked(event) {
  const terminal = process.env.JARVIS_TERMINAL
  if (!terminal) return event
  try {
    const parsed = JSON.parse(event)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return event
    return JSON.stringify({ ...parsed, jarvis_terminal: terminal })
  } catch {
    return event
  }
}

/** Forwards the event on standard input to Jarvis, and leaves. */
function relay() {
  const received = eventOnStandardInput()
  if (received.trim() === '') leave()
  const payload = marked(received)

  const socket = net.connect(channelAddress(), () => {
    socket.end(payload)
  })
  socket.setTimeout(PATIENCE)
  socket.on('timeout', leave)
  socket.on('error', leave)
  socket.on('close', leave)

  // A connection that neither opens nor fails must not hang around either.
  setTimeout(leave, CEILING)
}

// The same launcher runs the plan tool's approval, told so by one more flag
// (APPROVE_FLAG in src/core/hook-installer.js): that hook answers rather than
// reports, and the answer is printed, not sent.
if (process.argv.includes('--approve-plan')) require('./plan-approval').approve()
else relay()
