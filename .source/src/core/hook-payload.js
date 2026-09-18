'use strict'

// The single translation point between Claude Code's hook format and Jarvis's
// own events.
//
// The hook system is a configuration interface and can change between versions
// of the tool. Concentrating the translation here is what keeps a format change
// from spreading into the core.

const { agent, incoming } = require('./events')

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
      if (isBlank(payload.last_assistant_message)) return null
      return agent.assistantFinished(sessionId, payload.last_assistant_message)
    }

    case 'PermissionRequest':
      return agent.permissionRequested(
        sessionId,
        payload.tool_name ?? 'unknown',
        significantDetail(payload.tool_input),
      )

    case 'UserPromptSubmit': {
      if (isBlank(payload.prompt)) return null
      return agent.userPromptSubmitted(sessionId, payload.prompt)
    }

    case 'SessionStart':
      return agent.sessionStarted(sessionId, payload.source ?? null)

    case 'SessionEnd':
      return agent.sessionEnded(sessionId)

    // "Notification" is redundant with PermissionRequest for permission prompts
    // and does not carry the request's content, so it is dropped.
    default:
      return null
  }
}

/** The event together with the folder it came from, or null when irrelevant. */
function decode(json) {
  const payload = typeof json === 'string' ? JSON.parse(json) : json
  const event = agentEvent(payload)
  if (!event) return null
  return incoming(event, payload.cwd ?? null)
}

module.exports = { decode, agentEvent, significantDetail }
