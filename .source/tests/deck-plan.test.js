import { describe, expect, it } from 'vitest'
import { initialDeck, planSound, reduce, view } from '../src/core/deck.js'
import { agentEvent } from '../src/core/hook-payload.js'
import { fixture } from './helpers.js'

// The Plan block: one row per plan — the main conversation's and each
// subagent's — with done/total and the step under way, and the main plan's
// steps. Fed by Jarvis's own plan tool, by Claude Code's todo list and by its
// task tools, all heard as the calls finish. Every sequence is made of
// real-shaped payloads, changed only where a step needs another status.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

const plan = (steps, changes = {}) =>
  hook('post-tool-use-update-plan', { tool_input: { steps }, ...changes })
const agentPlan = (agent, steps) =>
  hook('post-tool-use-update-plan-in-subagent', { agent_id: agent, tool_input: { steps } })
const todos = (list) => hook('post-tool-use-todo-write', { tool_input: { todos: list } })
const taskCreate = (id, subject, activeForm) =>
  hook('post-tool-use-task-create', {
    tool_input: { subject, description: subject, activeForm },
    tool_response: { task: { id, subject } },
  })
const taskUpdate = (taskId, input) => hook('post-tool-use-task-update', { tool_input: { taskId, ...input } })
const prompt = () => hook('user-prompt-submit')
const starts = (agent, type = 'Explore') => hook('subagent-start', { agent_id: agent, agent_type: type })
const stops = (agent, type = 'Explore') => hook('subagent-stop', { agent_id: agent, agent_type: type })
const spawned = (id, task, type = 'Explore') =>
  hook('pre-tool-use', {
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { description: task, prompt: task, subagent_type: type },
  })

function feed(events, deck = initialDeck()) {
  let at = 1_000_000
  for (const event of events) {
    deck = reduce(deck, event, at)
    at += 1000
  }
  return deck
}

const planOf = (deck) => view(deck).plan

const THREE = [
  { label: 'Read the ticket', status: 'completed' },
  { label: 'Write the reducer', status: 'in_progress', activeLabel: 'Writing the reducer' },
  { label: 'Draw the block', status: 'pending' },
]

describe('decoding what feeds a plan', () => {
  it('reads the steps of Jarvis’s own plan tool', () => {
    expect(agentEvent(fixture('post-tool-use-update-plan')).plan).toEqual({
      kind: 'replace',
      steps: [
        { label: 'Read the ticket', activeLabel: null, status: 'completed' },
        { label: 'Write the reducer', activeLabel: 'Writing the reducer', status: 'in_progress' },
        { label: 'Draw the block', activeLabel: null, status: 'pending' },
      ],
    })
  })

  it('reads the same tool under the names the terminal mods gave it', () => {
    for (const name of ['mcp__jarvis-flightdeck__update_plan', 'mcp__plan-progress__update_plan']) {
      expect(agentEvent({ ...JSON.parse(fixture('post-tool-use-update-plan')), tool_name: name }).plan?.kind).toBe(
        'replace',
      )
    }
  })

  it('reads a todo list as the whole plan', () => {
    expect(agentEvent(fixture('post-tool-use-todo-write')).plan.steps[1]).toEqual({
      label: 'Write the reducer',
      activeLabel: 'Writing the reducer',
      status: 'in_progress',
    })
  })

  it('reads a task created, with the id its response gave it', () => {
    expect(agentEvent(fixture('post-tool-use-task-create')).plan).toEqual({
      kind: 'add',
      step: { id: '1', label: 'Write the reducer', activeLabel: 'Writing the reducer', status: 'pending' },
    })
  })

  it('reads a task updated', () => {
    expect(agentEvent(fixture('post-tool-use-task-update')).plan).toEqual({
      kind: 'update',
      id: '1',
      status: 'in_progress',
      label: null,
      activeLabel: null,
    })
  })

  it('reads nothing into any other call', () => {
    expect(agentEvent(fixture('post-tool-use')).plan).toBeNull()
  })

  it('reads nothing from steps that are not a list', () => {
    expect(plan('everything').plan).toBeNull()
  })
})

describe('the main conversation’s plan', () => {
  it('is nothing before any plan', () => {
    expect(planOf(initialDeck())).toEqual({ rows: [], steps: [] })
  })

  it('draws a row with done, total and the step under way, and lists its steps', () => {
    const deck = feed([prompt(), plan(THREE)])
    expect(planOf(deck)).toEqual({
      rows: [
        { id: 'main', title: 'Main', done: 1, total: 3, current: 'Writing the reducer', finished: false, inAgent: false },
      ],
      steps: [
        { label: 'Read the ticket', status: 'completed' },
        { label: 'Write the reducer', status: 'in_progress' },
        { label: 'Draw the block', status: 'pending' },
      ],
    })
  })

  it('takes each new call as the whole plan', () => {
    const deck = feed([
      prompt(),
      plan(THREE),
      plan(THREE.map((step, index) => ({ ...step, status: index < 2 ? 'completed' : 'in_progress' }))),
    ])
    expect(planOf(deck).rows[0]).toMatchObject({ done: 2, total: 3, current: 'Draw the block' })
  })

  it('is finished once every step is done, and goes at the next prompt', () => {
    const done = THREE.map((step) => ({ ...step, status: 'completed' }))
    const finished = feed([prompt(), plan(THREE), plan(done)])
    expect(planOf(finished).rows[0]).toMatchObject({ done: 3, total: 3, current: null, finished: true })

    expect(planOf(feed([prompt()], finished))).toEqual({ rows: [], steps: [] })
  })

  it('stays across a prompt while it is unfinished', () => {
    const deck = feed([prompt(), plan(THREE), prompt()])
    expect(planOf(deck).rows).toHaveLength(1)
  })

  it('masks what a step says', () => {
    const deck = feed([prompt(), plan([{ label: 'Rotate the key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', status: 'pending' }])])
    expect(planOf(deck).steps[0].label).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789')
  })

  it('is fed by the todo list the same way', () => {
    const deck = feed([prompt(), todos(JSON.parse(fixture('post-tool-use-todo-write')).tool_input.todos)])
    expect(planOf(deck).rows[0]).toMatchObject({ done: 1, total: 3, current: 'Writing the reducer' })
  })

  it('is built task by task from the task tools', () => {
    const deck = feed([
      prompt(),
      taskCreate('1', 'Read the ticket', 'Reading the ticket'),
      taskCreate('2', 'Write the reducer', 'Writing the reducer'),
      taskUpdate('1', { status: 'completed' }),
      taskUpdate('2', { status: 'in_progress' }),
    ])
    expect(planOf(deck).rows[0]).toMatchObject({ done: 1, total: 2, current: 'Writing the reducer' })
    expect(planOf(deck).steps).toEqual([
      { label: 'Read the ticket', status: 'completed' },
      { label: 'Write the reducer', status: 'in_progress' },
    ])
  })

  it('lets a deleted task go', () => {
    const deck = feed([
      prompt(),
      taskCreate('1', 'Read the ticket'),
      taskCreate('2', 'Write the reducer'),
      taskUpdate('1', { status: 'deleted' }),
    ])
    expect(planOf(deck).steps).toEqual([{ label: 'Write the reducer', status: 'pending' }])
  })

  it('changes nothing for an update to a task it never heard created', () => {
    const before = feed([prompt()])
    expect(reduce(before, taskUpdate('9', { status: 'completed' }), 5_000_000).plans).toBe(before.plans)
  })
})

describe('a subagent’s own plan', () => {
  it('gets a row of its own, titled by the task it was spawned for', () => {
    const deck = feed([
      prompt(),
      plan(THREE),
      spawned('toolu_spawn_1', 'Find the installer'),
      starts('a3f9c2e1b7d04e58'),
      agentPlan('a3f9c2e1b7d04e58', [
        { label: 'Find the installer', status: 'completed' },
        { label: 'Read its tests', status: 'in_progress' },
      ]),
    ])
    const { rows, steps } = planOf(deck)
    expect(rows.map((row) => row.id)).toEqual(['main', 'a3f9c2e1b7d04e58'])
    expect(rows[1]).toEqual({
      id: 'a3f9c2e1b7d04e58',
      title: 'Find the installer',
      done: 1,
      total: 2,
      current: 'Read its tests',
      finished: false,
      inAgent: true,
    })
    // The steps listed are the main plan's alone.
    expect(steps).toHaveLength(3)
  })

  it('is named by the agent’s type when no task was heard', () => {
    const deck = feed([prompt(), agentPlan('b1', [{ label: 'Look', status: 'pending' }])])
    expect(planOf(deck).rows[0].title).toBe('Explore')
  })

  it('finishes when its subagent stops, and goes at the next prompt', () => {
    const running = feed([
      prompt(),
      starts('a3f9c2e1b7d04e58'),
      agentPlan('a3f9c2e1b7d04e58', [
        { label: 'Find the installer', status: 'completed' },
        { label: 'Read its tests', status: 'pending' },
      ]),
    ])
    const stopped = feed([stops('a3f9c2e1b7d04e58')], running)
    expect(planOf(stopped).rows[0]).toMatchObject({ done: 2, total: 2, finished: true })
    expect(planOf(feed([prompt()], stopped)).rows).toEqual([])
  })

  it('leaves the main plan alone when it changes', () => {
    const deck = feed([prompt(), plan(THREE), agentPlan('b1', [{ label: 'Look', status: 'completed' }])])
    expect(planOf(deck).rows[0]).toMatchObject({ id: 'main', done: 1, total: 3 })
  })
})

describe('a new conversation', () => {
  it('starts with no plan', () => {
    const deck = feed([prompt(), plan(THREE)])
    const other = reduce(deck, { ...prompt(), sessionId: 'another' }, 9_000_000)
    expect(planOf(other)).toEqual({ rows: [], steps: [] })
  })
})

// The two sounds, as the terminal mod chose them: the done sound when a plan is
// finished that was not before — its last step done, or its subagent ended —
// the step sound when more steps are done than before, the done sound winning
// when both; nothing at all while muted.
describe('the sound a change of plans earns', () => {
  const sound = (before, events, muted = false) => {
    const after = feed(events, before)
    return planSound(before.plans, after.plans, muted)
  }
  const started = feed([prompt(), plan(THREE)])

  it('is the step sound when one more step is done', () => {
    const next = THREE.map((step, n) => (n === 1 ? { ...step, status: 'completed' } : step))
    expect(sound(started, [plan(next)])).toBe('step')
  })

  it('is the done sound when the last step is done, not the step sound', () => {
    const all = THREE.map((step) => ({ ...step, status: 'completed' }))
    expect(sound(started, [plan(all)])).toBe('done')
  })

  it('is nothing when a step only starts', () => {
    const next = THREE.map((step, n) => (n === 2 ? { ...step, status: 'in_progress' } : step))
    expect(sound(started, [plan(next)])).toBe('none')
  })

  it('is the step sound for a first plan that comes with a step done, nothing for one with none', () => {
    expect(sound(feed([prompt()]), [plan(THREE)])).toBe('step')
    expect(sound(feed([prompt()]), [plan(THREE.map((step) => ({ ...step, status: 'pending' })))])).toBe('none')
  })

  it('is nothing when a finished plan goes at the next prompt', () => {
    const finished = feed([plan(THREE.map((step) => ({ ...step, status: 'completed' })))], started)
    expect(sound(finished, [prompt()])).toBe('none')
  })

  it('is nothing when a finished plan is told again, still finished', () => {
    const all = THREE.map((step) => ({ ...step, status: 'completed' }))
    const finished = feed([plan(all)], started)
    expect(sound(finished, [plan(all)])).toBe('none')
  })

  it('is the done sound when a subagent ends with its plan unfinished, as the mod played it', () => {
    const running = feed([
      prompt(),
      starts('a3f9c2e1b7d04e58'),
      agentPlan('a3f9c2e1b7d04e58', [
        { label: 'Find the installer', status: 'completed' },
        { label: 'Read its tests', status: 'pending' },
      ]),
    ])
    expect(sound(running, [stops('a3f9c2e1b7d04e58')])).toBe('done')
  })

  it('is the step sound for a step done in a subagent’s plan', () => {
    const running = feed([starts('b1'), agentPlan('b1', [{ label: 'Look', status: 'pending' }, { label: 'Say', status: 'pending' }])], started)
    expect(sound(running, [agentPlan('b1', [{ label: 'Look', status: 'completed' }, { label: 'Say', status: 'pending' }])])).toBe('step')
  })

  it('is nothing at all while muted', () => {
    const all = THREE.map((step) => ({ ...step, status: 'completed' }))
    const next = THREE.map((step, n) => (n === 1 ? { ...step, status: 'completed' } : step))
    expect(sound(started, [plan(all)], true)).toBe('none')
    expect(sound(started, [plan(next)], true)).toBe('none')
  })

  it('is nothing when there were no plans and are none', () => {
    expect(planSound([], [], false)).toBe('none')
    expect(planSound(undefined, undefined, false)).toBe('none')
  })
})
