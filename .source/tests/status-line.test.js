import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

// The status line is Claude Code's, drawn by Brain/LAYOUT.js, and it is also
// the only place Claude Code tells anyone the context, the cost and the plan
// limits. It prints nothing — Jarvis's Gauge shows what it used to print — and
// hands its payload to Jarvis down the hook pipe, with the folder and branch,
// whether Jarvis is listening, absent, or listening and never answering.
//
// Run the way Claude Code runs it: Node, the payload on standard input.

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(here, '..', '..', 'Brain', 'LAYOUT.js')
const CHANNEL = path.resolve(here, '..', 'src', 'main', 'helpers', 'hook-channel.js')

const payload = (name) => fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8')

function channelFor(what) {
  return `\\\\.\\pipe\\jarvis-status-${what}-${process.pid}`
}

const servers = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** The script run once: what it printed, how it left, and how long it took. */
function run(input, { pipe, terminal = null }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, JARVIS_PIPE: pipe }
    delete env.JARVIS_TERMINAL
    if (terminal) env.JARVIS_TERMINAL = terminal
    const started = Date.now()
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        printed: Buffer.concat(out).toString('utf8'),
        errors: Buffer.concat(err).toString('utf8'),
        code,
        took: Date.now() - started,
      }),
    )
    child.stdin.end(input)
  })
}

/** A Jarvis on `pipe`, keeping whatever it hears. `silent` accepts and never reads. */
function listener(pipe, { silent = false } = {}) {
  const heard = []
  const server = net.createServer((socket) => {
    if (silent) return
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      received += chunk
    })
    socket.on('end', () => heard.push(received))
  })
  servers.push(server)
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(pipe, () => resolve(heard))
  })
}

/** Long enough for a message already sent to have landed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

describe('the status line', () => {
  it(
    'prints nothing, so Claude Code draws no line under its prompt, with nobody listening',
    async () => {
      for (const name of ['status-line', 'status-line-early']) {
        const result = await run(payload(name), { pipe: channelFor('nobody') })
        expect(result.printed).toBe('')
        expect(result.errors).toBe('')
        expect(result.code).toBe(0)
      }
    },
    30_000,
  )

  it(
    'prints nothing with Jarvis listening either, and hands Jarvis the reading',
    async () => {
      const pipe = channelFor('listening')
      const heard = await listener(pipe)

      const result = await run(payload('status-line'), { pipe, terminal: 'term-7' })
      await settle()

      expect(result.printed).toBe('')
      expect(result.errors).toBe('')
      expect(heard).toHaveLength(1)
      const reading = JSON.parse(heard[0])
      // Tagged, so the listener knows it is a status reading and not a hook…
      expect(reading.jarvis_reading).toBe('status')
      // …and marked with the terminal, so it reaches the right window.
      expect(reading.jarvis_terminal).toBe('term-7')
      expect(reading).toMatchObject(JSON.parse(payload('status-line')))
      // With what the status line used to print first: the folder and its branch,
      // empty outside a repository, as this fixture's folder is.
      expect(reading.jarvis_folder).toBe('C:\\nowhere-jarvis')
      expect(reading.jarvis_branch).toBe('')
    },
    30_000,
  )

  it(
    'carries no terminal mark outside a terminal Jarvis opened',
    async () => {
      const pipe = channelFor('unmarked')
      const heard = await listener(pipe)

      await run(payload('status-line'), { pipe })
      await settle()

      expect('jarvis_terminal' in JSON.parse(heard[0])).toBe(false)
    },
    30_000,
  )

  it(
    'reports nothing when Claude Code handed it nothing',
    async () => {
      const pipe = channelFor('empty')
      const heard = await listener(pipe)

      const result = await run('', { pipe })
      await settle()

      expect(result.printed).toBe('')
      expect(heard).toEqual([])
    },
    30_000,
  )

  it(
    'gives up on a Jarvis that never answers, printing nothing and failing nothing',
    async () => {
      const pipe = channelFor('silent')
      await listener(pipe, { silent: true })

      const result = await run(payload('status-line'), { pipe })

      expect(result.printed).toBe('')
      expect(result.code).toBe(0)
      // Node starting is most of this; the wait on the pipe is capped well under it.
      expect(result.took).toBeLessThan(2500)
    },
    30_000,
  )

  it('knocks on the very pipe the app listens on', () => {
    // The script is carried in Brain and cannot reach the app's code, so the
    // address is spelt again there. These are the two halves that must agree.
    const script = fs.readFileSync(SCRIPT, 'utf8')
    const channel = fs.readFileSync(CHANNEL, 'utf8')
    const address = /`\\\\\\\\\.\\\\pipe\\\\jarvis-hook-\$\{who\}`/
    const who = ".replace(/[^A-Za-z0-9_-]/g, '')"
    for (const source of [script, channel]) {
      expect(source).toMatch(address)
      expect(source).toContain(who)
      expect(source).toContain('env.JARVIS_PIPE')
    }
  })
})
