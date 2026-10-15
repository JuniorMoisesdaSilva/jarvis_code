'use strict'

// The single translation point between Claude Code's hook format and Jarvis's
// own events.
//
// The hook system is a configuration interface and can change between versions
// of the tool. Concentrating the translation here is what keeps a format change
// from spreading into the core.

const { agent, status, incoming } = require('./events')
const planTool = require('./plan-tool')

/**
 * Tool parameters vary per tool. Only the fields that say something when spoken
 * aloud are of interest.
 */
function significantDetail(toolInput) {
  if (typeof toolInput !== 'object' || toolInput === null) return null
  for (const key of ['command', 'file_path', 'path', 'url', 'pattern', 'query']) {
    const value = toolInput[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/**
 * What the Deck shows for a call: the spoken detail, or failing that the
 * description a tool like Agent carries. Kept apart from `significantDetail`
 * so the Permission announcement reads exactly what it read before.
 */
function deckDetail(toolInput) {
  const spoken = significantDetail(toolInput)
  if (spoken !== null) return spoken
  const description = toolInput?.description
  return typeof description === 'string' && description !== '' ? description : null
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/** The tools that start a subagent: Agent, and Task as it was once called. */
const SPAWNING_TOOLS = new Set(['Agent', 'Task'])

/**
 * What a call that starts a subagent asks for, or null for any other call. A
 * call that names no type gets the general-purpose agent, as Claude Code does.
 */
function spawnOf(payload) {
  if (!SPAWNING_TOOLS.has(payload.tool_name)) return null
  const input = typeof payload.tool_input === 'object' && payload.tool_input !== null ? payload.tool_input : {}
  return {
    agentType: text(input.subagent_type) ?? 'general-purpose',
    task: text(input.description),
    // Asked for, or done anyway: Claude Code may launch an agent on its own and
    // answer the call at once, saying so in its response.
    background: input.run_in_background === true || payload.tool_response?.isAsync === true,
  }
}

// --- What feeds the Plan block --------------------------------------------
//
// A plan reaches Jarvis as the calls that carry it finish: Jarvis's own plan
// tool, Claude Code's todo list, or its task tools. Each is read here into one
// of three changes — the whole plan, a step added, a step changed — so the Deck
// never learns any of their shapes.

/**
 * The plan tool, under Jarvis's name and under the two the terminal mods gave
 * it, which still answer while those mods exist.
 */
const PLAN_TOOLS = new Set([
  planTool.FULL_NAME,
  'mcp__jarvis-flightdeck__update_plan',
  'mcp__plan-progress__update_plan',
])

const STEP_STATUSES = new Set(['pending', 'in_progress', 'completed'])

function stepStatus(value) {
  return STEP_STATUSES.has(value) ? value : 'pending'
}

/** A list of steps, read leniently, or null when what came is not a list. */
function stepsFrom(list, read) {
  if (!Array.isArray(list)) return null
  return list
    .filter((item) => typeof item === 'object' && item !== null)
    .map((item) => {
      const { label, activeLabel, status } = read(item)
      return { label: typeof label === 'string' ? label : '', activeLabel: text(activeLabel), status: stepStatus(status) }
    })
}

/** The id a task tool gave the task it made: its response says, in one shape or another. */
function taskId(response) {
  const id = response?.task?.id ?? response?.taskId ?? response?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/**
 * What a finished call does to its plan, or null for a call that carries none:
 * `{ kind: 'replace', steps }`, `{ kind: 'add', step }` or `{ kind: 'update',
 * id, status, label, activeLabel }` — a status of `deleted` takes the step away.
 */
function planOf(payload) {
  const input = typeof payload.tool_input === 'object' && payload.tool_input !== null ? payload.tool_input : {}
  const name = payload.tool_name
  if (PLAN_TOOLS.has(name)) {
    const steps = stepsFrom(input.steps, (item) => item)
    return steps && { kind: 'replace', steps }
  }
  if (name === 'TodoWrite') {
    const steps = stepsFrom(input.todos, (todo) => ({
      label: todo.content,
      activeLabel: todo.activeForm,
      status: todo.status,
    }))
    return steps && { kind: 'replace', steps }
  }
  if (name === 'TaskCreate') {
    const subject = text(input.subject)
    if (subject === null) return null
    return {
      kind: 'add',
      step: { id: taskId(payload.tool_response), label: subject, activeLabel: text(input.activeForm), status: 'pending' },
    }
  }
  if (name === 'TaskUpdate') {
    const id = text(input.taskId) ?? (Number.isFinite(input.taskId) ? String(input.taskId) : null)
    if (id === null) return null
    const status = input.status === 'deleted' ? 'deleted' : STEP_STATUSES.has(input.status) ? input.status : null
    return { kind: 'update', id, status, label: text(input.subject), activeLabel: text(input.activeForm) }
  }
  return null
}

/** The fields of a tool event the Deck reads, in Jarvis's own names. */
function call(payload) {
  return {
    toolName: text(payload.tool_name) ?? 'unknown',
    toolUseId: text(payload.tool_use_id),
    detail: deckDetail(payload.tool_input),
    agentId: text(payload.agent_id),
    agentType: text(payload.agent_type),
    permissionMode: text(payload.permission_mode),
    effort: text(payload.effort?.level),
    spawn: spawnOf(payload),
  }
}

/**
 * How Claude Code is set to work, where a hook says so: the permission mode and
 * the effort. The Gauge keeps the latest it has seen.
 */
function posture(payload) {
  return { permissionMode: text(payload.permission_mode), effort: text(payload.effort?.level) }
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === ''
}

/** The Agent event a hook payload means, or null when it means nothing to us. */
function agentEvent(json) {
  const payload = typeof json === 'string' ? JSON.parse(json) : json
  const sessionId = payload.session_id

  // A payload with no session identifier is unusable and must be dropped here
  // rather than travel onwards: the core would adopt it as the live session, and
  // then every real event would fail to match it and be silently discarded.
  if (typeof sessionId !== 'string' || sessionId === '') return null

  switch (payload.hook_event_name) {
    case 'Stop': {
      // Nothing to say is still the end of a turn: the Deck hears it, under a
      // name of its own, so the core — which speaks Stops — never does.
      if (isBlank(payload.last_assistant_message)) return { ...agent.turnEnded(sessionId), ...posture(payload) }
      return {
        ...agent.assistantFinished(sessionId, payload.last_assistant_message),
        ...posture(payload),
      }
    }

    case 'PermissionRequest':
      return {
        ...agent.permissionRequested(
          sessionId,
          payload.tool_name ?? 'unknown',
          significantDetail(payload.tool_input),
        ),
        ...posture(payload),
        // The request carries no tool use id; the Deck matches it to its call
        // by tool, detail and the subagent that asked.
        agentId: text(payload.agent_id),
      }

    case 'UserPromptSubmit': {
      if (isBlank(payload.prompt)) return null
      return { ...agent.userPromptSubmitted(sessionId, payload.prompt), ...posture(payload) }
    }

    case 'SessionStart':
      return agent.sessionStarted(sessionId, payload.source ?? null)

    case 'SessionEnd':
      return agent.sessionEnded(sessionId)

    // The nine only the Deck reads. Claude Code does not wait for any of them.
    case 'PreToolUse':
      return agent.toolStarted(sessionId, call(payload))

    case 'PostToolUse':
      return agent.toolFinished(sessionId, { ...call(payload), durationMs: duration(payload), plan: planOf(payload) })

    case 'PostToolUseFailure':
      return agent.toolFailed(sessionId, {
        ...call(payload),
        error: text(payload.error),
        interrupted: payload.is_interrupt === true,
        durationMs: duration(payload),
      })

    case 'PermissionDenied':
      return agent.permissionDenied(sessionId, { ...call(payload), reason: text(payload.reason) })

    case 'SubagentStart':
    case 'SubagentStop': {
      const agentId = text(payload.agent_id)
      if (agentId === null) return null
      const agentType = text(payload.agent_type)
      return payload.hook_event_name === 'SubagentStart'
        ? agent.subagentStarted(sessionId, { agentId, agentType })
        : agent.subagentStopped(sessionId, {
            agentId,
            agentType,
            transcriptPath: text(payload.agent_transcript_path),
            lastMessage: text(payload.last_assistant_message),
          })
    }

    case 'PreCompact':
      return agent.compactionStarted(sessionId, text(payload.trigger))

    case 'PostCompact':
      return agent.compactionFinished(sessionId, text(payload.trigger))

    case 'StopFailure':
      return agent.turnFailed(sessionId, text(payload.error), text(payload.error_details))

    // "Notification" is redundant with PermissionRequest for permission prompts
    // and does not carry the request's content, so it is dropped.
    default:
      return null
  }
}

function duration(payload) {
  return Number.isFinite(payload.duration_ms) ? payload.duration_ms : null
}

function terminalOf(payload) {
  return typeof payload.jarvis_terminal === 'string' ? payload.jarvis_terminal : null
}

/** True for what the status line sends: its payload, tagged by Brain/LAYOUT.js. */
function isStatusReading(payload) {
  return typeof payload === 'object' && payload !== null && payload.jarvis_reading === 'status'
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One plan window, or null when the plan did not report it — absent, never zero.
 * Claude Code gives the reset in seconds; Jarvis keeps milliseconds.
 */
function planWindow(window) {
  const used = percent(window?.used_percentage)
  if (used === null) return null
  const resets = percent(window.resets_at)
  return { percent: used, resetsAt: resets === null ? null : resets * 1000 }
}

/**
 * A status reading with the folder and terminal it came from, or null when the
 * payload is not one. It is not an Agent event: it is never spoken, never
 * written to the Transcript, and only the Deck reads it.
 */
function decodeStatus(json) {
  const payload = typeof json === 'string' ? JSON.parse(json) : json
  if (!isStatusReading(payload)) return null
  const sessionId = payload.session_id
  if (typeof sessionId !== 'string' || sessionId === '') return null

  const figures = {
    contextPercent: percent(payload.context_window?.used_percentage),
    fiveHour: planWindow(payload.rate_limits?.five_hour),
    sevenDay: planWindow(payload.rate_limits?.seven_day),
    model: text(payload.model?.display_name),
    effort: text(payload.effort?.level),
    // What the status line used to print first: the folder as a person reads
    // it and its branch. Brain/LAYOUT.js works both out; an older copy of it
    // sends neither, and the raw folder stands in.
    folder: text(payload.jarvis_folder) ?? text(payload.workspace?.current_dir) ?? text(payload.cwd),
    branch: text(payload.jarvis_branch),
  }
  const folder = text(payload.cwd) ?? text(payload.workspace?.current_dir)
  return incoming(status.reported(sessionId, figures), folder, terminalOf(payload))
}

/** The event together with the folder it came from, or null when irrelevant. */
function decode(json) {
  const payload = typeof json === 'string' ? JSON.parse(json) : json
  // A status reading is not a hook, whatever it carries: see decodeStatus.
  if (isStatusReading(payload)) return null
  const event = agentEvent(payload)
  if (!event) return null
  return incoming(event, payload.cwd ?? null, terminalOf(payload))
}

module.exports = { decode, decodeStatus, agentEvent, significantDetail, PLAN_TOOLS }
