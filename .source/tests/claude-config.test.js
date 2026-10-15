import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigurator, localizedStyle, UnreadableSettingsError } from '../src/core/claude-config.js'

// Connect applies Jarvis's whole personality to Claude Code — the output style,
// the status line, and the model — into a file the user owns. Disconnect must
// leave that file exactly as it found it, because a voice assistant that
// silently keeps someone else's editor settings after it is unplugged is a
// betrayal, not a feature. This is where that promise is kept, so it is tested
// hardest.

const STYLE = 'Resumo leigo'
const STATUS = { type: 'command', command: '"D:/Jarvis/win/statusline.ps1"' }
const MODEL = 'opus[1m]'

let directory
let settingsFile
let memoryFile

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-config-'))
  settingsFile = path.join(directory, 'settings.json')
  memoryFile = path.join(directory, 'applied.json')
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function configurator(desired = { outputStyle: STYLE, statusLine: STATUS, model: MODEL }) {
  return createConfigurator({ settingsFile, memoryFile, desired })
}

function writeSettings(object) {
  fs.writeFileSync(settingsFile, JSON.stringify(object, null, 2), 'utf8')
}

function readSettings() {
  return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
}

describe('applying Jarvis to a fresh machine', () => {
  it('writes the style, the status line and the model', () => {
    writeSettings({ theme: 'dark' })
    configurator().apply()
    const after = readSettings()
    expect(after.outputStyle).toBe(STYLE)
    expect(after.statusLine).toEqual(STATUS)
    expect(after.model).toBe(MODEL)
    expect(after.theme).toBe('dark') // leaves the rest of the file alone
  })

  it('creates the settings file when there was none', () => {
    configurator().apply()
    expect(readSettings().outputStyle).toBe(STYLE)
  })

  it('reports itself applied only when all managed keys match', () => {
    const c = configurator()
    expect(c.isApplied()).toBe(false)
    c.apply()
    expect(c.isApplied()).toBe(true)
  })
})

describe('unplugging Jarvis', () => {
  it("restores the host's own values", () => {
    writeSettings({ outputStyle: 'Explanatory', model: 'sonnet', theme: 'light' })
    const c = configurator()
    c.apply()
    expect(readSettings().outputStyle).toBe(STYLE)
    c.remove()
    const after = readSettings()
    expect(after.outputStyle).toBe('Explanatory')
    expect(after.model).toBe('sonnet')
    expect(after.theme).toBe('light')
  })

  it('deletes keys the host never had, rather than leaving Jarvis behind', () => {
    writeSettings({ theme: 'dark' })
    const c = configurator()
    c.apply()
    c.remove()
    const after = readSettings()
    expect('outputStyle' in after).toBe(false)
    expect('statusLine' in after).toBe(false)
    expect('model' in after).toBe(false)
    expect(after.theme).toBe('dark')
  })

  it('does nothing when it was never applied', () => {
    writeSettings({ outputStyle: 'Explanatory' })
    configurator().remove()
    expect(readSettings().outputStyle).toBe('Explanatory')
  })
})

describe('applying twice does not lose the original', () => {
  it('remembers the very first host value, not Jarvis\u2019s own', () => {
    writeSettings({ outputStyle: 'Explanatory' })
    const c = configurator()
    c.apply()
    c.apply() // second Connect must not record "Resumo leigo" as the host's value
    c.remove()
    expect(readSettings().outputStyle).toBe('Explanatory')
  })
})

describe('a personality that changed between Connect and Disconnect', () => {
  it('undoes exactly what Connect wrote, not what it now wants', () => {
    writeSettings({ model: 'sonnet' })
    // Connect with a personality that carries a language.
    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE, model: MODEL, language: 'portuguese' },
    }).apply()
    expect(readSettings().language).toBe('portuguese')

    // Disconnect from a newer copy whose personality dropped `language`.
    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE, model: MODEL },
    }).remove()

    const after = readSettings()
    // the host never had a language, so Jarvis's is gone, not left behind
    expect('language' in after).toBe(false)
    // and the host's own model is back
    expect(after.model).toBe('sonnet')
    expect('outputStyle' in after).toBe(false)
  })
})

describe('a settings file that cannot be parsed', () => {
  it('is refused rather than overwritten', () => {
    fs.writeFileSync(settingsFile, '{ not valid json', 'utf8')
    expect(() => configurator().apply()).toThrow(UnreadableSettingsError)
    // untouched
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ not valid json')
  })
})

describe('a partial personality', () => {
  it('applies only the keys it was given', () => {
    writeSettings({})
    createConfigurator({ settingsFile, memoryFile, desired: { outputStyle: STYLE } }).apply()
    const after = readSettings()
    expect(after.outputStyle).toBe(STYLE)
    expect('statusLine' in after).toBe(false)
    expect('model' in after).toBe(false)
  })
})

describe('placing what Claude Code has to find on disk', () => {
  let source
  let destination

  beforeEach(() => {
    source = path.join(directory, 'carried-style.md')
    destination = path.join(directory, 'home', 'output-styles', 'resumo-leigo.md')
    fs.writeFileSync(source, '---\nname: Resumo leigo\n---\nbody', 'utf8')
  })

  function withStyle() {
    return createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true }],
    })
  }

  it('copies the style file in on Connect and removes it on Disconnect', () => {
    const c = withStyle()
    c.apply()
    expect(fs.existsSync(destination)).toBe(true)
    expect(fs.readFileSync(destination, 'utf8')).toContain('name: Resumo leigo')
    c.remove()
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('writes what a placement renders instead of a word-for-word copy', () => {
    const c = createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true, render: (text) => text.toUpperCase() }],
    })
    c.apply()
    expect(fs.readFileSync(destination, 'utf8')).toBe('---\nNAME: RESUMO LEIGO\n---\nBODY')
    c.remove()
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('is not applied until the style file is actually in place', () => {
    const c = withStyle()
    expect(c.isApplied()).toBe(false)
    c.apply()
    expect(c.isApplied()).toBe(true)
  })

  it("leaves a host's own style file of the same name untouched", () => {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, 'the host’s own style', 'utf8')
    const c = withStyle()
    c.apply()
    c.remove()
    // never overwritten, never deleted
    expect(fs.readFileSync(destination, 'utf8')).toBe('the host’s own style')
  })

  it('copies a whole folder in, and takes the whole folder back', () => {
    const folder = path.join(directory, 'carried-maestro')
    fs.mkdirSync(path.join(folder, 'matt', 'tdd'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'SKILL.md'), 'the maestro', 'utf8')
    fs.writeFileSync(path.join(folder, 'matt', 'tdd', 'SKILL.md'), 'red green', 'utf8')
    const into = path.join(directory, 'home', 'skills', 'maestro')

    const c = createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source: folder, destination: into }],
    })
    c.apply()
    expect(fs.readFileSync(path.join(into, 'matt', 'tdd', 'SKILL.md'), 'utf8')).toBe('red green')
    c.remove()
    expect(fs.existsSync(into)).toBe(false)
  })

  it('undoes what Connect placed even when the list has shrunk since', () => {
    // The Maestro's embedded copies are placed only when the skills package is
    // absent. Install the package between Connect and Disconnect and the
    // placement is gone from the list — but the folder is still on the host.
    const folder = path.join(directory, 'carried-matt')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'SKILL.md'), 'a copy', 'utf8')
    const into = path.join(directory, 'home', 'skills', 'maestro', 'matt')
    const placement = { source: folder, destination: into }

    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true }, placement],
    }).apply()
    expect(fs.existsSync(into)).toBe(true)

    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true }],
    }).remove()
    expect(fs.existsSync(into)).toBe(false)
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('finishes Connect when an optional placement cannot be copied', () => {
    const c = createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [
        { source, destination, legacy: true },
        { source: path.join(directory, 'nothing-here'), destination: path.join(directory, 'home', 'skills', 'maestro'), optional: true },
      ],
    })
    expect(() => c.apply()).not.toThrow()
    expect(readSettings().outputStyle).toBe(STYLE)
    expect(fs.existsSync(destination)).toBe(true)
    // and a placement Jarvis could do without does not hold Connect open
    expect(c.isApplied()).toBe(true)
  })

  it('still takes back a style file a previous version of Jarvis placed', () => {
    // That version recorded one boolean rather than a list of paths.
    const c = withStyle()
    c.apply()
    const memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
    delete memory.__placed__
    memory.__styleFilePlaced__ = true
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), 'utf8')

    c.remove()
    expect(fs.existsSync(destination)).toBe(false)
    expect(readSettings().outputStyle).toBeUndefined()
  })
})

describe('a style file Jarvis adopts and keeps up to date', () => {
  let source
  let destination

  beforeEach(() => {
    source = path.join(directory, 'carried-style.md')
    destination = path.join(directory, 'home', 'output-styles', 'resumo-leigo.md')
    fs.writeFileSync(source, 'the carried style', 'utf8')
  })

  function adopting() {
    return createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true, adopt: true }],
    })
  }

  function hostHas(text) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, text, 'utf8')
  }

  it("takes over a host's own file of that name on Connect, and gives it back on Disconnect", () => {
    hostHas('the host’s own style')
    const c = adopting()
    c.apply()
    expect(fs.readFileSync(destination, 'utf8')).toBe('the carried style')
    c.remove()
    expect(fs.readFileSync(destination, 'utf8')).toBe('the host’s own style')
  })

  it('brings a placed file up to what Brain carries now, and says so', () => {
    const c = adopting()
    c.apply()
    fs.writeFileSync(source, 'the carried style, edited', 'utf8')
    expect(c.refresh()).toBe(true)
    expect(fs.readFileSync(destination, 'utf8')).toBe('the carried style, edited')
    expect(c.refresh()).toBe(false)
  })

  it("adopts a host's own file on a machine connected before adoption existed", () => {
    // Connected while the file was the host's: Jarvis set the style name but
    // never placed the file, so the copy went stale.
    hostHas('an older copy')
    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination, legacy: true }],
    }).apply()
    expect(fs.readFileSync(destination, 'utf8')).toBe('an older copy')

    const c = adopting()
    expect(c.refresh()).toBe(true)
    expect(fs.readFileSync(destination, 'utf8')).toBe('the carried style')
    c.remove()
    expect(fs.readFileSync(destination, 'utf8')).toBe('an older copy')
  })

  it('writes nothing on a machine never connected', () => {
    hostHas('the host’s own style')
    expect(adopting().refresh()).toBe(false)
    expect(fs.readFileSync(destination, 'utf8')).toBe('the host’s own style')
    expect(fs.existsSync(memoryFile)).toBe(false)
  })
})

describe('the style file, described in the panel\u2019s language', () => {
  const carried = [
    '---',
    'name: Resumo leigo',
    'description: A short reply in plain language',
    'description-pt: Uma resposta curta em linguagem comum',
    'keep-coding-instructions: true',
    '---',
    '',
    'description: in the body, untouched',
  ].join('\n')

  it('keeps the English description on EN, and drops the Portuguese one', () => {
    const placed = localizedStyle(carried, false)
    expect(placed).toContain('description: A short reply in plain language\n')
    expect(placed).not.toContain('description-pt')
    expect(placed).toContain('keep-coding-instructions: true')
  })

  it('puts the Portuguese description under the name Claude Code reads on PT', () => {
    const placed = localizedStyle(carried, true)
    expect(placed).toContain('description: Uma resposta curta em linguagem comum\n')
    expect(placed).not.toContain('A short reply')
    expect(placed).not.toContain('description-pt')
    expect(placed.endsWith('description: in the body, untouched')).toBe(true)
  })

  it('leaves a file with no Portuguese description as it is, bar nothing', () => {
    const plain = '---\nname: x\ndescription: only English\n---\nbody'
    expect(localizedStyle(plain, true)).toBe(plain)
    expect(localizedStyle(plain, false)).toBe(plain)
  })
})

// The plan tool is an MCP server, and Claude Code keeps the user's servers in
// a second file, ~/.claude.json — its own state file, full of things that are
// not Jarvis's. Connect adds one entry there and Disconnect puts back whatever
// that entry was, through the same record that remembers the settings.
describe('registering the plan server', () => {
  const PLAN = { type: 'stdio', command: 'node', args: ['D:/Jarvis/Brain/PLAN.js'] }
  let hostFile

  beforeEach(() => {
    hostFile = path.join(directory, '.claude.json')
  })

  function withServer(servers = { jarvis: PLAN }) {
    return createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      mcp: { file: hostFile, servers },
    })
  }

  function writeHost(object) {
    fs.writeFileSync(hostFile, JSON.stringify(object, null, 2), 'utf8')
  }

  function readHost() {
    return JSON.parse(fs.readFileSync(hostFile, 'utf8'))
  }

  it('adds the server under the name jarvis, beside the host’s own', () => {
    const theirs = { type: 'stdio', command: 'npx', args: ['their-server'] }
    writeHost({ numStartups: 12, mcpServers: { theirs }, projects: { 'C:/x': {} } })
    withServer().apply()
    const after = readHost()
    expect(after.mcpServers).toEqual({ theirs, jarvis: PLAN })
    expect(after.numStartups).toBe(12)
    expect(after.projects).toEqual({ 'C:/x': {} })
  })

  it('leaves the order of the host’s own file as it was', () => {
    writeHost({ zeta: 1, alpha: 2 })
    withServer().apply()
    expect(Object.keys(readHost())).toEqual(['zeta', 'alpha', 'mcpServers'])
  })

  it('is not applied until the server is there, and is once it is', () => {
    writeHost({})
    const c = withServer()
    expect(c.isApplied()).toBe(false)
    c.apply()
    expect(c.isApplied()).toBe(true)
    const host = readHost()
    delete host.mcpServers
    writeHost(host)
    expect(c.isApplied()).toBe(false)
  })

  it('takes the server away on Disconnect, and the list it had to make', () => {
    writeHost({ numStartups: 3 })
    const c = withServer()
    c.apply()
    c.remove()
    expect(readHost()).toEqual({ numStartups: 3 })
  })

  it('keeps the host’s other servers on Disconnect', () => {
    const theirs = { type: 'stdio', command: 'npx', args: ['their-server'] }
    writeHost({ mcpServers: { theirs } })
    const c = withServer()
    c.apply()
    c.remove()
    expect(readHost()).toEqual({ mcpServers: { theirs } })
  })

  it('puts back a server of the host’s own that went by the same name', () => {
    const before = { type: 'stdio', command: 'their-jarvis.exe', args: [] }
    writeHost({ mcpServers: { jarvis: before } })
    const c = withServer()
    c.apply()
    c.apply() // a second Connect must not record Jarvis's own entry as the host's
    expect(readHost().mcpServers.jarvis).toEqual(PLAN)
    c.remove()
    expect(readHost()).toEqual({ mcpServers: { jarvis: before } })
  })

  it('creates the file when there was none, and leaves an empty one on Disconnect', () => {
    const c = withServer()
    c.apply()
    expect(readHost()).toEqual({ mcpServers: { jarvis: PLAN } })
    c.remove()
    expect(readHost()).toEqual({})
  })

  it('records the server in the same memory as the settings', () => {
    writeHost({})
    withServer().apply()
    expect(JSON.stringify(JSON.parse(fs.readFileSync(memoryFile, 'utf8')))).toContain('__mcp__')
  })

  it('adds the server on a Connect made over a memory from before the plan tool', () => {
    writeSettings({ outputStyle: 'Explanatory' })
    configurator().apply() // an older Jarvis: settings only
    writeHost({})
    const c = withServer()
    c.apply()
    expect(readHost().mcpServers.jarvis).toEqual(PLAN)
    c.remove()
    expect(readHost()).toEqual({})
    expect(readSettings().outputStyle).toBe('Explanatory')
  })

  it('keeps what Claude Code wrote to its file while Connect was copying the placements', () => {
    // Claude Code rewrites ~/.claude.json all the time. Connect reads it and
    // writes it back in one step, after everything else, so a change Claude
    // Code makes while the style is being copied is not written over.
    writeHost({ numStartups: 1 })
    const source = path.join(directory, 'style.md')
    fs.writeFileSync(source, 'style', 'utf8')
    createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [
        {
          source,
          destination: path.join(directory, 'styles', 'style.md'),
          render: (text) => {
            writeHost({ ...readHost(), numStartups: 2, tipsHistory: { x: 1 } })
            return text
          },
        },
      ],
      mcp: { file: hostFile, servers: { jarvis: PLAN } },
    }).apply()
    expect(readHost()).toEqual({ numStartups: 2, tipsHistory: { x: 1 }, mcpServers: { jarvis: PLAN } })
  })

  it('does not write the host’s file on a Connect that finds the server already there', () => {
    writeHost({ mcpServers: { jarvis: PLAN } })
    const c = withServer()
    c.apply()
    const then = new Date('2020-01-01T00:00:00Z')
    fs.utimesSync(hostFile, then, then)
    const before = fs.statSync(hostFile).mtimeMs
    c.apply()
    expect(fs.statSync(hostFile).mtimeMs).toBe(before)
  })

  it('leaves the host’s file alone when only the settings are followed (the language switch)', () => {
    const c = withServer()
    c.apply()
    fs.writeFileSync(hostFile, '{ broken', 'utf8') // would throw if it were read
    expect(() => c.apply({ servers: false })).not.toThrow()
    expect(fs.readFileSync(hostFile, 'utf8')).toBe('{ broken')
  })

  it('refuses a host file it cannot read, writing nothing anywhere', () => {
    fs.writeFileSync(hostFile, '{ broken', 'utf8')
    writeSettings({ theme: 'dark' })
    expect(() => withServer().apply()).toThrow(UnreadableSettingsError)
    expect(fs.readFileSync(hostFile, 'utf8')).toBe('{ broken')
    expect(readSettings()).toEqual({ theme: 'dark' })
    expect(fs.existsSync(memoryFile)).toBe(false)
  })
})

// Disconnect undoes several things — the settings, the server, the placements,
// the memory. One that fails must not stop the others: every step is tried, and
// the first failure is reported once they all have been.
describe('a Disconnect that meets a failure', () => {
  const PLAN = { type: 'stdio', command: 'node', args: ['D:/Jarvis/Brain/PLAN.js'] }
  let hostFile
  let source
  let destination

  beforeEach(() => {
    hostFile = path.join(directory, '.claude.json')
    source = path.join(directory, 'style.md')
    destination = path.join(directory, 'styles', 'resumo.md')
    fs.writeFileSync(source, 'style', 'utf8')
  })

  function full() {
    return createConfigurator({
      settingsFile,
      memoryFile,
      desired: { outputStyle: STYLE },
      placements: [{ source, destination }],
      mcp: { file: hostFile, servers: { jarvis: PLAN } },
    })
  }

  it('still takes the server and the placements back when the settings cannot be read', () => {
    fs.writeFileSync(hostFile, JSON.stringify({ numStartups: 1 }), 'utf8')
    const c = full()
    c.apply()
    fs.writeFileSync(settingsFile, '{ broken', 'utf8')
    expect(() => c.remove()).toThrow(UnreadableSettingsError)
    expect(JSON.parse(fs.readFileSync(hostFile, 'utf8'))).toEqual({ numStartups: 1 })
    expect(fs.existsSync(destination)).toBe(false)
    // The memory stays, so a Disconnect once the file is fixed still restores it.
    expect(fs.existsSync(memoryFile)).toBe(true)
    writeSettings({ outputStyle: STYLE })
    c.remove()
    expect(readSettings()).toEqual({})
    expect(fs.existsSync(memoryFile)).toBe(false)
  })

  it('still restores the settings and the placements when the host’s MCP file cannot be read', () => {
    writeSettings({ outputStyle: 'Explanatory' })
    const c = full()
    c.apply()
    fs.writeFileSync(hostFile, '{ broken', 'utf8')
    expect(() => c.remove()).toThrow(UnreadableSettingsError)
    expect(readSettings()).toEqual({ outputStyle: 'Explanatory' })
    expect(fs.existsSync(destination)).toBe(false)
    expect(fs.readFileSync(hostFile, 'utf8')).toBe('{ broken')
  })
})
