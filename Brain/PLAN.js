#!/usr/bin/env node
'use strict'

// Jarvis's plan tool: a one-tool MCP server Claude Code runs over standard
// input and output.
//
// It offers `update_plan` and nothing else. Claude Code calls it with the whole
// list of steps of a piece of work, and again each time a step starts or
// finishes; the call itself reaches Jarvis the way every other tool call does,
// through the PostToolUse hook, and the Deck's Plan block draws it. So this
// reads nothing, runs nothing and sends nothing anywhere: it answers with a
// count. That is why Jarvis may approve it on its own (ADR 0034).
//
// The protocol is JSON-RPC 2.0, one message per line. Node only, no
// dependencies: it is part of the Carried personality, registered by Connect
// as the server `jarvis` and run by the `node` Claude Code itself needs.

const SERVER = { name: 'jarvis', version: '1.0.0' }

/**
 * The protocol versions this server speaks, oldest first. It only offers a
 * tool, which every one of them does the same way. A client asking for one of
 * these gets it back; one asking for any other, or none, is answered with the
 * latest here, and decides for itself whether to go on (the MCP handshake).
 */
const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
const LATEST = PROTOCOLS[PROTOCOLS.length - 1]

/** The same tool, schema and wording as the plan-progress mod it replaces. */
const TOOL = {
  name: 'update_plan',
  description:
    'Shows the current plan as live progress in Jarvis. Call it with the whole list of steps ' +
    'when you start multi-step work, and again each time a step starts or finishes.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The step, in the language of the conversation' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeLabel: { type: 'string', description: 'Present-continuous form shown while in progress' },
          },
          required: ['label', 'status'],
        },
      },
    },
    required: ['steps'],
  },
}

/** What a call answers: the count, or why it could not be read. */
function called(params) {
  if (params?.name !== TOOL.name) {
    return { content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }], isError: true }
  }
  const steps = params.arguments?.steps
  if (!Array.isArray(steps)) {
    return { content: [{ type: 'text', text: 'steps must be a list of { label, status }' }], isError: true }
  }
  const done = steps.filter((step) => step?.status === 'completed').length
  return { content: [{ type: 'text', text: `Plan shown: ${done}/${steps.length} steps done.` }] }
}

/** The reply to one message, or null when it wants none (a notification). */
function answer(message) {
  if (typeof message !== 'object' || message === null) return null
  const { id, method, params } = message
  if (id === undefined || id === null) return null
  const result = (value) => ({ jsonrpc: '2.0', id, result: value })
  switch (method) {
    case 'initialize':
      return result({
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : LATEST,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      })
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: [TOOL] })
    case 'tools/call':
      return result(called(params))
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

function send(reply) {
  process.stdout.write(`${JSON.stringify(reply)}\n`)
}

let pending = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  pending += chunk
  let end
  while ((end = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, end).trim()
    pending = pending.slice(end + 1)
    if (line === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    const reply = answer(message)
    if (reply) send(reply)
  }
})
// Claude Code closing the pipe is the end of the session: leave with it.
process.stdin.on('end', () => process.exit(0))
