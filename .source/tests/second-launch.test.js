import { describe, expect, it } from 'vitest'
import {
  ANSWER_WITHIN,
  TAKE_OVER_WITHIN,
  createHandover,
  fingerprint,
  launchStep,
  secondLaunch,
} from '../src/core/second-launch.js'

// A second launch of Jarvis does not start a copy: the one already running
// opens a window. That is right while both are the same code, and was the
// whole of the bug in `Docs/history/the-deck-plan/diario.md` (13 out) when they
// were not: a Jarvis left in the tray since the morning took the launch of the
// afternoon's checkout, drew the new page with its old main process, dropped
// every Mods click on the floor and connected Claude Code with the old five
// hooks.

const file = (name, text) => ({ name, text })

describe('the fingerprint of the code a launch carries', () => {
  it('is the same for the same files, in any order', () => {
    const a = [file('src/main/main.js', 'one'), file('src/core/deck.js', 'two')]
    expect(fingerprint(a)).toBe(fingerprint([...a].reverse()))
  })

  it('changes when a file changes, appears or goes', () => {
    const base = [file('src/main/main.js', 'one'), file('src/core/deck.js', 'two')]
    const was = fingerprint(base)
    expect(fingerprint([file('src/main/main.js', 'one!'), base[1]])).not.toBe(was)
    expect(fingerprint([...base, file('src/core/plan-tool.js', '')])).not.toBe(was)
    expect(fingerprint([base[0]])).not.toBe(was)
  })

  it('tells a moved name from moved text', () => {
    expect(fingerprint([file('a', 'bc')])).not.toBe(fingerprint([file('ab', 'c')]))
  })
})

describe('what the running Jarvis does with a second launch', () => {
  const running = { build: 'morning' }

  it('opens a window when the launch is the same code', () => {
    expect(secondLaunch({ running, arriving: { build: 'morning' }, windowsOpen: 0 })).toBe('open')
    expect(secondLaunch({ running, arriving: { build: 'morning' }, windowsOpen: 2 })).toBe('open')
  })

  it('makes way for different code when no window is open', () => {
    // The user closed the window, which leaves Jarvis in the tray, and started
    // it again: there is nothing of theirs to lose.
    expect(secondLaunch({ running, arriving: { build: 'afternoon' }, windowsOpen: 0 })).toBe('replace')
  })

  it('asks before closing windows that are open', () => {
    // Each window has a terminal, very likely with Claude Code running in it.
    expect(secondLaunch({ running, arriving: { build: 'afternoon' }, windowsOpen: 1 })).toBe('ask')
  })

  it('takes a launch that says nothing about its code for the same code', () => {
    // A launch from an older Jarvis carries no fingerprint; replacing a newer
    // one with it would be the same bug the other way round.
    expect(secondLaunch({ running, arriving: undefined, windowsOpen: 0 })).toBe('open')
    expect(secondLaunch({ running, arriving: {}, windowsOpen: 0 })).toBe('open')
  })
})

// The handover itself. The running Jarvis does not start the new launch: it
// answers it, and quits. The launch, which kept waiting, takes the lock once it
// is free and starts as itself — with its own environment, its own folder and
// its own console, none of which the old process could hand on. One handover
// at a time: launches that arrive during one wait on it, and are never asked
// about twice.
describe('the running Jarvis handing over to a launch of different code', () => {
  const afternoon = (reply) => ({ build: 'afternoon', reply })

  it('answers a launch of the same code with a window', () => {
    const handover = createHandover({ build: 'morning' })
    expect(handover.arrive({ arriving: { build: 'morning', reply: 'a' }, windowsOpen: 1 })).toEqual({
      act: 'open',
      tell: [{ to: 'a', answer: 'opened' }],
    })
  })

  it('makes way at once when no window is open, and says so', () => {
    const handover = createHandover({ build: 'morning' })
    expect(handover.arrive({ arriving: afternoon('a'), windowsOpen: 0 })).toEqual({
      act: 'make-way',
      tell: [{ to: 'a', answer: 'making-way' }],
    })
  })

  it('makes way only once: a launch arriving meanwhile is told to wait for the lock', () => {
    // The launch that is waiting tries the lock again and again, and each try
    // reaches the old Jarvis as another launch. None of them may start a second
    // handover.
    const handover = createHandover({ build: 'morning' })
    handover.arrive({ arriving: afternoon('a'), windowsOpen: 0 })
    expect(handover.arrive({ arriving: afternoon('a'), windowsOpen: 0 })).toEqual({
      act: 'none',
      tell: [{ to: 'a', answer: 'making-way' }],
    })
    expect(handover.arrive({ arriving: { build: 'morning', reply: 'b' }, windowsOpen: 0 })).toEqual({
      act: 'none',
      tell: [{ to: 'b', answer: 'making-way' }],
    })
  })

  it('asks once when windows are open; a launch arriving meanwhile waits on the same question', () => {
    const handover = createHandover({ build: 'morning' })
    expect(handover.arrive({ arriving: afternoon('a'), windowsOpen: 2 })).toEqual({
      act: 'ask',
      tell: [{ to: 'a', answer: 'asking' }],
    })
    expect(handover.arrive({ arriving: afternoon('b'), windowsOpen: 2 })).toEqual({
      act: 'none',
      tell: [{ to: 'b', answer: 'asking' }],
    })
    // The same launch again is not a second launch waiting.
    handover.arrive({ arriving: afternoon('a'), windowsOpen: 2 })

    expect(handover.answer(true)).toEqual({
      act: 'make-way',
      tell: [
        { to: 'a', answer: 'making-way' },
        { to: 'b', answer: 'making-way' },
      ],
    })
    // And once making way, it stays making way.
    expect(handover.arrive({ arriving: afternoon('c'), windowsOpen: 2 }).act).toBe('none')
    expect(handover.answer(true)).toEqual({ act: 'none', tell: [] })
  })

  it('keeps itself when told to, tells every launch waiting, and answers the next one afresh', () => {
    const handover = createHandover({ build: 'morning' })
    handover.arrive({ arriving: afternoon('a'), windowsOpen: 1 })
    handover.arrive({ arriving: afternoon('b'), windowsOpen: 1 })
    expect(handover.answer(false)).toEqual({
      act: 'keep',
      tell: [
        { to: 'a', answer: 'kept' },
        { to: 'b', answer: 'kept' },
      ],
    })
    expect(handover.arrive({ arriving: afternoon('c'), windowsOpen: 1 }).act).toBe('ask')
  })

  it('has nobody to tell when the launch gave no address — an older Jarvis', () => {
    const handover = createHandover({ build: 'morning' })
    expect(handover.arrive({ arriving: undefined, windowsOpen: 0 })).toEqual({ act: 'open', tell: [] })
    expect(handover.arrive({ arriving: { build: 'afternoon' }, windowsOpen: 0 })).toEqual({ act: 'make-way', tell: [] })
  })
})

describe('the launch, while the running Jarvis answers', () => {
  const step = (over) => launchStep({ answer: null, runningAlive: true, sinceSent: 0, sinceMakingWay: 0, ...over })

  it('waits a moment for an answer, then takes the silence for a window opened by an older Jarvis', () => {
    expect(step({ sinceSent: 100 })).toBe('wait')
    expect(step({ sinceSent: ANSWER_WITHIN })).toBe('no-answer')
  })

  it('leaves when a window was opened, or the running Jarvis was kept', () => {
    expect(step({ answer: 'opened' })).toBe('opened')
    expect(step({ answer: 'kept' })).toBe('kept')
  })

  it('waits for as long as the user is being asked', () => {
    expect(step({ answer: 'asking', sinceSent: 10 * 60_000 })).toBe('wait')
  })

  it('tries the lock while the running Jarvis makes way, and gives up after a while', () => {
    expect(step({ answer: 'making-way', sinceMakingWay: 0 })).toBe('try-lock')
    expect(step({ answer: 'making-way', sinceMakingWay: TAKE_OVER_WITHIN - 1 })).toBe('try-lock')
    expect(step({ answer: 'making-way', sinceMakingWay: TAKE_OVER_WITHIN })).toBe('give-up')
    expect(TAKE_OVER_WITHIN).toBe(10_000)
  })

  it('tries the lock when the Jarvis asking went away without an answer', () => {
    expect(step({ answer: 'asking', runningAlive: false })).toBe('try-lock')
  })
})
