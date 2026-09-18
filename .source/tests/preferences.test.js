import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPreferences, defaults, sanitize } from '../src/core/preferences.js'
import { PORTUGUESE, ENGLISH } from '../src/core/language.js'

let directory
let preferences

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-preferences-'))
  preferences = createPreferences(path.join(directory, 'nested', 'preferences.json'))
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function writeRaw(contents) {
  fs.mkdirSync(path.dirname(preferences.file), { recursive: true })
  fs.writeFileSync(preferences.file, contents, 'utf8')
}

/**
 * A project path this machine could have written.
 *
 * What is stored is checked for shape rather than existence — isNativePath, in
 * the core's platform file — so a Windows path handed to a run on a Mac is thrown
 * away before it can be read back, and the test would be measuring the guard
 * instead of the memory it is named for. Spelt per platform, these say the same
 * thing on both machines.
 */
function project(name) {
  return process.platform === 'win32' ? `C:\\p\\${name}` : `/p/${name}`
}

/**
 * A shell name this machine could have stored. The same trap as project(): a
 * name ending .exe is a Windows program, and a Mac reading one drops it. The
 * tests below are about how a value is kept, not about whose it is, so they say
 * it in the local dialect and leave the cross-platform question to the block
 * that is named for it.
 */
const A_SHELL = process.platform === 'win32' ? 'bash.exe' : 'bash'

describe('a file that has not been written yet', () => {
  it('gives the defaults', () => {
    expect(preferences.read()).toEqual(defaults())
  })

  it('reports no previous project', () => {
    expect(preferences.read().projectPath).toBeNull()
    expect(preferences.read().terminalSession).toBeNull()
  })

  it('shows the opening explanation', () => {
    expect(preferences.read().welcomeSeen).toBe(false)
  })

  it('lets the app choose the voice', () => {
    expect(preferences.voiceFor(PORTUGUESE)).toBeNull()
  })
})

describe('a file the user hand-edited badly', () => {
  it('falls back to the defaults when it is not valid JSON', () => {
    writeRaw('{ this was hand-edited badly')
    expect(preferences.read()).toEqual(defaults())
  })

  it('falls back to the defaults when it holds something other than an object', () => {
    for (const contents of ['"powershell"', '[1, 2]', '42', 'null']) {
      writeRaw(contents)
      expect(preferences.read()).toEqual(defaults())
    }
  })

  it('drops keys it does not know about', () => {
    writeRaw(`{ "shell": "${A_SHELL}", "somethingElse": true }`)
    const stored = preferences.read()

    expect(stored.shell).toBe(A_SHELL)
    expect('somethingElse' in stored).toBe(false)
  })

  it('falls back per field, keeping the good values around a bad one', () => {
    writeRaw('{ "shell": 7, "welcomeSeen": true }')
    expect(preferences.read().shell).toBe(defaults().shell)
    expect(preferences.read().welcomeSeen).toBe(true)
  })

  it('refuses a language it does not support', () => {
    writeRaw('{ "language": "fr-FR" }')
    expect(preferences.read().language).toBe(PORTUGUESE)
  })

  // The two shortcut fields were withdrawn on 2 September 2026 with the global
  // shortcuts themselves. Somebody upgrading has them in their file, and the
  // worst outcome available would be refusing to read it over a name we stopped
  // caring about.
  it('reads a file that still carries the withdrawn shortcut fields', () => {
    writeRaw(
      JSON.stringify({
        shell: A_SHELL,
        speechRate: 4,
        micShortcut: 'Control+Alt+J',
        languageShortcut: 'Control+Alt+L',
      }),
    )
    const stored = preferences.read()

    expect(stored.shell).toBe(A_SHELL)
    expect(stored.speechRate).toBe(4)
    expect('micShortcut' in stored).toBe(false)
    expect('languageShortcut' in stored).toBe(false)
  })

  it('keeps the three themes and refuses any other', () => {
    for (const theme of ['dark', 'light', 'iron']) {
      writeRaw(JSON.stringify({ theme }))
      expect(preferences.read().theme).toBe(theme)
    }

    writeRaw('{ "theme": "solarized" }')
    expect(preferences.read().theme).toBe('dark')
  })

  it('never lets a blank value bury the default', () => {
    for (const contents of ['{ "shell": "" }', '{ "shell": "   " }']) {
      writeRaw(contents)
      expect(preferences.read().shell).toBe(defaults().shell)
    }
  })

  it('trims surrounding whitespace off a value', () => {
    writeRaw(`{ "shell": "  ${A_SHELL}  " }`)
    expect(preferences.read().shell).toBe(A_SHELL)
  })
})

describe('writing', () => {
  it('creates the folder it needs', () => {
    preferences.write({ shell: A_SHELL })
    expect(fs.existsSync(preferences.file)).toBe(true)
  })

  it('returns the whole set, not just the patch', () => {
    expect(preferences.write({ shell: A_SHELL })).toEqual({ ...defaults(), shell: A_SHELL })
  })

  it('keeps the default rather than storing a blank value', () => {
    expect(preferences.write({ shell: '  ' }).shell).toBe(defaults().shell)
    expect(preferences.read().shell).toBe(defaults().shell)
  })

  it('survives a round trip through the file', () => {
    preferences.write({ shell: A_SHELL })
    expect(createPreferences(preferences.file).read().shell).toBe(A_SHELL)
  })

  it('writes JSON a person can read and hand-edit', () => {
    preferences.write({ shell: A_SHELL })
    const contents = fs.readFileSync(preferences.file, 'utf8')

    expect(contents).toContain('\n  "shell"')
    expect(contents.endsWith('\n')).toBe(true)
  })
})

describe('remembering a session', () => {
  it('keeps the project and the terminal', () => {
    preferences.rememberSession(project('alpha'), 'shell-4821')

    expect(preferences.read().projectPath).toBe(project('alpha'))
    expect(preferences.read().terminalSession).toBe('shell-4821')
  })

  it('discards the previous conversation when the project changes', () => {
    // The conversation identifier belongs to the old session; carrying it into
    // the new one would make Jarvis answer events that are no longer its own.
    preferences.rememberSession(project('alpha'), 'a')
    preferences.rememberClaudeSession('conversation-1')
    preferences.rememberSession(project('beta'), 'b')

    expect(preferences.read().claudeSession).toBeNull()
  })

  it('clears everything about the session when told to forget', () => {
    preferences.rememberSession(project('alpha'), 't')
    preferences.rememberClaudeSession('c')
    preferences.forgetSession()

    const stored = preferences.read()
    expect(stored.projectPath).toBeNull()
    expect(stored.terminalSession).toBeNull()
    expect(stored.claudeSession).toBeNull()
  })

  it('leaves the unrelated settings alone', () => {
    preferences.write({ shell: A_SHELL })
    preferences.rememberSession(project('alpha'), 't')

    expect(preferences.read().shell).toBe(A_SHELL)
  })
})

describe('the opening explanation', () => {
  it('does not come back once dismissed', () => {
    preferences.markWelcomeSeen()
    expect(preferences.read().welcomeSeen).toBe(true)
  })
})

describe('the reading voice', () => {
  it('is remembered per language', () => {
    preferences.setVoiceFor(PORTUGUESE, 'Microsoft Maria')
    preferences.setVoiceFor(ENGLISH, 'Microsoft Zira')

    expect(preferences.voiceFor(PORTUGUESE)).toBe('Microsoft Maria')
    expect(preferences.voiceFor(ENGLISH)).toBe('Microsoft Zira')
  })

  it('goes back to the app deciding when the choice is erased', () => {
    preferences.setVoiceFor(PORTUGUESE, 'Microsoft Maria')
    preferences.setVoiceFor(PORTUGUESE, null)

    expect(preferences.voiceFor(PORTUGUESE)).toBeNull()
  })

  it('keeps the other language when one is erased', () => {
    preferences.setVoiceFor(PORTUGUESE, 'Microsoft Maria')
    preferences.setVoiceFor(ENGLISH, 'Microsoft Zira')
    preferences.setVoiceFor(PORTUGUESE, null)

    expect(preferences.voiceFor(ENGLISH)).toBe('Microsoft Zira')
  })

  it('ignores a hand-edited voice for a language Jarvis does not speak', () => {
    writeRaw('{ "voices": { "fr-FR": "Microsoft Julie" } }')
    expect(preferences.read().voices).toEqual({})
  })

  it('keeps the valid voice when one entry beside it is junk', () => {
    writeRaw('{ "voices": { "pt-BR": "Microsoft Maria", "fr-FR": "Microsoft Julie" } }')
    expect(preferences.voiceFor(PORTUGUESE)).toBe('Microsoft Maria')
  })

  it('erases only the language asked for, never the whole set', () => {
    preferences.setVoiceFor(PORTUGUESE, 'Microsoft Maria')
    preferences.setVoiceFor(ENGLISH, 'Microsoft Zira')
    preferences.setVoiceFor(ENGLISH, 42)

    expect(preferences.voiceFor(PORTUGUESE)).toBe('Microsoft Maria')
    expect(preferences.voiceFor(ENGLISH)).toBeNull()
  })
})

describe('a collection with one broken entry', () => {
  it('keeps the shortcuts that are fine and drops only the broken one', () => {
    // Throwing away a whole set of hand-made buttons over one bad entry would be
    // the worst outcome available.
    writeRaw(
      JSON.stringify({
        shortcuts: [
          { id: 'a', label: 'Recap', command: '/recap', submits: true },
          { label: 'Half' },
          { id: 'c', label: 'Cost', command: '/cost', submits: true },
        ],
      }),
    )

    expect(preferences.shortcuts().map((each) => each.label)).toEqual(['Recap', 'Cost'])
  })

  it('gives an identifier to a shortcut saved without one', () => {
    writeRaw(JSON.stringify({ shortcuts: [{ label: 'Recap', command: '/recap', submits: true }] }))
    const [only] = preferences.shortcuts()

    expect(only.label).toBe('Recap')
    expect(typeof only.id).toBe('string')
    expect(only.id.length).toBeGreaterThan(0)
  })

  it('does not let saving a broken entry wipe the good ones', () => {
    preferences.setShortcuts([
      { id: 'a', label: 'Recap', command: '/recap', submits: true },
      { label: 'Half' },
    ])

    expect(preferences.shortcuts().map((each) => each.label)).toEqual(['Recap'])
  })
})

describe('a file that cannot be read at all', () => {
  // On Windows this is routinely an antivirus scan or an editor holding a lock.
  // Treating it as absent would let the next write replace everything the user
  // configured with defaults.
  function makeUnreadable() {
    fs.mkdirSync(preferences.file, { recursive: true })
  }

  it('refuses rather than reporting defaults', () => {
    makeUnreadable()
    expect(() => preferences.read()).toThrow(/Couldn't read/)
  })

  it('refuses to write over it, so nothing is lost', () => {
    makeUnreadable()
    expect(() => preferences.write({ shell: A_SHELL })).toThrow(/Couldn't read/)
  })
})

describe('writing safely', () => {
  it('leaves no half-written file behind', () => {
    preferences.write({ shell: A_SHELL })
    const alongside = fs.readdirSync(path.dirname(preferences.file))

    expect(alongside).toEqual(['preferences.json'])
  })

  it('recovers from a truncated file by falling back, not by throwing', () => {
    writeRaw('{ "shell": "bash')
    expect(preferences.read()).toEqual(defaults())
    expect(preferences.write({ welcomeSeen: true }).welcomeSeen).toBe(true)
  })
})

describe('a stored voice this machine had of its own', () => {
  // Jarvis reads with the voices it carries and nothing else since 8 September
  // 2026. A name left over from the switch that used to offer Windows' voices
  // is kept rather than erased: speech.js reads with one of ours instead, and
  // deleting somebody's saved answer is not this file's call to make.
  it('is kept exactly as it was written', () => {
    writeRaw(JSON.stringify({ voices: { 'pt-BR': 'Microsoft Maria Desktop' } }))
    expect(preferences.read().voices['pt-BR']).toBe('Microsoft Maria Desktop')
  })

  it('carries no switch any more, whatever the file says', () => {
    writeRaw(JSON.stringify({ systemVoices: true, voices: { 'pt-BR': 'jarvis:pt_BR-faber-medium' } }))
    expect(preferences.read()).not.toHaveProperty('systemVoices')
  })
})

// The preferences file travels inside the folder — portable by copy — so a
// machine opens one holding the other machine's answers. Two of the fields name
// a place, and a place from the other platform is not somewhere this one can go.
describe('a file written on the other platform', () => {
  const WINDOWS = { platform: 'win32', env: {} }
  const MAC = { platform: 'darwin', env: { SHELL: '/bin/zsh' } }

  it("drops the Mac's shell when read on Windows", () => {
    const clean = sanitize({ shell: '/bin/zsh' }, WINDOWS)
    expect(clean.shell).toBe('powershell.exe')
  })

  it("drops Windows' shell when read on a Mac", () => {
    const clean = sanitize({ shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }, MAC)
    expect(clean.shell).toBe('/bin/zsh')
  })

  // The pair that shipped broken. What Windows stores is not a path at all —
  // defaultShell there answers with the bare name — and a bare name used to
  // belong to whoever was asking, so the Mac kept it and opened a Session on a
  // program it does not have. Silently, too: the exec fails inside node-pty's
  // forked child, so nothing throws and nothing is written anywhere.
  it('drops the shell Windows stores, which is a bare name', () => {
    expect(sanitize({ shell: 'powershell.exe' }, MAC).shell).toBe('/bin/zsh')
    expect(sanitize({ shell: 'pwsh.exe' }, MAC).shell).toBe('/bin/zsh')
  })

  it('keeps a bare name the platform reading it could own', () => {
    expect(sanitize({ shell: 'powershell.exe' }, WINDOWS).shell).toBe('powershell.exe')
    expect(sanitize({ shell: 'zsh' }, MAC).shell).toBe('zsh')
  })

  it("drops the Mac's last project when read on Windows", () => {
    const clean = sanitize({ projectPath: '/Users/someone/Code/Curate Project' }, WINDOWS)
    expect(clean.projectPath).toBeNull()
  })

  it("drops Windows' last project when read on a Mac", () => {
    const clean = sanitize({ projectPath: 'C:\\Projects\\CPD Audit' }, MAC)
    expect(clean.projectPath).toBeNull()
  })

  it('takes the session identifiers with the project they belong to', () => {
    // Left behind, they point at a shell and a conversation inside a folder
    // this machine has no project for.
    const clean = sanitize(
      {
        projectPath: '/Users/someone/Code/Curate Project',
        terminalSession: '1788740874102',
        claudeSession: 'ade7dcf6-97ba-45e2-84ca-86ce48d155f3',
      },
      WINDOWS,
    )

    expect(clean.terminalSession).toBeNull()
    expect(clean.claudeSession).toBeNull()
  })

  it('keeps everything that names no place', () => {
    // The point of one travelling file: the voice, the theme and the buttons
    // are the same wherever it is opened, and only the paths are local.
    const clean = sanitize(
      { shell: '/bin/zsh', theme: 'iron', model: 'medium', language: ENGLISH },
      WINDOWS,
    )

    expect(clean.theme).toBe('iron')
    expect(clean.model).toBe('medium')
    expect(clean.language).toBe(ENGLISH)
  })

  it("keeps this platform's own answers", () => {
    const clean = sanitize(
      { shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', projectPath: 'C:\\Projects\\CPD Audit' },
      WINDOWS,
    )

    expect(clean.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(clean.projectPath).toBe('C:\\Projects\\CPD Audit')
  })

  it('keeps a bare shell name, which belongs to whoever is asking', () => {
    expect(sanitize({ shell: 'cmd.exe' }, WINDOWS).shell).toBe('cmd.exe')
    expect(sanitize({ shell: 'bash' }, MAC).shell).toBe('bash')
  })
})

describe('where the panel sits', () => {
  it('opens down the right, at the width the footer was measured for', () => {
    const clean = defaults()
    expect(clean.panelPosition).toBe('right')
    expect(clean.panelCollapsed).toBe(false)
    expect(clean.railWidth).toBe(316)
    expect(clean.bandHeight).toBe(148)
  })

  it('keeps any of the four sides', () => {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      expect(sanitize({ panelPosition: side }).panelPosition).toBe(side)
    }
  })

  it('refuses a side that is not one, and leaves the rest standing', () => {
    const clean = sanitize({ panelPosition: 'sideways', railWidth: 420 })
    expect(clean.panelPosition).toBe('right')
    expect(clean.railWidth).toBe(420)
  })

  it('refuses a rail width outside 316 and 520, rather than clamping it', () => {
    expect(sanitize({ railWidth: 420 }).railWidth).toBe(420)
    expect(sanitize({ railWidth: 100 }).railWidth).toBe(316)
    expect(sanitize({ railWidth: 900 }).railWidth).toBe(316)
  })

  it('refuses a band height outside 148 and 300, rather than clamping it', () => {
    expect(sanitize({ bandHeight: 220 }).bandHeight).toBe(220)
    expect(sanitize({ bandHeight: 40 }).bandHeight).toBe(148)
    expect(sanitize({ bandHeight: 900 }).bandHeight).toBe(148)
  })

  it('remembers being retracted', () => {
    expect(sanitize({ panelCollapsed: true }).panelCollapsed).toBe(true)
    expect(sanitize({ panelCollapsed: 'yes' }).panelCollapsed).toBe(false)
  })

  it('travels: where the panel sits names no place on the disk', () => {
    const clean = sanitize({ panelPosition: 'top', bandHeight: 200 }, {
      platform: 'win32',
      env: {},
    })
    expect(clean.panelPosition).toBe('top')
    expect(clean.bandHeight).toBe(200)
  })
})
