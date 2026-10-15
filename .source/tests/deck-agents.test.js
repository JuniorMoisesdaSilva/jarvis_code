import { describe, expect, it } from 'vitest'
import { initialDeck, reduce, sameView, view } from '../src/core/deck.js'
import { agentEvent } from '../src/core/hook-payload.js'
import { measured } from '../src/core/events.js'
import { fixture } from './helpers.js'

// The Agents block: each subagent with its task, type, steps and clock, and,
// once it has stopped, the tokens read from its transcript. Every sequence is
// made of real captured payloads, changed only where a second agent needs its
// own id, type or task.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

/** The main conversation's Agent tool call that spawns a subagent of `type` to do `task`. */
function spawn({ id, type = 'Explore', task = 'Find the installer', tool = 'Agent', background, launched } = {}) {
  const input = { description: task, prompt: `${task}, please.`, ...(type ? { subagent_type: type } : {}) }
  if (background !== undefined) input.run_in_background = background
  const same = { tool_name: tool, tool_use_id: id, tool_input: input }
  // How Claude Code answers an Agent call it sent off on its own, no flag asked.
  const response = launched ? { tool_response: { isAsync: true, status: 'async_launched', agentId: launched } } : {}
  return {
    starts: hook('pre-tool-use', same),
    finishes: hook('post-tool-use', { ...same, ...response }),
    fails: hook('post-tool-use-failure', { ...same, is_interrupt: true }),
  }
}

const starts = (agent, type = 'Explore') => hook('subagent-start', { agent_id: agent, agent_type: type })
const stops = (agent, type = 'Explore') => hook('subagent-stop', { agent_id: agent, agent_type: type })
const step = (agent, id) => hook('pre-tool-use-in-subagent', { agent_id: agent, tool_use_id: id })
const stepEnds = (agent, id) => hook('post-tool-use', { agent_id: agent, agent_type: 'Explore', tool_use_id: id })
const prompt = () => hook('user-prompt-submit')
const stop = () => hook('stop-interactive')
const stopFailure = () => hook('stop-failure')

function feed(events, deck = initialDeck()) {
  let at = 1_000_000
  for (const event of events) {
    at += 1000
    deck = reduce(deck, event, at)
  }
  return deck
}

const agents = (deck) => view(deck).agents
const card = (deck, id) => agents(deck).agents.find((each) => each.id === id)

describe('the Agents block, before any subagent', () => {
  it('has no agents and nothing running', () => {
    expect(agents(initialDeck())).toEqual({ running: 0, done: 0, failed: 0, quietForMs: 3_600_000, agents: [] })
  })
})

describe('a subagent at work', () => {
  it('is shown with the task its Agent call gave it, its type, and when it started', () => {
    const explore = spawn({ id: 'toolu_spawn' })
    const deck = feed([explore.starts, starts('a1')])
    expect(agents(deck)).toEqual({
      running: 1,
      done: 0,
      failed: 0,
      quietForMs: 3_600_000,
      agents: [
        {
          id: 'a1',
          type: 'Explore',
          task: 'Find the installer',
          steps: 0,
          startedAt: 1_002_000,
          lastSeen: 1_002_000,
          endedAt: null,
          status: 'running',
          tokens: null,
          outOfOutput: null,
        },
      ],
    })
  })

  it('counts each tool call carrying its id as a step, and the change is shown', () => {
    const explore = spawn({ id: 'toolu_spawn' })
    const before = feed([explore.starts, starts('a1')])
    const after = feed([step('a1', 'toolu_s1'), stepEnds('a1', 'toolu_s1'), step('a1', 'toolu_s2'), step('a1', 'toolu_s3')], before)
    expect(card(after, 'a1').steps).toBe(3)
    expect(sameView(before, reduce(before, step('a1', 'toolu_s1'), 1_003_000))).toBe(false)
  })

  it('does not count the same call twice', () => {
    const deck = feed([starts('a1'), step('a1', 'toolu_s1'), step('a1', 'toolu_s1')])
    expect(card(deck, 'a1').steps).toBe(1)
  })

  it('does not count the main conversation’s calls, nor another agent’s', () => {
    const deck = feed([starts('a1'), starts('a2'), step('a2', 'toolu_s1'), hook('pre-tool-use')])
    expect(card(deck, 'a1').steps).toBe(0)
    expect(card(deck, 'a2').steps).toBe(1)
  })

  it('matches tasks to agents by type, in the order they were spawned', () => {
    const deck = feed([
      spawn({ id: 't1', type: 'Explore', task: 'Find the installer' }).starts,
      spawn({ id: 't2', type: 'Plan', task: 'Plan the change' }).starts,
      spawn({ id: 't3', type: 'Explore', task: 'Find the tests' }).starts,
      starts('a2', 'Plan'),
      starts('a1', 'Explore'),
      starts('a3', 'Explore'),
    ])
    expect(agents(deck).agents.map((each) => [each.id, each.task])).toEqual([
      ['a2', 'Plan the change'],
      ['a1', 'Find the installer'],
      ['a3', 'Find the tests'],
    ])
  })

  it('takes an Agent call without a type as a general-purpose one', () => {
    const deck = feed([spawn({ id: 't1', type: null, task: 'Look around' }).starts, starts('a1', 'general-purpose')])
    expect(card(deck, 'a1').task).toBe('Look around')
  })

  it('still finds its task when the Agent call is heard after the subagent started', () => {
    const deck = feed([starts('a1'), spawn({ id: 't1', task: 'Find the installer' }).starts])
    expect(card(deck, 'a1').task).toBe('Find the installer')
  })

  it('has no task when no Agent call spoke of it — the type stands in', () => {
    expect(card(feed([starts('a1')]), 'a1').task).toBeNull()
  })

  it('keeps the steps it took before its start was heard', () => {
    const deck = feed([step('a1', 'toolu_s1'), step('a1', 'toolu_s2'), starts('a1')])
    expect(card(deck, 'a1').steps).toBe(2)
  })

  it('masks a secret in the task', () => {
    const deck = feed([spawn({ id: 't1', task: 'Try token ghp_abcdefghijklmnopqrstuvwxyz0123456789' }).starts, starts('a1')])
    expect(card(deck, 'a1').task).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  })
})

describe('a subagent finishing', () => {
  it('is done when it stops, with when it ended', () => {
    const deck = feed([spawn({ id: 't1' }).starts, starts('a1'), step('a1', 's1'), stops('a1')])
    expect(card(deck, 'a1')).toMatchObject({ status: 'done', startedAt: 1_002_000, endedAt: 1_004_000, steps: 1 })
    expect(agents(deck)).toMatchObject({ running: 0, done: 1, failed: 0 })
  })

  it('shows the tokens and the out-of-output flag read from its transcript', () => {
    const figures = { tokens: { input: 15, output: 32000, cacheRead: 6400, cacheCreation: 400 }, outOfOutput: true }
    const deck = feed([starts('a1'), stops('a1'), measured.subagent(SESSION, 'a1', figures)])
    expect(card(deck, 'a1')).toMatchObject({
      tokens: { input: 15, output: 32000, cacheRead: 6400, cacheCreation: 400, total: 38815 },
      outOfOutput: true,
    })
  })

  it('stays blank when its transcript could not be read', () => {
    const deck = feed([starts('a1'), stops('a1'), measured.subagent(SESSION, 'a1', null)])
    expect(card(deck, 'a1')).toMatchObject({ status: 'done', tokens: null, outOfOutput: null })
  })

  it('has failed when the Agent call that spawned it failed or was interrupted', () => {
    const explore = spawn({ id: 't1' })
    const deck = feed([explore.starts, starts('a1'), explore.fails])
    expect(card(deck, 'a1')).toMatchObject({ status: 'failed', endedAt: 1_003_000 })
    expect(agents(deck)).toMatchObject({ running: 0, failed: 1 })
  })

  it('is closed by the end of the turn when its own stop was never heard', () => {
    expect(card(feed([starts('a1'), stop()]), 'a1').status).toBe('done')
    expect(card(feed([starts('a1'), stopFailure()]), 'a1').status).toBe('failed')
  })

  it('keeps running past the end of the turn when it was spawned in the background', () => {
    const deck = feed([spawn({ id: 't1', background: true }).starts, starts('a1'), spawn({ id: 't1', background: true }).finishes, stop()])
    expect(card(deck, 'a1').status).toBe('running')
  })

  it('keeps running past the end of the turn when Claude Code launched it on its own', () => {
    const explore = spawn({ id: 't1', launched: 'a1' })
    const deck = feed([explore.starts, starts('a1'), explore.finishes, stop(), step('a1', 's1')])
    expect(card(deck, 'a1')).toMatchObject({ status: 'running', endedAt: null, steps: 1, task: 'Find the installer' })
    expect(card(feed([stops('a1')], deck), 'a1')).toMatchObject({ status: 'done', endedAt: 1_001_000 })
  })

  it('keeps its task and runs on when the launch is heard before its start', () => {
    const explore = spawn({ id: 't1', launched: 'a1' })
    const deck = feed([explore.starts, explore.finishes, starts('a1'), stop()])
    expect(card(deck, 'a1')).toMatchObject({ status: 'running', task: 'Find the installer' })
  })

  it('runs again when it is heard at work after the end of the turn closed it', () => {
    const deck = feed([starts('a1'), stop(), step('a1', 's1')])
    expect(card(deck, 'a1')).toMatchObject({ status: 'running', endedAt: null, steps: 1 })
    expect(card(feed([stops('a1')], deck), 'a1')).toMatchObject({ status: 'done', endedAt: 1_001_000 })
  })

  it('is shown although only its stop was heard', () => {
    const deck = feed([stops('a1')])
    expect(card(deck, 'a1')).toMatchObject({ status: 'done', startedAt: null, endedAt: 1_001_000 })
  })

  it('stays in view until the next prompt, which keeps only the agents still running', () => {
    const deck = feed([starts('a1'), stops('a1'), spawn({ id: 't2', background: true }).starts, starts('a2'), stop()])
    expect(agents(deck).agents.map((each) => each.id)).toEqual(['a1', 'a2'])
    expect(agents(feed([prompt()], deck)).agents.map((each) => each.id)).toEqual(['a2'])
  })

  it('keeps at most 24 agents, the oldest finished ones going first', () => {
    const many = []
    for (let n = 1; n <= 30; n += 1) many.push(starts(`a${n}`), stops(`a${n}`))
    const deck = feed([starts('long'), ...many])
    const ids = agents(deck).agents.map((each) => each.id)
    expect(ids).toHaveLength(24)
    expect(ids[0]).toBe('long')
    expect(ids.at(-1)).toBe('a30')
  })
})

describe('what the Agents block leaves to others', () => {
  it('starts afresh with a new conversation', () => {
    const deck = feed([starts('a1')])
    const other = hook('subagent-start', { session_id: 'another-session', agent_id: 'b1' })
    expect(agents(reduce(deck, other, 2_000_000)).agents.map((each) => each.id)).toEqual(['b1'])
  })
})
