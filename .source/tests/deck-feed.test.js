import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { user } from '../src/core/events.js'
import { decode, decodeStatus } from '../src/core/hook-payload.js'
import { createDeckFeed, hearAgentEvent, hearStatus } from '../src/main/deck-feed.js'
import { fixture } from './helpers.js'

// A busy Claude Code reports several tool calls a second. Each one feeds the
// Deck, and none of them is anything the core, the voice or the preferences
// file has to hear about: they go out together, at most once every 250 ms, and
// never write to the disk.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'
const PROJECT = 'C:\\Jarvis'
const TERMINAL = 'term-1'

function hook(name, changes = {}) {
  return decode({ ...JSON.parse(fixture(name)), session_id: SESSION, cwd: PROJECT, jarvis_terminal: TERMINAL, ...changes })
}

let published
let remembered
let ran

beforeEach(() => {
  vi.useFakeTimers()
  published = 0
  remembered = []
  ran = []
})

afterEach(() => {
  vi.useRealTimers()
})

/** A Session in miniature: its core, its Deck, and what reaching the outside counts as. */
function session() {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT, TERMINAL))
  const deck = createDeckFeed({
    publish: () => {
      published += 1
      deck.sent()
    },
    holds: (sessionId) => core.state.activeSessionId === sessionId,
    measure: async () => null,
  })
  const ports = {
    core,
    deck,
    remember: (sessionId) => remembered.push(sessionId),
    run: (effects) => {
      ran.push(effects)
      published += 1
      deck.sent()
    },
  }
  return { core, deck, hear: (incoming) => hearAgentEvent(incoming, ports) }
}

describe('a burst of tool calls', () => {
  it('goes out at most once, and writes nothing down', () => {
    const { hear } = session()
    hear(hook('user-prompt-submit'))
    published = 0
    remembered = []
    ran = []

    for (let n = 0; n < 20; n += 1) {
      hear(hook('pre-tool-use', { tool_use_id: `t${n}` }))
      hear(hook('post-tool-use', { tool_use_id: `t${n}`, tool_name: 'Edit', tool_input: { file_path: `C:\\f${n}.js` } }))
      vi.advanceTimersByTime(5)
    }
    expect(published).toBe(0)
    vi.advanceTimersByTime(250)

    expect(published).toBe(1)
    expect(remembered).toEqual([])
    expect(ran).toEqual([])
  })

  it('still reaches the Deck, all of it', () => {
    const { hear, deck } = session()
    hear(hook('user-prompt-submit'))
    for (let n = 0; n < 5; n += 1) {
      hear(hook('post-tool-use', { tool_use_id: `t${n}`, tool_name: 'Edit', tool_input: { file_path: `C:\\f${n}.js` } }))
    }
    expect(deck.view().events.filter((entry) => entry.kind === 'edit')).toHaveLength(5)
  })

  it('every kind the core ignores stays out of the preferences', () => {
    const { hear } = session()
    hear(hook('user-prompt-submit'))
    remembered = []
    for (const name of [
      'pre-tool-use',
      'post-tool-use',
      'post-tool-use-failure',
      'permission-denied',
      'subagent-start',
      'subagent-stop',
      'pre-compact',
      'post-compact',
      'stop-failure',
    ]) {
      hear(hook(name))
    }
    expect(remembered).toEqual([])
  })
})

describe('what still goes out at once', () => {
  it('the five events the core hears are remembered and published as before', () => {
    const { hear } = session()
    hear(hook('user-prompt-submit'))
    expect(remembered).toEqual([SESSION])
    expect(ran).toHaveLength(1)
  })

  it('a tool call that is the first word of a conversation adopts it, remembers it and publishes', () => {
    const { hear, core } = session()
    hear(hook('pre-tool-use'))
    expect(core.state.activeSessionId).toBe(SESSION)
    expect(remembered).toEqual([SESSION])
    expect(ran).toHaveLength(1)
  })
})

describe('a status reading on its way through the Session', () => {
  it('reaches the Deck of the conversation the Session holds, and nothing else', () => {
    const { hear, core, deck } = session()
    hear(hook('user-prompt-submit'))
    ran = []
    remembered = []
    const reading = decodeStatus({ ...JSON.parse(fixture('status-line')), session_id: SESSION, jarvis_reading: 'status' })
    hearStatus(reading, { core, deck })
    expect(deck.view().gauge.reported).toBe(true)
    expect(ran).toEqual([])
    expect(remembered).toEqual([])
  })
})

// A plan's sounds are played as the change is heard, not when the Deck next
// goes out: the window the plan belongs to is the one handed `chime`.
describe('a plan’s sounds', () => {
  const steps = (done) =>
    ['Read', 'Write', 'Draw'].map((label, n) => ({ label, status: n < done ? 'completed' : 'pending' }))
  const plan = (done) => hook('post-tool-use-update-plan', { tool_input: { steps: steps(done) } }).event

  function chiming(muted = false) {
    const chimes = []
    const deck = createDeckFeed({
      publish: () => deck.sent(),
      measure: async () => null,
      chime: (sound) => chimes.push(sound),
      muted: () => muted,
    })
    return { deck, chimes }
  }

  it('plays the step sound for a step done and the done sound for the last, at once', () => {
    const { deck, chimes } = chiming()
    deck.feed(hook('user-prompt-submit').event)
    deck.feed(plan(0))
    deck.feed(plan(1))
    expect(chimes).toEqual(['step'])
    deck.feed(plan(3))
    expect(chimes).toEqual(['step', 'done'])
  })

  it('plays nothing for a call that is not a plan', () => {
    const { deck, chimes } = chiming()
    deck.feed(hook('user-prompt-submit').event)
    deck.feed(hook('pre-tool-use').event)
    deck.feed(hook('post-tool-use').event)
    expect(chimes).toEqual([])
  })

  it('plays nothing while muted', () => {
    const { deck, chimes } = chiming(true)
    deck.feed(plan(0))
    deck.feed(plan(3))
    expect(chimes).toEqual([])
  })

  it('goes on quietly when playing the sound fails', () => {
    const deck = createDeckFeed({
      publish: () => deck.sent(),
      measure: async () => null,
      chime: () => {
        throw new Error('no panel')
      },
    })
    deck.feed(plan(0))
    expect(() => deck.feed(plan(1))).not.toThrow()
    expect(deck.view().plan.rows[0].done).toBe(1)
  })
})
