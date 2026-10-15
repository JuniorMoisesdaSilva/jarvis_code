import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Jarvis's plan tool is a process Claude Code starts and talks to over its
// standard input and output, one JSON-RPC message per line. So it is tested as
// one: started for real, spoken to, and listened to.

const SERVER = fileURLToPath(new URL('../../Brain/PLAN.js', import.meta.url))

let server = null

afterEach(() => {
  if (server && server.exitCode === null) server.kill()
  server = null
})

/** The server, started the way Claude Code starts it, and a way to ask it things. */
function start() {
  server = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'ignore'] })
  const waiting = new Map()
  const heard = []
  let pending = ''
  server.stdout.setEncoding('utf8')
  server.stdout.on('data', (chunk) => {
    pending += chunk
    let end
    while ((end = pending.indexOf('\n')) !== -1) {
      const message = JSON.parse(pending.slice(0, end))
      pending = pending.slice(end + 1)
      heard.push(message)
      waiting.get(message.id)?.(message)
    }
  })
  let next = 1
  return {
    heard,
    ask(method, params) {
      const id = next++
      return new Promise((resolve) => {
        waiting.set(id, resolve)
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    tell(method, params) {
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
  }
}

describe('the plan server', () => {
  it('introduces itself as jarvis, offering tools, in the protocol it was asked for', async () => {
    const plan = start()
    const reply = await plan.ask('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '2' },
    })
    expect(reply.result.protocolVersion).toBe('2025-06-18')
    expect(reply.result.capabilities).toEqual({ tools: {} })
    expect(reply.result.serverInfo.name).toBe('jarvis')
  })

  it('echoes a protocol version it knows, and answers its latest to one it does not', async () => {
    const plan = start()
    expect((await plan.ask('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion).toBe('2025-03-26')
    expect((await plan.ask('initialize', { protocolVersion: '2024-11-05' })).result.protocolVersion).toBe('2024-11-05')
    const latest = (await plan.ask('initialize', { protocolVersion: '2099-01-01' })).result.protocolVersion
    expect(latest).toBe('2025-11-25')
    expect((await plan.ask('initialize', {})).result.protocolVersion).toBe(latest)
  })

  it('answers no notification, and still answers what comes after it', async () => {
    const plan = start()
    await plan.ask('initialize', { protocolVersion: '2025-06-18' })
    plan.tell('notifications/initialized')
    const pong = await plan.ask('ping')
    expect(pong.result).toEqual({})
    expect(plan.heard.map((message) => message.id)).toEqual([1, 2])
  })

  it('offers update_plan and nothing else', async () => {
    const plan = start()
    const reply = await plan.ask('tools/list', {})
    expect(reply.result.tools.map((tool) => tool.name)).toEqual(['update_plan'])
    const [tool] = reply.result.tools
    expect(tool.inputSchema.required).toEqual(['steps'])
    expect(tool.inputSchema.properties.steps.items.properties.status.enum).toEqual([
      'pending',
      'in_progress',
      'completed',
    ])
    expect(tool.inputSchema.properties.steps.items.properties.activeLabel.type).toBe('string')
  })

  it('answers a call with how many steps are done', async () => {
    const plan = start()
    const reply = await plan.ask('tools/call', {
      name: 'update_plan',
      arguments: {
        steps: [
          { label: 'Read the code', status: 'completed' },
          { label: 'Write the test', status: 'in_progress', activeLabel: 'Writing the test' },
          { label: 'Make it pass', status: 'pending' },
        ],
      },
    })
    expect(reply.result.isError).toBeUndefined()
    expect(reply.result.content).toEqual([{ type: 'text', text: 'Plan shown: 1/3 steps done.' }])
  })

  it('says so when the steps are not a list', async () => {
    const plan = start()
    const reply = await plan.ask('tools/call', { name: 'update_plan', arguments: { steps: 'all of them' } })
    expect(reply.result.isError).toBe(true)
  })

  it('refuses a method it does not know', async () => {
    const plan = start()
    const reply = await plan.ask('resources/list', {})
    expect(reply.error.code).toBe(-32601)
  })
})

describe('the entry Connect registers for it', () => {
  it('runs this very script with Node, named by forward slashes', async () => {
    const { planServer } = await import('../src/core/platform.js')
    const entry = planServer(SERVER)
    expect(entry).toEqual({ type: 'stdio', command: 'node', args: [SERVER.replace(/\\/g, '/')] })

    // and that entry, run as Claude Code runs it, is a server that answers
    server = spawn(entry.command, entry.args, { stdio: ['pipe', 'pipe', 'ignore'] })
    const reply = await new Promise((resolve) => {
      server.stdout.setEncoding('utf8')
      server.stdout.once('data', (chunk) => resolve(JSON.parse(chunk.split('\n')[0])))
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)
    })
    expect(reply.result.tools[0].name).toBe('update_plan')
  })
})
