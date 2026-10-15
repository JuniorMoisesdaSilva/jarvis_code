import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isRegistered, read, record, register, unregister, ABSENT, UnreadableSettingsError } from '../src/core/mcp-registration.js'

// ~/.claude.json is Claude Code's own state file, rewritten by Claude Code all
// the time. Jarvis puts one server there on Connect and takes it back on
// Disconnect, and must lose nothing Claude Code wrote meanwhile: so it reads the
// file and writes it back in one step, and writes nothing it does not change.

const PLAN = { type: 'stdio', command: 'node', args: ['C:/Jarvis/Brain/PLAN.js'] }

let directory
let file

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-'))
  file = path.join(directory, '.claude.json')
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

const writeHost = (object) => fs.writeFileSync(file, JSON.stringify(object, null, 2), 'utf8')
const readHost = () => JSON.parse(fs.readFileSync(file, 'utf8'))

/** Puts the file's modification time in the past, so a write would show. */
function age() {
  const then = new Date('2020-01-01T00:00:00Z')
  fs.utimesSync(file, then, then)
  return fs.statSync(file).mtimeMs
}

describe('registering a server', () => {
  it('adds it beside the host’s own, in the host’s key order', () => {
    writeHost({ zeta: 1, mcpServers: { theirs: { command: 'x' } }, alpha: 2 })
    expect(register(file, { jarvis: PLAN })).toBe(true)
    expect(readHost()).toEqual({ zeta: 1, mcpServers: { theirs: { command: 'x' }, jarvis: PLAN }, alpha: 2 })
    expect(Object.keys(readHost())).toEqual(['zeta', 'mcpServers', 'alpha'])
  })

  it('does not write the file at all when the server is already there', () => {
    writeHost({ numStartups: 4, mcpServers: { jarvis: PLAN } })
    const before = age()
    expect(register(file, { jarvis: PLAN })).toBe(false)
    expect(fs.statSync(file).mtimeMs).toBe(before)
  })

  it('reads and writes in one step, with nothing that waits in between', () => {
    // Registering is synchronous from the read to the write: no promise, no
    // timer, nowhere for Claude Code's own write to land and be overwritten.
    writeHost({ numStartups: 1 })
    const result = register(file, { jarvis: PLAN })
    expect(result).toBe(true)
    expect(typeof result?.then).toBe('undefined')
    // A write Claude Code makes after ours survives, and one before it was read.
    const host = readHost()
    host.numStartups = 2
    writeHost(host)
    expect(register(file, { jarvis: PLAN })).toBe(false)
    expect(readHost().numStartups).toBe(2)
  })

  it('refuses a file it cannot read, writing nothing', () => {
    fs.writeFileSync(file, '{ broken', 'utf8')
    expect(() => register(file, { jarvis: PLAN })).toThrow(UnreadableSettingsError)
    expect(fs.readFileSync(file, 'utf8')).toBe('{ broken')
  })

  it('refuses a server list that is not a list', () => {
    writeHost({ mcpServers: ['x'] })
    expect(() => read(file)).toThrow(UnreadableSettingsError)
  })

  it('knows whether it is registered', () => {
    expect(isRegistered(file, { jarvis: PLAN })).toBe(false)
    writeHost({ mcpServers: { jarvis: { ...PLAN, args: ['elsewhere'] } } })
    expect(isRegistered(file, { jarvis: PLAN })).toBe(false)
    register(file, { jarvis: PLAN })
    expect(isRegistered(file, { jarvis: PLAN })).toBe(true)
    fs.writeFileSync(file, '{ broken', 'utf8')
    expect(isRegistered(file, { jarvis: PLAN })).toBe(false)
  })
})

describe('unregistering', () => {
  it('puts back what each name held, and drops a list Jarvis made', () => {
    writeHost({ numStartups: 3 })
    const kept = record(undefined, read(file).servers, ['jarvis'])
    expect(kept).toEqual({ hadServers: false, servers: { jarvis: ABSENT } })
    register(file, { jarvis: PLAN })
    expect(unregister(file, kept)).toBe(true)
    expect(readHost()).toEqual({ numStartups: 3 })
  })

  it('puts back a server of the host’s own by the same name', () => {
    const theirs = { command: 'their-jarvis.exe' }
    writeHost({ mcpServers: { jarvis: theirs } })
    const kept = record(undefined, read(file).servers, ['jarvis'])
    register(file, { jarvis: PLAN })
    // A second record keeps the first value, not Jarvis's.
    const again = record(kept, read(file).servers, ['jarvis'])
    expect(again.servers.jarvis).toEqual(theirs)
    unregister(file, again)
    expect(readHost()).toEqual({ mcpServers: { jarvis: theirs } })
  })

  it('writes nothing when the file is already as the record says, or gone', () => {
    writeHost({ numStartups: 3 })
    const before = age()
    expect(unregister(file, { hadServers: false, servers: { jarvis: ABSENT } })).toBe(false)
    expect(fs.statSync(file).mtimeMs).toBe(before)
    fs.rmSync(file)
    expect(unregister(file, { hadServers: false, servers: { jarvis: ABSENT } })).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })
})
