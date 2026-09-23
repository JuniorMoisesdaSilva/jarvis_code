import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { electronBinary } from './helpers/electron-path.js'
import { afterEach, describe, expect, it } from 'vitest'

// The one test in the suite that starts a real process, and it earns its keep.
//
// Everything about the hook chain was unit-tested and correct — the command
// line, the payload translation, the routing, the speech — and not one answer
// was ever read aloud. The relay was reading the event with `process.stdin`,
// which in Electron's main process ends immediately with nothing in it. No
// error anywhere: the hook fired, the relay exited zero, and the event
// evaporated. Only running the real thing can catch that, so this does.
//
// It is run the way the launcher runs it: the same binary, told to be Node
// rather than Electron. Started as Electron instead it would work too — and
// take a quarter of a second doing it, which is the whole reason the relay was
// separated out of the app.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELAY = path.join(appRoot, 'src', 'main', 'helpers', 'hook-relay.js')

/**
 * A channel of this test's own, in whatever shape the platform uses: a named
 * pipe on Windows, a socket file anywhere else. Written the way the app writes
 * it, so the address the relay has to reach is the real thing and not a string
 * that happens to work as a file name.
 */
function channelFor(what) {
  const name = `jarvis-hook-${what}-${process.pid}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : path.join(os.tmpdir(), `${name}.sock`)
}

let relay = null

afterEach(() => {
  if (relay && relay.exitCode === null) relay.kill()
  relay = null
})

/** The relay, started exactly as the launcher starts it. */
function startRelay(pipe, extra = {}) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', JARVIS_PIPE: pipe, ...extra }
  // The mark of Jarvis's own terminal is only there when a test puts it there.
  if (!('JARVIS_TERMINAL' in extra)) delete env.JARVIS_TERMINAL
  return spawn(electronBinary(), [RELAY], {
    env,
    stdio: ['pipe', 'ignore', 'ignore'],
  })
}

/** One event in, whatever the pipe heard out. */
function deliver(payload, { pipe, env = {} }) {
  return new Promise((resolve, reject) => {
    const heard = []
    const server = net.createServer((socket) => {
      let received = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        received += chunk
      })
      socket.on('end', () => {
        heard.push(received)
        server.close()
        resolve(heard[0])
      })
    })

    server.on('error', reject)
    server.listen(pipe, () => {
      relay = startRelay(pipe, env)
      relay.on('error', reject)
      relay.on('exit', () => {
        // Exited without the pipe hearing anything: that is the failure this
        // test exists for, and it must not hang the suite waiting for it.
        setTimeout(() => {
          if (heard.length === 0) {
            server.close()
            resolve(null)
          }
        }, 500)
      })
      relay.stdin.end(payload)
    })
  })
}

describe('the relay Claude Code runs', () => {
  it(
    'forwards the event it is handed on standard input',
    async () => {
      const pipe = channelFor('test')
      const event = JSON.stringify({
        session_id: 'test-session',
        cwd: String.raw`C:\Users\me\Projects\thing`,
        hook_event_name: 'Stop',
        last_assistant_message: 'ação, coração, não',
      })

      const received = await deliver(event, { pipe })

      expect(received, 'the pipe heard nothing at all').not.toBeNull()
      expect(JSON.parse(received)).toMatchObject({
        session_id: 'test-session',
        hook_event_name: 'Stop',
        // Accented Portuguese has to survive the trip, or the answer is read
        // aloud mangled.
        last_assistant_message: 'ação, coração, não',
      })
    },
    40_000,
  )

  it(
    'says which of the terminals Jarvis opened the event came from',
    async () => {
      // The one thing Claude Code does not say is where it is running. The
      // terminal Jarvis opens marks its environment, and the relay passes the
      // mark on — it is what tells Jarvis's own session from another window's.
      const pipe = channelFor('terminal')
      const event = JSON.stringify({ session_id: 's', cwd: String.raw`C:\x`, hook_event_name: 'Stop' })

      const received = await deliver(event, { pipe, env: { JARVIS_TERMINAL: 'term-7' } })

      expect(JSON.parse(received)).toMatchObject({ session_id: 's', jarvis_terminal: 'term-7' })
    },
    40_000,
  )

  it(
    'forwards an event it cannot read exactly as it came',
    async () => {
      // Interpreting is not the relay's job. A payload that is not JSON is
      // still Jarvis's to refuse, not the relay's to lose.
      const pipe = channelFor('garbled')
      const received = await deliver('not json', { pipe, env: { JARVIS_TERMINAL: 'term-7' } })

      expect(received).toBe('not json')
    },
    40_000,
  )

  it(
    'exits quietly when there is no Jarvis listening',
    async () => {
      // A hook that fails takes the agent down with it. With nothing on the
      // other end the relay has to give up and report success anyway.
      const pipe = channelFor('nobody')

      const code = await new Promise((resolve, reject) => {
        relay = startRelay(pipe)
        relay.on('error', reject)
        relay.on('exit', resolve)
        relay.stdin.end('{"session_id":"x","hook_event_name":"Stop"}')
      })

      expect(code).toBe(0)
    },
    40_000,
  )

  it(
    'never pulls Electron in behind it',
    () => {
      // The relay runs as Node, where `require('electron')` throws. It reaches
      // for one module of the app's own, and that module has to stay as free of
      // the app as this one is — the day it grows an import of something that
      // wants Electron, every event stops arriving and nothing says why.
      for (const file of [RELAY, path.join(path.dirname(RELAY), 'hook-channel.js')]) {
        const source = fs.readFileSync(file, 'utf8')
        expect(source, `${path.basename(file)} imports Electron`).not.toMatch(
          /require\('electron'\)/,
        )
        for (const reach of source.matchAll(/require\('(\.[^']*)'\)/g)) {
          expect(
            ['./hook-channel'],
            `${path.basename(file)} reaches for ${reach[1]}`,
          ).toContain(reach[1])
        }
      }
    },
  )
})
