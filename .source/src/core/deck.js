'use strict'

// The Deck: what the Claude Code in this Session is doing, as one state.
//
// A pure reducer. It takes the current Deck state, one Deck input — an Agent
// event or a status reading, both from events.js — and the time, and hands back the next state. It knows
// nothing of Electron, the pipe or the Panel. Every Deck block is a view over
// this one state: a selector in VIEWS, published under the block's id.
//
// It always runs, whether or not any block is on, so switching a block on shows
// what has already happened in this conversation. Nothing in it outlives the
// Session, and a new Claude Code conversation starts it afresh.
//
// To add a block's figures: give the state the fields it needs in
// `initialDeck`, teach `reduce` the inputs that move them (returning the same
// state when nothing it shows changed), and add the block's selector to VIEWS.

const { masked } = require('./mask')
// The block catalogue and the rules by which time settles what was left
// running: shared with the Panel, so kept in the one core file it can load.
const { BLOCKS, agentQuiet, compactionOverdue } = require('./deck-chips')

/** How many entries the Events block keeps. */
const EVENTS_KEPT = 100

/** A detail is a line, not a page: past this it is cut. */
const DETAIL_LIMIT = 240

/** The tools whose finishing counts as an edit. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * A subagent marked running that has taken no step for this long stops
 * counting as running: its SubagentStop was lost. A background agent, which
 * no Stop closes, would otherwise run on the Deck for good.
 */
const AGENT_QUIET_MS = 60 * 60_000

/** A compaction heard starting and not ending stops counting as running after this long. */
const COMPACTION_LIMIT_MS = 10 * 60_000

/** How many call ids a turn remembers, to know a late end as its own. */
const TURN_CALLS_KEPT = 256

/** How many compaction marks the Gauge keeps on its bar. */
const COMPACTIONS_KEPT = 20

/** Calls heard starting and not settled yet, at most: past this the oldest go. */
const OPEN_KEPT = 64

/** Subagents kept in view, at most: past this the oldest finished ones go. */
const AGENTS_KEPT = 24

/** Agent calls waiting for their subagent to start, and agents heard only by their calls, at most. */
const SPAWNS_KEPT = 16
const STRAYS_KEPT = 16

/**
 * A stray is drawn live while its last call is no older than this. Hooks say
 * when an agent works, never when it is gone, so this long a silence reads as
 * gone. The renderer judges it against its own clock.
 */
const STRAY_LIVE_MS = 30_000

/**
 * A stray is kept out of sight until it has gone this long unadopted since it
 * was first seen. Tool hooks are async, so a subagent's first steps can arrive
 * before its SubagentStart; without this they would flash in Loops for a moment.
 */
const STRAY_GRACE_MS = 3000

/** Fields that only remember what is under way; changing them changes no block. */
const BOOKKEEPING = new Set(['open', 'spawns', 'turnCalls'])

/** An empty Deck, belonging to `sessionId` when one is known. */
function initialDeck(sessionId = null) {
  return {
    sessionId,
    /** Oldest first; the view turns it round. */
    events: [],
    nextEntry: 1,
    /** The status line's latest figures, or null before its first reading. */
    figures: null,
    /** How Claude Code is set to work, the latest any input said. */
    permissionMode: null,
    effort: null,
    /**
     * Oldest first: `{ percent, trigger, running, startedAt, endedAt }` — where
     * the context stood when each began, whether it still runs, and when it
     * began and ended. `startedAt` is null for one heard only ending.
     */
    compactions: [],
    /**
     * The ids of the tool calls heard starting and not yet heard ending, oldest
     * first, so that a call heard starting twice is counted once.
     */
    open: [],
    /**
     * Subagents, oldest first: `{ agentId, agentType, task, spawnId, background,
     * startedAt, lastSeen, endedAt, status, steps, tokens, outOfOutput }`.
     * `lastSeen` is its start or its latest step. `status` is running, done or
     * failed; `tokens` and `outOfOutput` stay null until the
     * transcript is read, and for good when it cannot be.
     */
    agents: [],
    /**
     * Agent calls of the main conversation whose subagent has not started yet,
     * oldest first: `{ toolUseId, agentType, task, background }`.
     */
    spawns: [],
    /**
     * Agent ids no SubagentStart has named, first seen first: `{ id, steps,
     * firstSeen, lastSeen }`. Shown in Loops; a subagent whose start or stop is
     * heard later takes its steps from here, and leaves.
     */
    strays: [],
    /**
     * The ids of the calls heard starting since the latest prompt, and those of
     * the turn before it; null before the first prompt. An interrupt whose call
     * is in `before` is a late one, and ends no turn.
     */
    turnCalls: null,
    /**
     * The plans under way, the main conversation's first: `{ agentId, title,
     * steps, running, finishedAt }`. `agentId` is null for the main
     * conversation's; each step is `{ id, label, activeLabel, status }`, its
     * words masked. `finishedAt` is set once every step is done — or, for a
     * subagent's, once the subagent ends — and the plan goes at the next prompt.
     */
    plans: [],
  }
}

/** Masked, on one line, and no longer than a line should be. */
function shown(text) {
  const clean = masked(text)
  if (clean === null) return null
  const line = clean.replace(/\s+/g, ' ').trim()
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 1)}…` : line
}

/** The first line of an error message, which is the one that says what went wrong. */
function firstLine(text) {
  if (typeof text !== 'string') return null
  return text.split(/\r?\n/).find((line) => line.trim() !== '') ?? null
}

/** The entry an event adds to the Events block, or null when it adds none. */
function entryFor(event) {
  const inAgent = typeof event.agentId === 'string' && event.agentId !== ''
  switch (event.type) {
    case 'userPromptSubmitted':
      return { kind: 'prompt', label: 'Prompt', detail: event.text, inAgent: false }
    case 'subagentStarted':
      return {
        kind: 'spawn',
        label: event.agentType ?? 'Subagent',
        detail: null,
        inAgent: false,
      }
    case 'subagentStopped':
      return {
        kind: 'done',
        label: event.agentType ?? 'Subagent',
        detail: event.lastMessage,
        inAgent: false,
      }
    case 'toolFinished':
      if (!EDIT_TOOLS.has(event.toolName)) return null
      return { kind: 'edit', label: event.toolName, detail: event.detail, inAgent }
    case 'toolFailed':
      return {
        kind: 'error',
        label: event.toolName,
        detail: event.detail,
        note: event.interrupted ? 'Interrupted' : firstLine(event.error),
        inAgent,
      }
    case 'permissionDenied':
      return { kind: 'denied', label: event.toolName, detail: event.detail, note: event.reason, inAgent }
    case 'turnFailed':
      return { kind: 'error', label: 'Turn', detail: event.error, note: event.details, inAgent: false }
    default:
      return null
  }
}

/** One field set, or the same state when it already says that. */
function withField(deck, field, value) {
  if (typeof value !== 'string' || value === '' || deck[field] === value) return deck
  return { ...deck, [field]: value }
}

/** What the Gauge keeps of an input: figures, posture and compactions. */
function gaugeStep(deck, event, now) {
  let next = withField(deck, 'permissionMode', event.permissionMode)
  next = withField(next, 'effort', event.effort ?? event.figures?.effort)

  switch (event.type) {
    case 'statusReported':
      if (JSON.stringify(next.figures) === JSON.stringify(event.figures)) return next
      return { ...next, figures: event.figures }

    case 'compactionStarted': {
      const mark = {
        percent: next.figures?.contextPercent ?? null,
        trigger: event.trigger,
        running: true,
        startedAt: now,
        endedAt: null,
      }
      return { ...next, compactions: [...next.compactions, mark].slice(-COMPACTIONS_KEPT) }
    }

    case 'compactionFinished': {
      // A running mark, or one that ran past its limit with its end still to come.
      const open = next.compactions.findLastIndex(
        (mark) => mark.running || (mark.startedAt !== null && mark.endedAt === null),
      )
      if (open === -1) {
        // Seen only finishing — Jarvis came in during it. Still a compaction.
        const mark = {
          percent: next.figures?.contextPercent ?? null,
          trigger: event.trigger,
          running: false,
          startedAt: null,
          endedAt: now,
        }
        return { ...next, compactions: [...next.compactions, mark].slice(-COMPACTIONS_KEPT) }
      }
      const compactions = next.compactions.map((mark, index) =>
        index === open ? { ...mark, trigger: event.trigger ?? mark.trigger, running: false, endedAt: now } : mark,
      )
      return { ...next, compactions }
    }

    default:
      return next
  }
}

// --- The end of a turn ---------------------------------------------------------
//
// A turn ends on Stop — with an answer, or with nothing to say (`turnEnded`) —
// on StopFailure, or on Escape, which sends no Stop at all: what it sends is the
// main conversation's call failing as interrupted. A late interrupt, whose call
// started in the turn before, ends nothing.

function isEscape(deck, event) {
  return (
    event.type === 'toolFailed' &&
    event.interrupted === true &&
    agentOf(event) === null &&
    !(event.toolUseId && deck.turnCalls?.before.includes(event.toolUseId))
  )
}

/** How the turn ends with this input — done, failed or interrupted — or null when it goes on. */
function turnEnding(deck, event) {
  switch (event.type) {
    case 'assistantFinished':
    case 'turnEnded':
      return 'done'
    case 'turnFailed':
      return 'failed'
    case 'sessionEnded':
      return 'interrupted'
    default:
      return isEscape(deck, event) ? 'interrupted' : null
  }
}

// --- Calls under way ----------------------------------------------------------
//
// A PreToolUse opens a call and its end closes it. Only the ids are kept, so
// that a call heard starting twice is counted once; one that never ends gives
// way to newer ones.

function agentOf(event) {
  return typeof event.agentId === 'string' && event.agentId !== '' ? event.agentId : null
}

function callsStep(deck, event) {
  const id = event.toolUseId
  switch (event.type) {
    case 'toolStarted':
      if (!id || deck.open.includes(id)) return deck
      return { ...deck, open: [...deck.open, id].slice(-OPEN_KEPT) }

    case 'toolFinished':
    case 'toolFailed':
    case 'permissionDenied':
      if (!id || !deck.open.includes(id)) return deck
      return { ...deck, open: deck.open.filter((each) => each !== id) }

    case 'sessionEnded':
      return deck.open.length === 0 ? deck : { ...deck, open: [] }

    default:
      return deck
  }
}

/** The calls of each turn, from its prompt until the next, so a late interrupt is known as one. */
function turnCallsStep(deck, event) {
  switch (event.type) {
    case 'userPromptSubmitted':
      return { ...deck, turnCalls: { current: [], before: deck.turnCalls?.current ?? [] } }

    case 'toolStarted': {
      const id = event.toolUseId
      if (deck.turnCalls === null || !id || deck.turnCalls.current.includes(id)) return deck
      const current = [...deck.turnCalls.current, id].slice(-TURN_CALLS_KEPT)
      return { ...deck, turnCalls: { ...deck.turnCalls, current } }
    }

    default:
      return deck
  }
}

// --- Agents -------------------------------------------------------------------
//
// A subagent opens on SubagentStart and closes on SubagentStop. Its task is the
// description of the main conversation's Agent call that spawned it, matched by
// type in the order they came, whichever of the two is heard first. Its steps
// are the calls carrying its id. Its tokens arrive afterwards, read once from
// its transcript by the main process (`subagentMeasured`).

function isRunning(agent) {
  return agent.status === 'running'
}

/** The Deck with `agentId`'s agent changed by `change`, or null when there is no such agent. */
function withAgent(deck, agentId, change) {
  const index = deck.agents.findIndex((agent) => agent.agentId === agentId)
  if (index === -1) return null
  const before = deck.agents[index]
  const after = change(before)
  if (after === before) return deck
  const agents = deck.agents.slice()
  agents[index] = after
  return { ...deck, agents }
}

/** At most `cap`, letting the oldest finished ones go first. */
function trimmed(agents, cap = AGENTS_KEPT) {
  let excess = agents.length - cap
  if (excess <= 0) return agents
  const kept = agents.filter((agent) => {
    if (excess > 0 && !isRunning(agent)) {
      excess -= 1
      return false
    }
    return true
  })
  return kept.slice(-cap)
}

function ended(agent, status, now) {
  return { ...agent, status, endedAt: agent.endedAt ?? now }
}

function newAgent(agentId, agentType, now) {
  return {
    agentId,
    agentType,
    task: null,
    spawnId: null,
    background: false,
    startedAt: now,
    lastSeen: now,
    endedAt: null,
    status: 'running',
    steps: 0,
    tokens: null,
    outOfOutput: null,
  }
}

function strayOf(deck, agentId) {
  return deck.strays.find((stray) => stray.id === agentId) ?? null
}

function withoutStray(strays, agentId) {
  return strays.some((stray) => stray.id === agentId) ? strays.filter((stray) => stray.id !== agentId) : strays
}

/** At most `STRAYS_KEPT`, letting the least recently seen go first. */
function strayRoom(strays) {
  if (strays.length <= STRAYS_KEPT) return strays
  const stalest = strays.reduce((found, stray) => (stray.lastSeen < found.lastSeen ? stray : found))
  return strayRoom(strays.filter((stray) => stray !== stalest))
}

/** A step of `agentId`: on its card, or a stray's until its start is heard. */
function stepTaken(deck, agentId, now) {
  const counted = withAgent(deck, agentId, (agent) => ({ ...reopened(agent), steps: agent.steps + 1, lastSeen: now }))
  if (counted) return counted
  const before = strayOf(deck, agentId)
  if (before) {
    const stray = { ...before, steps: before.steps + 1, lastSeen: now }
    return { ...deck, strays: deck.strays.map((each) => (each === before ? stray : each)) }
  }
  const stray = { id: agentId, steps: 1, firstSeen: now, lastSeen: now }
  return { ...deck, strays: strayRoom([...deck.strays, stray]) }
}

/** A stray's call ending: still at work, though it took no new step. */
function straySeen(deck, agentId, now) {
  const before = strayOf(deck, agentId)
  if (!before || before.lastSeen === now) return deck
  return { ...deck, strays: deck.strays.map((each) => (each === before ? { ...before, lastSeen: now } : each)) }
}

/** An Agent call of the main conversation: the task of a subagent already running, or one waiting for it. */
function spawnHeard(deck, event) {
  const order = {
    toolUseId: event.toolUseId,
    agentType: event.spawn.agentType,
    task: shown(event.spawn.task),
    background: event.spawn.background,
  }
  const started = deck.agents.find(
    (agent) => isRunning(agent) && agent.spawnId === null && agent.task === null && agent.agentType === order.agentType,
  )
  if (!started) return { ...deck, spawns: [...deck.spawns, order].slice(-SPAWNS_KEPT) }
  return withAgent(deck, started.agentId, (agent) => ({
    ...agent,
    task: order.task,
    spawnId: order.toolUseId,
    background: order.background,
  }))
}

/**
 * The turn is over, and so are its own subagents, whether or not their stop
 * was heard: done with it, failed with it — or, interrupted, failed. Those
 * sent to the background run on.
 */
function turnOver(deck, ending, now) {
  const status = ending === 'done' ? 'done' : 'failed'
  const closing = (agent) => isRunning(agent) && !agent.background
  if (!deck.agents.some(closing)) return deck
  return {
    ...deck,
    agents: deck.agents.map((agent) => (closing(agent) ? { ...ended(agent, status, now), closedByTurn: true } : agent)),
  }
}

/**
 * An agent the end of the turn closed on a guess, heard at work after all: it
 * runs on, and only its own stop ends it.
 */
function reopened(agent) {
  return agent.closedByTurn ? { ...agent, status: 'running', endedAt: null, closedByTurn: false } : agent
}

/**
 * The Agent call that spawned a subagent came back at once: Claude Code sent
 * it to the background. It runs on past the turn, its order — if its start is
 * still to come — carrying that with it.
 */
function launched(deck, toolUseId) {
  const spawns = deck.spawns.map((each) => (each.toolUseId === toolUseId ? { ...each, background: true } : each))
  const agent = deck.agents.find((each) => each.spawnId === toolUseId)
  if (!agent && !deck.spawns.some((each) => each.toolUseId === toolUseId)) return deck
  const next = { ...deck, spawns }
  if (!agent) return next
  return withAgent(next, agent.agentId, (before) => ({ ...reopened(before), background: true }))
}

function agentsStep(deck, event, now) {
  switch (event.type) {
    case 'assistantFinished':
    case 'turnEnded':
    case 'turnFailed':
      return turnOver(deck, turnEnding(deck, event), now)

    case 'toolStarted': {
      // Heard twice: counted once.
      if (event.toolUseId && deck.open.includes(event.toolUseId)) return deck
      const agentId = agentOf(event)
      if (agentId !== null) return stepTaken(deck, agentId, now)
      return event.spawn ? spawnHeard(deck, event) : deck
    }

    case 'subagentStarted': {
      if (deck.agents.some((agent) => agent.agentId === event.agentId)) return deck
      const order = deck.spawns.find((each) => each.agentType === event.agentType)
      const agent = {
        ...newAgent(event.agentId, event.agentType, now),
        steps: strayOf(deck, event.agentId)?.steps ?? 0,
        ...(order ? { task: order.task, spawnId: order.toolUseId, background: order.background } : {}),
      }
      return {
        ...deck,
        agents: trimmed([...deck.agents, agent]),
        spawns: order ? deck.spawns.filter((each) => each !== order) : deck.spawns,
        strays: withoutStray(deck.strays, event.agentId),
      }
    }

    case 'subagentStopped': {
      const closed = withAgent(deck, event.agentId, (agent) =>
        agent.status === 'done' && !agent.closedByTurn ? agent : ended(reopened(agent), 'done', now),
      )
      if (closed) return closed
      // Heard only stopping: Jarvis came in while it ran.
      const agent = {
        ...newAgent(event.agentId, event.agentType, null),
        status: 'done',
        endedAt: now,
        steps: strayOf(deck, event.agentId)?.steps ?? 0,
      }
      return { ...deck, agents: trimmed([...deck.agents, agent]), strays: withoutStray(deck.strays, event.agentId) }
    }

    case 'subagentMeasured': {
      const tokens = event.figures?.tokens ?? null
      const outOfOutput = typeof event.figures?.outOfOutput === 'boolean' ? event.figures.outOfOutput : null
      const measuredDeck = withAgent(deck, event.agentId, (agent) =>
        JSON.stringify(agent.tokens) === JSON.stringify(tokens) && agent.outOfOutput === outOfOutput
          ? agent
          : { ...agent, tokens, outOfOutput },
      )
      return measuredDeck ?? deck
    }

    case 'toolFinished':
    case 'toolFailed': {
      if (agentOf(event) !== null) return straySeen(deck, agentOf(event), now)
      let next = deck
      if (event.spawn?.background && event.toolUseId && event.type === 'toolFinished') return launched(next, event.toolUseId)
      if (event.spawn && event.toolUseId && next.spawns.some((each) => each.toolUseId === event.toolUseId)) {
        next = { ...next, spawns: next.spawns.filter((each) => each.toolUseId !== event.toolUseId) }
      }
      if (isEscape(deck, event)) return turnOver(next, 'interrupted', now)
      if (!event.spawn || !event.toolUseId || event.type !== 'toolFailed') return next
      // The call that spawned it failed, or was interrupted: so did the agent.
      const spawned = next.agents.find((agent) => agent.spawnId === event.toolUseId)
      if (!spawned || spawned.status === 'failed') return next
      return withAgent(next, spawned.agentId, (agent) => ended(agent, 'failed', now))
    }

    case 'sessionEnded': {
      // The conversation is over: nothing in it runs on, in the background or not.
      if (!deck.agents.some(isRunning)) return deck
      return { ...deck, agents: deck.agents.map((agent) => (isRunning(agent) ? ended(agent, 'done', now) : agent)) }
    }

    case 'userPromptSubmitted':
      // A new turn: what finished in the last one makes way.
      if (deck.agents.every(isRunning)) return deck
      return { ...deck, agents: deck.agents.filter(isRunning) }

    default:
      return deck
  }
}

// --- Plan ---------------------------------------------------------------------
//
// A plan is the list of steps a conversation is working through, one per
// agent: the main conversation's, and any subagent's own. Each finished call of
// the plan tool or the todo list is the whole list again; the task tools add
// and change one step at a time. A plan is finished when its last step is done,
// or when its subagent ends, and a finished plan goes at the next prompt.

/** Of a plan's steps, how many are done. */
function stepsDone(steps) {
  return steps.filter((step) => step.status === 'completed').length
}

function allDone(steps) {
  return steps.length > 0 && steps.every((step) => step.status === 'completed')
}

/** A step as the Deck keeps it: its words masked, on one line. */
function keptStep(step) {
  return {
    id: step.id ?? null,
    label: shown(step.label) ?? '',
    activeLabel: shown(step.activeLabel ?? null),
    status: step.status,
  }
}

/** A plan's steps after one change, or the same steps when it changes none. */
function changedSteps(steps, plan) {
  switch (plan.kind) {
    case 'replace':
      return plan.steps.map(keptStep)
    case 'add':
      return [...steps, keptStep(plan.step)]
    case 'update': {
      if (!steps.some((step) => step.id === plan.id)) return steps
      if (plan.status === 'deleted') return steps.filter((step) => step.id !== plan.id)
      return steps.map((step) =>
        step.id === plan.id
          ? {
              ...step,
              status: plan.status ?? step.status,
              label: plan.label === null ? step.label : (shown(plan.label) ?? step.label),
              activeLabel: plan.activeLabel === null ? step.activeLabel : shown(plan.activeLabel),
            }
          : step,
      )
    }
    default:
      return steps
  }
}

/** A plan with new steps: finished the moment its last step is done, and open again if one is not. */
function withSteps(board, steps, now) {
  const finishedAt = allDone(steps) ? (board.finishedAt ?? now) : board.running ? null : board.finishedAt
  return { ...board, steps, finishedAt }
}

/** A subagent's plan as its subagent ends: every step done. */
function finishedBoard(board, now) {
  return {
    ...board,
    running: false,
    steps: board.steps.map((step) => (step.status === 'completed' ? step : { ...step, status: 'completed' })),
    finishedAt: board.finishedAt ?? now,
  }
}

function planStep(deck, event, now) {
  let next = deck
  if (event.type === 'toolFinished' && event.plan) {
    const agentId = agentOf(event)
    const index = next.plans.findIndex((board) => board.agentId === agentId)
    const before = index === -1 ? null : next.plans[index]
    const steps = changedSteps(before?.steps ?? [], event.plan)
    if (before && steps === before.steps) return next
    if (!before && steps.length === 0) return next
    const board = withSteps(
      // Until its subagent's task is heard, a plan is named by the agent's type.
      before ?? { agentId, title: agentId === null ? null : event.agentType, steps: [], running: true, finishedAt: null },
      steps,
      now,
    )
    const plans = next.plans.slice()
    if (index !== -1) plans[index] = board
    else if (agentId === null) plans.unshift(board)
    else plans.push(board)
    next = { ...next, plans }
  }

  // A subagent no longer running has finished its plan, whatever it said last.
  const ending = (board) =>
    board.running &&
    board.agentId !== null &&
    next.agents.some((agent) => agent.agentId === board.agentId && agent.status !== 'running')
  if (next.plans.some(ending)) {
    next = { ...next, plans: next.plans.map((board) => (ending(board) ? finishedBoard(board, now) : board)) }
  }

  if (event.type === 'userPromptSubmitted' && next.plans.some((board) => board.finishedAt !== null)) {
    next = { ...next, plans: next.plans.filter((board) => board.finishedAt === null) }
  }
  return next
}

/** Whether a plan is finished: its last step done, or its subagent ended. */
function planFinished(board) {
  return board.finishedAt !== null || allDone(board.steps)
}

/**
 * Which sound a change of plans earns, as the terminal mod chose it: 'done'
 * when a plan is finished that was not before — its last step done, or its
 * subagent ended — 'step' when more steps are done in all than before, 'done'
 * winning when both, and 'none' otherwise or while muted. A finished plan
 * going at the next prompt earns nothing.
 */
function planSound(before = [], after = [], muted = false) {
  if (muted || before === after) return 'none'
  const finished = after.some((board) => {
    const old = before.find((each) => each.agentId === board.agentId)
    return planFinished(board) && !(old && planFinished(old))
  })
  if (finished) return 'done'
  const done = (plans) => plans.reduce((sum, board) => sum + stepsDone(board.steps), 0)
  return done(after) > done(before) ? 'step' : 'none'
}

/**
 * What has gone quiet past its limit stops counting as running: a subagent
 * with no step for an hour is taken as done when last seen, and a compaction
 * ten minutes old as over, its end unknown. The Panel applies the same rules
 * between inputs (deck-chips.js, `settled`).
 */
function expire(deck, now) {
  let next = deck
  if (deck.agents.some((agent) => agentQuiet(agent, AGENT_QUIET_MS, now))) {
    next = {
      ...next,
      agents: next.agents.map((agent) =>
        agentQuiet(agent, AGENT_QUIET_MS, now) ? { ...agent, status: 'done', endedAt: agent.lastSeen } : agent,
      ),
    }
  }
  if (deck.compactions.some((mark) => compactionOverdue(mark, COMPACTION_LIMIT_MS, now))) {
    next = {
      ...next,
      compactions: next.compactions.map((mark) =>
        compactionOverdue(mark, COMPACTION_LIMIT_MS, now) ? { ...mark, running: false } : mark,
      ),
    }
  }
  return next
}

/**
 * The next Deck state. `now` is milliseconds since the epoch, passed in so the
 * reducer never reads a clock of its own.
 *
 * The same state comes back, unchanged and identical, when the input changes
 * nothing at all. A state can also differ only in what it remembers of calls
 * under way; `sameView` is how the Session knows there is then nothing to
 * publish.
 */
function reduce(deck, event, now) {
  let next = deck
  // A different conversation, adopted: nothing from the last one is carried over.
  if (typeof event?.sessionId === 'string' && event.sessionId !== deck.sessionId) {
    next = initialDeck(event.sessionId)
  }

  next = expire(next, now)
  next = gaugeStep(next, event, now)
  // Before the calls are brought up to date: a step is counted only the first
  // time its call is heard starting, and an interrupt is judged by the calls
  // of the turns before it.
  next = agentsStep(next, event, now)
  // After the agents, so a subagent that has just ended closes its plan.
  next = planStep(next, event, now)
  next = callsStep(next, event)
  next = turnCallsStep(next, event)

  const entry = entryFor(event)
  if (entry === null) return next

  const kept = {
    id: next.nextEntry,
    at: now,
    kind: entry.kind,
    label: entry.label,
    detail: shown(entry.detail),
    note: shown(entry.note ?? null),
    inAgent: entry.inAgent,
  }
  return {
    ...next,
    events: [...next.events, kept].slice(-EVENTS_KEPT),
    nextEntry: next.nextEntry + 1,
  }
}

// --- The views, one per block -------------------------------------------------

/** The Events block: newest first. */
function eventsView(deck) {
  return [...deck.events].reverse()
}

/**
 * The Gauge: the folder and branch, the context bar and where each compaction
 * happened on it, the plan's two windows and how Claude Code is set
 * — everything the status line under the terminal used to print, and more. `reported` is false
 * until the status line's first reading, so an empty bar is never read as zero;
 * a plan window the plan did not report is null.
 */
function gaugeView(deck) {
  const figures = deck.figures
  return {
    reported: figures !== null,
    folder: figures?.folder ?? null,
    branch: figures?.branch ?? null,
    context: {
      percent: figures?.contextPercent ?? null,
      compactions: deck.compactions.map(({ percent, trigger, running }) => ({ percent, trigger, running })),
    },
    limits: { fiveHour: figures?.fiveHour ?? null, sevenDay: figures?.sevenDay ?? null },
    model: figures?.model ?? null,
    effort: deck.effort,
    permissionMode: deck.permissionMode,
  }
}

/**
 * The Agents block: each subagent, oldest first, with its task (null when no
 * Agent call spoke of it — the type stands in), steps and times, and the
 * tokens and out-of-output flag once its transcript has been read; and how
 * many are running, done and failed. Clocks are the renderer's: it ticks from
 * `startedAt` while an agent runs.
 */
function agentsView(deck) {
  const tally = (status) => deck.agents.filter((agent) => agent.status === status).length
  return {
    running: tally('running'),
    done: tally('done'),
    failed: tally('failed'),
    quietForMs: AGENT_QUIET_MS,
    agents: deck.agents.map((agent) => ({
      id: agent.agentId,
      type: agent.agentType,
      task: agent.task,
      steps: agent.steps,
      startedAt: agent.startedAt,
      lastSeen: agent.lastSeen,
      endedAt: agent.endedAt,
      status: agent.status,
      tokens: agent.tokens && {
        ...agent.tokens,
        total: agent.tokens.input + agent.tokens.output + agent.tokens.cacheRead + agent.tokens.cacheCreation,
      },
      outOfOutput: agent.outOfOutput,
    })),
  }
}

/**
 * The Loops block: model work no agent card owns. Each compaction, oldest
 * first, with its trigger and times; and each stray — an agent id whose calls
 * were heard though no SubagentStart named it — with its short id, its steps,
 * and when it was first and last seen. A stray is live while its last sighting
 * is younger than `liveForMs`, judged by the renderer against its own clock;
 * and it is not shown at all — nor counted — until `graceMs` has passed since
 * it was first seen, for its SubagentStart may still be on the way.
 */
function loopsView(deck) {
  return {
    liveForMs: STRAY_LIVE_MS,
    graceMs: STRAY_GRACE_MS,
    compactionLimitMs: COMPACTION_LIMIT_MS,
    compactions: deck.compactions.map(({ trigger, running, startedAt, endedAt }) => ({
      trigger,
      running,
      startedAt,
      endedAt,
    })),
    strays: deck.strays.map(({ id, ...stray }) => ({
      id,
      short: id.slice(0, 7),
      steps: stray.steps,
      firstSeen: stray.firstSeen,
      lastSeen: stray.lastSeen,
    })),
  }
}

/**
 * The Plan block: one row per plan, the main conversation's first — its title,
 * how many steps are done of how many, the step under way (in its
 * present-continuous form when it has one) and whether it is finished; a
 * subagent's row says so, and is titled by the task it was spawned for, else
 * its type. Then the main plan's steps, in order, each with its status.
 */
function planView(deck) {
  const rows = deck.plans
    .filter((board) => board.steps.length > 0)
    .map((board) => {
      const current = board.steps.find((step) => step.status === 'in_progress') ?? null
      return {
        id: board.agentId ?? 'main',
        title: planTitle(deck, board),
        done: stepsDone(board.steps),
        total: board.steps.length,
        current: current && (current.activeLabel ?? current.label),
        finished: board.finishedAt !== null,
        inAgent: board.agentId !== null,
      }
    })
  const main = deck.plans.find((board) => board.agentId === null)
  return { rows, steps: main ? main.steps.map(({ label, status }) => ({ label, status })) : [] }
}

function planTitle(deck, board) {
  if (board.agentId === null) return 'Main'
  const agent = deck.agents.find((each) => each.agentId === board.agentId)
  return agent?.task ?? agent?.agentType ?? board.title ?? 'Subagent'
}

/**
 * One selector per block that is drawn. A block without one is published as
 * nothing and drawn as nothing until its slice gives it a view.
 */
const VIEWS = Object.freeze({
  plan: planView,
  gauge: gaugeView,
  agents: agentsView,
  loops: loopsView,
  events: eventsView,
})

/** What the Panel is sent: each block's view, by the block's id. */
function view(deck) {
  return Object.fromEntries(Object.entries(VIEWS).map(([id, select]) => [id, select(deck)]))
}

/**
 * True when no block would show anything different: the two states differ, if
 * at all, only in what they remember of calls under way.
 */
function sameView(before, after) {
  if (before === after) return true
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const field of fields) {
    if (!BOOKKEEPING.has(field) && before[field] !== after[field]) return false
  }
  return true
}

module.exports = { BLOCKS, EVENTS_KEPT, initialDeck, planSound, reduce, sameView, view, VIEWS }
