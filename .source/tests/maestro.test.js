import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigurator } from '../src/core/claude-config.js'
import {
  hasSkillsPackage,
  maestroPlacements,
  pluginsFileIn,
  refusalFileIn,
  rememberRefusal,
  wasRefused,
  INSTALL_COMMAND,
  MAESTRO,
  PACKAGE,
} from '../src/core/maestro.js'

// The Maestro leans on eight skills from a package it does not own. If the
// machine has that package installed it reads the installed copy, which may be
// newer than the one Jarvis carries; if it does not, Jarvis places its own
// copies beside the Maestro. Everything downstream turns on this one question,
// and it is asked inside Connect — so the one thing it may never do is throw.

let directory
let pluginsFile

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-maestro-'))
  pluginsFile = path.join(directory, 'plugins', 'installed_plugins.json')
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function writePlugins(contents) {
  fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
  fs.writeFileSync(pluginsFile, contents, 'utf8')
}

describe('is the skills package installed on this machine', () => {
  it('finds it in the file Claude Code actually writes', () => {
    // Verbatim shape of a real installed_plugins.json, version 2.
    writePlugins(
      JSON.stringify({
        version: 2,
        plugins: {
          'mattpocock-skills@claude-plugins-official': [
            { scope: 'user', installPath: 'C:/x/mattpocock-skills/1.2.3', version: '1.2.3' },
          ],
        },
      }),
    )
    expect(hasSkillsPackage(pluginsFile)).toBe(true)
  })

  it('finds it in the older shape, which keyed the plugins at the top level', () => {
    writePlugins(
      JSON.stringify({ 'mattpocock-skills@claude-plugins-official': { installPath: '/somewhere' } }),
    )
    expect(hasSkillsPackage(pluginsFile)).toBe(true)
  })

  it('says no when the file lists other plugins but not this one', () => {
    writePlugins(JSON.stringify({ version: 2, plugins: { 'something-else@marketplace': [] } }))
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no when the record exists but holds no plugins at all', () => {
    writePlugins(JSON.stringify({ version: 2, plugins: {} }))
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no when there is no file at all', () => {
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no rather than throwing when the file will not parse', () => {
    writePlugins('{ this is not json')
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no when the file parses to something that is not an object', () => {
    writePlugins('["mattpocock-skills@claude-plugins-official"]')
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no when the plugins field is not an object either', () => {
    writePlugins(JSON.stringify({ version: 2, plugins: ['mattpocock-skills@x'] }))
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('says no rather than throwing when the path cannot be read at all', () => {
    fs.mkdirSync(pluginsFile, { recursive: true }) // a directory where a file should be
    expect(hasSkillsPackage(pluginsFile)).toBe(false)
  })

  it('names the package and the command in one place', () => {
    expect(PACKAGE).toBe('mattpocock-skills')
    expect(INSTALL_COMMAND).toContain('mattpocock-skills@claude-plugins-official')
  })
})

describe('what Jarvis places so the Maestro is there', () => {
  const carried = path.join('D:', 'Jarvis', 'Brain')

  function placements(packageInstalled) {
    return maestroPlacements({ carried, claudeFolder: directory, packageInstalled })
  }

  it('places the instruction under the name Claude Code finds it by', () => {
    const [skill] = placements(true)
    expect(skill.source).toBe(path.join(carried, 'MAESTRO.md'))
    expect(skill.destination).toBe(path.join(directory, 'skills', MAESTRO, 'SKILL.md'))
  })

  it('leaves the embedded copies at home when the package is installed', () => {
    expect(placements(true)).toHaveLength(1)
  })

  it('carries the embedded copies when the package is absent', () => {
    const [, copies] = placements(false)
    expect(copies.source).toBe(path.join(carried, 'matt'))
    expect(copies.destination).toBe(path.join(directory, 'skills', MAESTRO, 'matt'))
  })

  it('can do without every one of them, so Connect always finishes', () => {
    for (const each of placements(false)) expect(each.optional).toBe(true)
  })

  it('looks for the installed plugins where Claude Code keeps them', () => {
    expect(pluginsFileIn(directory)).toBe(
      path.join(directory, 'plugins', 'installed_plugins.json'),
    )
  })
})

describe('Connect places the Maestro, Disconnect takes it back', () => {
  let carried
  let claudeFolder

  beforeEach(() => {
    carried = path.join(directory, 'carried', 'maestro')
    fs.mkdirSync(path.join(carried, 'matt', 'tdd'), { recursive: true })
    fs.writeFileSync(path.join(carried, 'MAESTRO.md'), 'the maestro', 'utf8')
    fs.writeFileSync(path.join(carried, 'matt', 'tdd', 'SKILL.md'), 'red green', 'utf8')
    claudeFolder = path.join(directory, 'home', '.claude')
    fs.mkdirSync(claudeFolder, { recursive: true })
  })

  function connector(packageInstalled) {
    return createConfigurator({
      settingsFile: path.join(claudeFolder, 'settings.json'),
      memoryFile: path.join(claudeFolder, '.jarvis-config-memory.json'),
      desired: { outputStyle: 'Resumo leigo' },
      placements: maestroPlacements({ carried, claudeFolder, packageInstalled }),
    })
  }

  /** Every path under the host's Claude Code folder, so nothing can be missed. */
  function contents() {
    const found = []
    const walk = (folder, prefix) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort()) {
        const here = path.join(prefix, entry.name)
        if (entry.isDirectory()) walk(path.join(folder, entry.name), here)
        else found.push(here)
      }
    }
    walk(claudeFolder, '')
    return found.sort()
  }

  const skill = path.join('skills', 'maestro', 'SKILL.md')
  const copies = path.join('skills', 'maestro', 'matt', 'tdd', 'SKILL.md')

  it('places only the instruction when the machine has the package', () => {
    connector(true).apply()
    expect(contents()).toContain(skill)
    expect(contents()).not.toContain(copies)
  })

  it('places the embedded copies too when it does not', () => {
    connector(false).apply()
    expect(contents()).toContain(skill)
    expect(contents()).toContain(copies)
  })

  it('leaves the host folder exactly as it found it', () => {
    fs.writeFileSync(path.join(claudeFolder, 'settings.json'), '{"theme":"dark"}', 'utf8')
    const before = contents()

    const c = connector(false)
    c.apply()
    expect(contents()).not.toEqual(before)
    c.remove()

    expect(contents()).toEqual(before)
    expect(fs.existsSync(path.join(claudeFolder, 'skills'))).toBe(false)
  })

  it("never touches a Maestro the host wrote itself", () => {
    const mine = path.join(claudeFolder, 'skills', 'maestro')
    fs.mkdirSync(mine, { recursive: true })
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my own maestro', 'utf8')

    const c = connector(true)
    c.apply()
    expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('my own maestro')
    c.remove()
    // still there, and still theirs
    expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('my own maestro')
  })

  it('keeps the first Connect’s record when Connect runs twice', () => {
    const mine = path.join(claudeFolder, 'skills', 'maestro')
    fs.mkdirSync(mine, { recursive: true })
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my own maestro', 'utf8')

    connector(false).apply()
    connector(false).apply()
    connector(false).remove()

    // The host's own instruction is still theirs, not deleted behind Jarvis's
    // second look at a folder Jarvis had by then filled itself.
    expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('my own maestro')
  })

  it('starts carrying the embedded copies when the package goes away', () => {
    // Connected while the machine had the package, so only the instruction was
    // placed. The user then uninstalls it. The next Connect has to notice.
    connector(true).apply()
    expect(contents()).not.toContain(copies)

    const c = connector(false)
    c.apply()
    expect(contents()).toContain(copies)
    expect(c.isApplied()).toBe(true)

    c.remove()
    expect(fs.existsSync(path.join(claudeFolder, 'skills'))).toBe(false)
  })

  it('never claims a placement it failed to make, nor what lands there later', () => {
    fs.rmSync(carried, { recursive: true, force: true })
    const c = connector(false)
    c.apply()
    // Nothing was placed, and no empty folder was left behind by the attempt
    expect(fs.existsSync(path.join(claudeFolder, 'skills'))).toBe(false)

    // The user writes a Maestro of their own where Jarvis could not put one
    const mine = path.join(claudeFolder, 'skills', 'maestro')
    fs.mkdirSync(mine, { recursive: true })
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my own maestro', 'utf8')

    c.remove()
    expect(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8')).toBe('my own maestro')
  })

  it("leaves an empty folder of the host's own standing inside one of ours", () => {
    const c = connector(true)
    c.apply()
    // Jarvis made `skills`; this one under it is the host's, and empty
    const theirs = path.join(claudeFolder, 'skills', 'half-written-skill')
    fs.mkdirSync(theirs, { recursive: true })

    c.remove()
    expect(fs.existsSync(theirs)).toBe(true)
    expect(fs.existsSync(path.join(claudeFolder, 'skills', 'maestro'))).toBe(false)
  })

  it('finishes Connect when the carried Maestro is not on this disk', () => {
    fs.rmSync(carried, { recursive: true, force: true })
    const c = connector(false)
    expect(() => c.apply()).not.toThrow()
    expect(JSON.parse(fs.readFileSync(path.join(claudeFolder, 'settings.json'), 'utf8')).outputStyle).toBe(
      'Resumo leigo',
    )
    expect(c.isApplied()).toBe(true)
  })
})

describe('offering the package, once', () => {
  let refusalFile

  beforeEach(() => {
    refusalFile = refusalFileIn(directory)
  })

  it('has not been turned down on a machine that has never seen Jarvis', () => {
    expect(wasRefused(refusalFile)).toBe(false)
  })

  it('remembers a no, and never asks again', () => {
    rememberRefusal(refusalFile)
    expect(wasRefused(refusalFile)).toBe(true)
    expect(JSON.parse(fs.readFileSync(refusalFile, 'utf8')).answered).toBe('declined')
  })

  it('counts a record it cannot read as a no rather than asking again', () => {
    fs.writeFileSync(refusalFile, 'not json at all', 'utf8')
    expect(wasRefused(refusalFile)).toBe(true)
  })

  it('keeps the answer out of the portable folder, beside the host settings', () => {
    expect(path.dirname(refusalFile)).toBe(directory)
  })

  it('says nothing and throws nothing when the answer cannot be written', () => {
    const unwritable = path.join(directory, 'no', 'such', 'folder', 'answer.json')
    expect(() => rememberRefusal(unwritable)).not.toThrow()
  })

  it('survives a Disconnect, which deletes the Connect memory but not this', () => {
    // Different files on purpose: "you already said no" has to outlive
    // unplugging Jarvis and plugging it back in.
    expect(refusalFile).not.toBe(path.join(directory, '.jarvis-config-memory.json'))
  })
})
