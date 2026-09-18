import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigurator, UnreadableSettingsError } from '../src/core/claude-config.js'

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
