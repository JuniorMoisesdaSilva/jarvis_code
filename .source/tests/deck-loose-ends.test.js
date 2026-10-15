import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { user } from '../src/core/events.js'
import { agentEvent, decode } from '../src/core/hook-payload.js'
import { initialDeck, reduce, view } from '../src/core/deck.js'
import { settled } from '../src/core/deck-chips.js'
import { fixture } from './helpers.js'

// What the async hooks leave loose: a turn ended by Escape (no Stop at all)
// or by a Stop with nothing to say, a
// compaction or a subagent whose end never arrives, and many strays at once.
// The Deck must neither lose what happened nor keep a clock running forever.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'
const MINUTE = 60_000

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

const prompt = () => hook('user-prompt-submit')
const stop = () => hook('stop-interactive')
const blankStop = () => hook('stop-interactive', { last_assistant_message: '' })
const starts = (id, tool = 'Edit') => hook('pre-tool-use', { tool_use_id: id, tool_name: tool, tool_input: { file_path: `C:\\${id}.js` } })
const failed = (id, interrupted = false, agent = null) =>
  hook('post-tool-use-failure', {
    tool_use_id: id,
    is_interrupt: interrupted,
    ...(agent ? { agent_id: agent, agent_type: 'Explore' } : {}),
  })
const spawn = (id, type, background = false) =>
  hook('pre-tool-use', {
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { description: `Task ${id}`, prompt: 'Go.', subagent_type: type, run_in_background: background },
  })
const agentStarts = (agent, type = 'Explore') => hook('subagent-start', { agent_id: agent, agent_type: type })
const step = (agent, id) => hook('pre-tool-use-in-subagent', { agent_id: agent, tool_use_id: id })
const compacting = () => hook('pre-compact', { trigger: 'auto' })
const compacted = () => hook('post-compact', { trigger: 'auto' })
const ended = () => ({ type: 'sessionEnded', sessionId: SESSION })

function feedAt(pairs, deck = initialDeck()) {
  for (const [event, at] of pairs) deck = reduce(deck, event, at)
  return deck
}

describe('a Stop with nothing to say', () => {
  it('is heard by the Deck as the end of the turn', () => {
    const decoded = decode({ ...JSON.parse(fixture('stop-interactive')), session_id: SESSION, last_assistant_message: '   ' })
    expect(decoded.event.type).toBe('turnEnded')

    const deck = feedAt([
      [prompt(), 1000],
      [agentStarts('a1'), 1200],
      [decoded.event, 2000],
    ])
    expect(view(deck).agents).toMatchObject({ running: 0, done: 1 })
  })

  it('leaves the core as it was: nothing spoken, nothing written', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened('C:\\Jarvis', 'term'))
    core.dispatch(user.autoReadSet(true))
    const said = core.receive(decode({ ...JSON.parse(fixture('stop-interactive')), cwd: 'C:\\Jarvis', last_assistant_message: '' }))
    expect(said).toEqual([])
    expect(core.state.lastAssistantText).toBeFalsy()
  })
})

describe('Escape, which sends no Stop', () => {
  const deck = feedAt([
    [prompt(), 1000],
    [spawn('s1', 'Explore'), 1100],
    [agentStarts('a1'), 1200],
    [starts('b1', 'Bash'), 1300],
    [failed('b1', true), 2000],
  ])

  it('ends the turn, and the subagents it was running', () => {
    expect(view(deck).agents).toMatchObject({ running: 0, failed: 1 })
  })

  it('is not the end of the turn when it is a subagent’s call that was interrupted', () => {
    const still = feedAt([
      [prompt(), 1000],
      [agentStarts('a1'), 1200],
      [failed('b2', true, 'a1'), 2000],
    ])
    expect(view(still).agents.running).toBe(1)
  })

  it('is not the end of the turn when the call interrupted began in the turn before', () => {
    const late = feedAt([
      [prompt(), 1000],
      [starts('b0', 'Bash'), 1100],
      [prompt(), 1500],
      [agentStarts('a1'), 1600],
      [failed('b0', true), 2000],
    ])
    expect(view(late).agents.running).toBe(1)
  })
})

describe('a compaction whose end never arrives', () => {
  it('stops counting as running after ten minutes', () => {
    const deck = feedAt([
      [compacting(), 0],
      [prompt(), 10 * MINUTE + 1],
    ])
    expect(view(deck).loops.compactions).toMatchObject([{ running: false, endedAt: null }])
  })

  it('is still closed by an end that arrives late, without counting twice', () => {
    const deck = feedAt([
      [compacting(), 0],
      [prompt(), 10 * MINUTE + 1],
      [compacted(), 11 * MINUTE],
    ])
    expect(view(deck).loops.compactions).toHaveLength(1)
    expect(view(deck).loops.compactions[0]).toMatchObject({ running: false, startedAt: 0, endedAt: 11 * MINUTE })
  })

  it('stops the renderer’s clock by its own clock, with no input at all', () => {
    const loops = view(feedAt([[compacting(), 0]])).loops
    expect(settled('loops', loops, 5 * MINUTE).compactions[0].running).toBe(true)
    expect(settled('loops', loops, 10 * MINUTE).compactions[0].running).toBe(false)
  })
})

describe('a background subagent whose stop never arrives', () => {
  const running = feedAt([
    [prompt(), 0],
    [spawn('s1', 'Explore', true), 100],
    [agentStarts('a1'), 200],
    [step('a1', 'x1'), 1000],
    [stop(), 2000],
  ])

  it('keeps running past the turn, as background agents do', () => {
    expect(view(running).agents.running).toBe(1)
  })

  it('stops counting as running after an hour with no step', () => {
    const quiet = reduce(running, prompt(), 1000 + 60 * MINUTE)
    expect(view(quiet).agents.running).toBe(0)
  })

  it('is let go when the conversation ends', () => {
    expect(view(reduce(running, ended(), 3000)).agents.running).toBe(0)
  })

  it('stops the renderer’s clock by its own clock, with no input at all', () => {
    const agents = view(running).agents
    expect(settled('agents', agents, 30 * MINUTE).running).toBe(1)
    expect(settled('agents', agents, 1000 + 60 * MINUTE)).toMatchObject({ running: 0, done: 1 })
  })
})

describe('more strays than are kept', () => {
  it('lets the least recently seen go first, whatever their ids look like', () => {
    let deck = initialDeck()
    for (let n = 0; n < 16; n += 1) deck = reduce(deck, step(String(100 + n), `t${n}`), 1000 + n)
    deck = reduce(deck, step('100', 'again'), 2000)
    deck = reduce(deck, step('200', 'last'), 2001)
    const ids = view(deck).loops.strays.map((stray) => stray.id)
    expect(ids).toHaveLength(16)
    expect(ids).toContain('100')
    expect(ids).toContain('200')
    expect(ids).not.toContain('101')
  })
})
