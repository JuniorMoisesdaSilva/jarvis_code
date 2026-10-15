import { describe, expect, it } from 'vitest'
import { initialDeck, reduce, sameView, view } from '../src/core/deck.js'
import { agentEvent } from '../src/core/hook-payload.js'
import { fixture } from './helpers.js'

// The Loops block — compactions, and the work of agent ids no SubagentStart named.
// Every sequence is made of real captured payloads, changed only where an agent
// needs its own id, type or task.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

const starts = (agent, type = 'advisor') => hook('subagent-start', { agent_id: agent, agent_type: type })
const stops = (agent, type = 'advisor') => hook('subagent-stop', { agent_id: agent, agent_type: type })
const step = (agent, id) => hook('pre-tool-use-in-subagent', { agent_id: agent, tool_use_id: id })
const stepEnds = (agent, id) => hook('post-tool-use', { agent_id: agent, agent_type: 'Explore', tool_use_id: id })
const spawn = (id, type, task) =>
  hook('pre-tool-use', {
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { description: task, prompt: `${task}, please.`, subagent_type: type },
  })
const prompt = () => hook('user-prompt-submit')
const stop = () => hook('stop-interactive')
const compacting = (trigger = 'auto') => hook('pre-compact', { trigger })
const compacted = (trigger = 'auto') => hook('post-compact', { trigger })

/** Each event at the time given beside it: `[event, at]`. */
function feedAt(pairs, deck = initialDeck()) {
  for (const [event, at] of pairs) deck = reduce(deck, event, at)
  return deck
}

const loops = (deck) => view(deck).loops

describe('the Loops block, before anything loops', () => {
  it('has no compactions and no strays', () => {
    expect(loops(initialDeck())).toEqual({ liveForMs: 30_000, graceMs: 3000, compactionLimitMs: 600_000, compactions: [], strays: [] })
  })
})

describe('a compaction in the Loops block', () => {
  it('runs from PreCompact, with its trigger and start', () => {
    const deck = feedAt([[compacting('manual'), 5000]])
    expect(loops(deck).compactions).toEqual([{ trigger: 'manual', running: true, startedAt: 5000, endedAt: null }])
  })

  it('ends at PostCompact, which gives how long it took', () => {
    const deck = feedAt([
      [compacting(), 5000],
      [compacted(), 47_000],
    ])
    expect(loops(deck).compactions).toEqual([{ trigger: 'auto', running: false, startedAt: 5000, endedAt: 47_000 }])
  })

  it('has no start when only its end was heard', () => {
    const deck = feedAt([[compacted(), 47_000]])
    expect(loops(deck).compactions).toEqual([{ trigger: 'auto', running: false, startedAt: null, endedAt: 47_000 }])
  })

  it('still marks the Gauge as before', () => {
    const deck = feedAt([[compacting(), 5000]])
    expect(view(deck).gauge.context.compactions).toEqual([{ percent: null, trigger: 'auto', running: true }])
  })
})

describe('an agent id that never started as a subagent', () => {
  it('is a stray: its short id, its steps, and when it was first and last seen', () => {
    const deck = feedAt([
      [step('a3f9c2e1b7d04e58', 's1'), 1000],
      [step('a3f9c2e1b7d04e58', 's2'), 4000],
    ])
    expect(loops(deck).strays).toEqual([
      { id: 'a3f9c2e1b7d04e58', short: 'a3f9c2e', steps: 2, firstSeen: 1000, lastSeen: 4000 },
    ])
  })

  it('is kept out of sight for its first three seconds, which its SubagentStart may still fill', () => {
    // Tool hooks are async: a subagent's first steps can beat its start here.
    // The renderer hides a stray until `graceMs` has passed since `firstSeen`.
    const deck = feedAt([[step('a1', 's1'), 1000]])
    expect(loops(deck).graceMs).toBe(3000)
    expect(loops(deck).strays[0].firstSeen).toBe(1000)
    const adopted = reduce(deck, starts('a1', 'Explore'), 1500)
    expect(loops(adopted).strays).toEqual([])
  })

  it('is seen again when one of its calls ends, without a step more', () => {
    const deck = feedAt([
      [step('w1', 's1'), 1000],
      [stepEnds('w1', 's1'), 9000],
    ])
    expect(loops(deck).strays).toEqual([{ id: 'w1', short: 'w1', steps: 1, firstSeen: 1000, lastSeen: 9000 }])
  })

  it('is shown as it changes, not kept to itself', () => {
    const before = feedAt([[step('w1', 's1'), 1000]])
    expect(sameView(initialDeck(), before)).toBe(false)
    expect(sameView(before, reduce(before, step('w1', 's2'), 2000))).toBe(false)
  })

  it('leaves the Loops for its card, with its steps, when its start is heard after all', () => {
    const deck = feedAt([
      [step('a1', 's1'), 1000],
      [step('a1', 's2'), 2000],
      [starts('a1', 'Explore'), 3000],
    ])
    expect(loops(deck).strays).toEqual([])
    expect(view(deck).agents.agents.find((each) => each.id === 'a1').steps).toBe(2)
  })

  it('leaves the Loops when only its stop is heard, taking its steps to the card', () => {
    const deck = feedAt([
      [step('a1', 's1'), 1000],
      [stops('a1', 'Explore'), 3000],
    ])
    expect(loops(deck).strays).toEqual([])
    expect(view(deck).agents.agents.find((each) => each.id === 'a1').steps).toBe(1)
  })

  it('keeps at most sixteen, the first seen going first', () => {
    const pairs = []
    for (let n = 1; n <= 20; n += 1) pairs.push([step(`w${n}`, `s${n}`), n * 1000])
    const ids = loops(feedAt(pairs)).strays.map((each) => each.id)
    expect(ids).toHaveLength(16)
    expect(ids[0]).toBe('w5')
  })

  it('outlives the turn and the next prompt', () => {
    const deck = feedAt([
      [step('w1', 's1'), 1000],
      [stop(), 2000],
      [prompt(), 3000],
    ])
    expect(loops(deck).strays.map((each) => each.id)).toEqual(['w1'])
  })
})
