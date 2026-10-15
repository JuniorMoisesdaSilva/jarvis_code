'use strict'

// What a running Jarvis does when it is launched again.
//
// One process holds the hook channel, so a second launch does not start its
// own copy: the running one opens a window instead. That is only right while
// the two are the same code. Closing every window leaves Jarvis in the tray,
// so a Jarvis started in the morning is still the one running in the
// afternoon, and a launch of a checkout that has moved on since would hand
// itself to it and quit. The window that opens then draws the new page — a
// page is read from disk each time one opens — over the old main process: its
// switches send actions the old process does not have, and its Connect writes
// the old process's hooks. Nothing fails loudly; nothing works either.
//
// So a launch carries a fingerprint of its code, and a running Jarvis that
// finds a different one makes way. It asks first when windows are open: each
// has a terminal, and very likely a Claude Code in it. (ADR 0013, amended.)

const crypto = require('node:crypto')

/**
 * A short digest of the code, from `{ name, text }` pairs — the files' names
 * relative to the app, and their contents. The order they are found in does
 * not matter; a name and its text are kept apart, so moving a letter from one
 * to the other is a change.
 */
function fingerprint(files) {
  const hash = crypto.createHash('sha256')
  for (const { name, text } of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    hash.update(`${name.length}:${name}`)
    hash.update(`${Buffer.byteLength(text)}:`)
    hash.update(text)
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * @param running     `{ build }` — the running Jarvis's fingerprint, taken when it started.
 * @param arriving    what the second launch sent: `{ build }`, or nothing from an older Jarvis.
 * @param windowsOpen how many windows the running Jarvis has open.
 * @returns 'open' (a window, as before), 'replace' (make way: quit,
 *          and let the launch start in its place) or 'ask' (the user decides).
 */
function secondLaunch({ running, arriving, windowsOpen }) {
  const theirs = arriving?.build
  if (typeof theirs !== 'string' || theirs === '' || theirs === running?.build) return 'open'
  return windowsOpen > 0 ? 'ask' : 'replace'
}

// --- The handover -----------------------------------------------------------
//
// The running Jarvis does not start the launch in its place: a process it
// started would inherit the old one's environment, its folder and its lost
// console. It answers the launch, and quits. The launch, which kept waiting,
// takes the lock once the old one lets go of it, and starts as itself.
//
// The answers, written where the launch said it would look:
//   'opened'     — a window was opened; the launch is done.
//   'asking'     — the user is being asked; keep waiting.
//   'making-way' — the running Jarvis is quitting; take the lock when it is free.
//   'kept'       — the user kept the running Jarvis; the launch is done.

/** How long a launch waits for any answer before taking silence for an older Jarvis's window. */
const ANSWER_WITHIN = 5_000

/** How long a launch waits for the Jarvis making way to let go of the lock. */
const TAKE_OVER_WITHIN = 10_000

/**
 * The running Jarvis's side. One handover at a time: once it has asked, every
 * launch that arrives waits on the same question; once it is making way, every
 * launch — and every retry of the one it is making way for, which reaches it as
 * another launch — is told to wait for the lock.
 *
 * `arrive` and `answer` return `{ act, tell }`: what to do ('open', 'ask',
 * 'make-way', 'keep' or 'none'), and the answers to write, `{ to, answer }`.
 */
function createHandover({ build }) {
  let phase = 'running'
  let waiting = []

  const to = (arriving) => (typeof arriving?.reply === 'string' && arriving.reply !== '' ? arriving.reply : null)
  const telling = (address, answer) => (address === null ? [] : [{ to: address, answer }])

  function arrive({ arriving, windowsOpen }) {
    const address = to(arriving)
    if (phase === 'making-way') return { act: 'none', tell: telling(address, 'making-way') }
    if (phase === 'asking') {
      if (address !== null && !waiting.includes(address)) waiting.push(address)
      return { act: 'none', tell: telling(address, 'asking') }
    }
    const decision = secondLaunch({ running: { build }, arriving, windowsOpen })
    if (decision === 'open') return { act: 'open', tell: telling(address, 'opened') }
    if (decision === 'replace') {
      phase = 'making-way'
      return { act: 'make-way', tell: telling(address, 'making-way') }
    }
    phase = 'asking'
    waiting = address === null ? [] : [address]
    return { act: 'ask', tell: telling(address, 'asking') }
  }

  /** The user's answer to the question: restart (true) or keep this one. */
  function answer(restart) {
    if (phase !== 'asking') return { act: 'none', tell: [] }
    const told = waiting
    waiting = []
    phase = restart ? 'making-way' : 'running'
    const said = restart ? 'making-way' : 'kept'
    return { act: restart ? 'make-way' : 'keep', tell: told.map((address) => ({ to: address, answer: said })) }
  }

  return { arrive, answer, phase: () => phase }
}

/**
 * The launch's side: what to do next, given the last answer read (null for
 * none yet), whether the Jarvis that gave it is still running, how long ago the
 * launch first asked, and how long ago it was first told to take the lock.
 *
 * @returns 'wait', 'try-lock', or how the launch ends: 'opened', 'kept',
 *          'no-answer' (an older Jarvis, which answers nothing, opened a window)
 *          or 'give-up' (the old one never let go).
 */
function launchStep({ answer, runningAlive, sinceSent, sinceMakingWay }) {
  const effective = answer === 'asking' && !runningAlive ? 'making-way' : answer
  if (effective === 'opened' || effective === 'kept') return effective
  if (effective === 'asking') return 'wait'
  if (effective === 'making-way') return sinceMakingWay < TAKE_OVER_WITHIN ? 'try-lock' : 'give-up'
  return sinceSent < ANSWER_WITHIN ? 'wait' : 'no-answer'
}

module.exports = { fingerprint, secondLaunch, createHandover, launchStep, ANSWER_WITHIN, TAKE_OVER_WITHIN }
