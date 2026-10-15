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
 * A project path Windows could have written.
 *
 * What is stored is checked for shape rather than existence — isNativePath, in
 * the core's platform file — so a POSIX path is thrown away before it can be
 * read back, and the test would be measuring the guard instead of the memory it
 * is named for.
 */
function project(name) {
  return `C:\\p\\${name}`
}

/** A shell name Windows could have stored, other than the default. */
const A_SHELL = 'bash.exe'

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

// The preferences file is plain JSON, and can be edited by hand or carried in
// from somewhere else. Two of the fields name a place, and a POSIX path is not
// somewhere Windows can go.
describe('a file holding paths Windows cannot use', () => {
  const WINDOWS = { platform: 'win32', env: {} }

  it('drops a POSIX shell', () => {
    const clean = sanitize({ shell: '/bin/zsh' }, WINDOWS)
    expect(clean.shell).toBe('powershell.exe')
  })

  it('drops a POSIX last project', () => {
    const clean = sanitize({ projectPath: '/Users/someone/Code/Curate Project' }, WINDOWS)
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
    // Only the paths are checked: the voice, the theme and the buttons stand
    // whatever else in the file was refused.
    const clean = sanitize(
      { shell: '/bin/zsh', theme: 'iron', model: 'medium', language: ENGLISH },
      WINDOWS,
    )

    expect(clean.theme).toBe('iron')
    expect(clean.model).toBe('medium')
    expect(clean.language).toBe(ENGLISH)
  })

  it('keeps Windows paths', () => {
    const clean = sanitize(
      { shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', projectPath: 'C:\\Projects\\CPD Audit' },
      WINDOWS,
    )

    expect(clean.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(clean.projectPath).toBe('C:\\Projects\\CPD Audit')
  })

  it('keeps a bare shell name, which names no place', () => {
    expect(sanitize({ shell: 'powershell.exe' }, WINDOWS).shell).toBe('powershell.exe')
    expect(sanitize({ shell: 'cmd.exe' }, WINDOWS).shell).toBe('cmd.exe')
    expect(sanitize({ shell: 'bash' }, WINDOWS).shell).toBe('bash')
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

  it('is kept whatever the machine: where the panel sits names no place on the disk', () => {
    const clean = sanitize({ panelPosition: 'top', bandHeight: 200 }, {
      platform: 'win32',
      env: {},
    })
    expect(clean.panelPosition).toBe('top')
    expect(clean.bandHeight).toBe(200)
  })
})

// The Deck's five switches. Every block but the Gauge starts off; the Gauge
// starts on, for it shows what the status line under the terminal used to.
// Each switch stands on its own: one bad hand-edit turns off its own block
// and no other.
describe('the Deck switches', () => {
  const SWITCHES = ['deckPlan', 'deckAgents', 'deckLoops', 'deckEvents']

  it('are all off to start, but the Gauge', () => {
    for (const name of SWITCHES) expect(preferences.read()[name]).toBe(false)
    expect(preferences.read().deckGauge).toBe(true)
  })

  it('remember the Gauge switched off', () => {
    preferences.write({ deckGauge: false })
    expect(preferences.read().deckGauge).toBe(false)
  })

  it('take a Gauge switch that is not a yes or a no as on, its own default', () => {
    writeRaw(JSON.stringify({ deckGauge: 'off' }))
    expect(preferences.read().deckGauge).toBe(true)
  })

  it('are remembered', () => {
    preferences.write({ deckEvents: true, deckPlan: true })
    expect(preferences.read().deckEvents).toBe(true)
    expect(preferences.read().deckPlan).toBe(true)
    expect(preferences.read().deckAgents).toBe(false)
  })

  it('refuse a value that is not a yes or a no, each on its own', () => {
    const stored = Object.fromEntries(SWITCHES.map((name) => [name, true]))
    stored.deckLoops = 'yes'
    writeRaw(JSON.stringify(stored))

    const read = preferences.read()
    expect(read.deckLoops).toBe(false)
    for (const name of SWITCHES.filter((each) => each !== 'deckLoops')) {
      expect(read[name]).toBe(true)
    }
  })

  it('forget the two blocks that are gone', () => {
    writeRaw(JSON.stringify({ deckPermissions: true, deckReceipt: true }))
    expect('deckPermissions' in preferences.read()).toBe(false)
    expect('deckReceipt' in preferences.read()).toBe(false)
  })
})

// The Plan block's mute: off to start, so the sounds play; one for every
// window; refused on its own when it is not a yes or a no.
describe('the plan sounds’ mute', () => {
  it('is off to start', () => {
    expect(preferences.read().deckPlanMuted).toBe(false)
  })

  it('is remembered', () => {
    preferences.write({ deckPlanMuted: true })
    expect(preferences.read().deckPlanMuted).toBe(true)
  })

  it('refuses a value that is not a yes or a no, and nothing else with it', () => {
    writeRaw(JSON.stringify({ deckPlanMuted: 'yes', deckEvents: true }))
    const read = preferences.read()
    expect(read.deckPlanMuted).toBe(false)
    expect(read.deckEvents).toBe(true)
  })
})

// The Deck's type size, its own and not the terminal's: a whole number of
// pixels from 9 to 14, starting at 10 — a pixel under the 11 the Deck was drawn
// at before it was a setting.
describe('the Deck’s type size', () => {
  it('starts at 10', () => {
    expect(preferences.read().deckFontSize).toBe(10)
  })

  it('has one default and one range, the ones the Panel and the Settings sheet read', async () => {
    const { DECK_FONT } = await import('../src/core/deck-chips.js')
    expect(DECK_FONT).toEqual({ size: 10, min: 9, max: 14 })
    expect(preferences.read().deckFontSize).toBe(DECK_FONT.size)
    for (const file of ['../src/main/app-model.js', '../src/renderer/panel.js', '../src/renderer/settings.js']) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, `${file} has its own default`).not.toMatch(/deckFontSize[^\n]*\b10\b/)
    }
  })

  it('is remembered, apart from the terminal’s', () => {
    preferences.write({ deckFontSize: 13 })
    expect(preferences.read().deckFontSize).toBe(13)
    expect(preferences.read().terminalFontSize).toBe(13.5)
  })

  it('takes both ends of its range', () => {
    expect(sanitize({ deckFontSize: 9 }).deckFontSize).toBe(9)
    expect(sanitize({ deckFontSize: 14 }).deckFontSize).toBe(14)
  })

  it('refuses a size outside the range, a fraction or a word, on its own', () => {
    for (const bad of [8, 15, 10.5, '12', null]) {
      const clean = sanitize({ deckFontSize: bad, terminalFontSize: 16 })
      expect(clean.deckFontSize).toBe(10)
      expect(clean.terminalFontSize).toBe(16)
    }
  })
})

// The Spine: which Parts are on, in what order, and which buttons are hidden.
// One set for every window, like the Deck switches it carries on from.
describe('the Spine', () => {
  it('starts with Commands, Skills, Recent readings and Session on, so the Panel opens as it did', () => {
    const read = preferences.read()
    for (const name of ['partCommands', 'partSkills', 'partReadings', 'partSession']) {
      expect(read[name]).toBe(true)
    }
  })

  it('remembers a section taken away, and refuses a switch that is not a yes or a no on its own', () => {
    preferences.write({ partSkills: false })
    expect(preferences.read().partSkills).toBe(false)
    writeRaw(JSON.stringify({ partReadings: 'no', partSession: false }))
    expect(preferences.read().partReadings).toBe(true)
    expect(preferences.read().partSession).toBe(false)
  })

  it('starts in the default order, with nothing hidden', () => {
    expect(preferences.read().spineOrder).toEqual([
      'gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session',
    ])
    expect(preferences.read().spineHidden).toEqual([])
  })

  it('keeps a stored order, dropping what it does not know and appending what is missing', () => {
    writeRaw(JSON.stringify({ spineOrder: ['session', 'nonsense', 'plan'] }))
    expect(preferences.read().spineOrder).toEqual([
      'session', 'plan', 'gauge', 'events', 'agents', 'loops', 'commands', 'skills', 'readings',
    ])
  })

  it('falls back to the default order and to nothing hidden when either is not a list', () => {
    writeRaw(JSON.stringify({ spineOrder: 'plan', spineHidden: { plan: true }, deckPlan: true }))
    const read = preferences.read()
    expect(read.spineOrder[0]).toBe('gauge')
    expect(read.spineHidden).toEqual([])
    expect(read.deckPlan).toBe(true)
  })

  it('keeps the hidden buttons it knows', () => {
    preferences.write({ spineHidden: ['loops', 'loops', 'nonsense'] })
    expect(preferences.read().spineHidden).toEqual(['loops'])
  })

  it('keeps the Deck switches under the keys they always had, so an upgrade keeps them', () => {
    writeRaw(JSON.stringify({ deckPlan: true, deckEvents: true }))
    const read = preferences.read()
    expect(read.deckPlan).toBe(true)
    expect(read.deckEvents).toBe(true)
    expect(read.partCommands).toBe(true)
  })
})

// How the Commands and the Skills look, and the Spine's text: one set for every
// window, each value refused on its own.
describe('the buttons columns and the text sizes', () => {
  it('start at three columns each, the Spine at 9 and the buttons at 12', () => {
    expect(preferences.read()).toMatchObject({
      commandColumns: 3,
      skillColumns: 3,
      spineFontSize: 9,
      commandFontSize: 12,
      skillFontSize: 12,
    })
  })

  it('take both ends of each range', () => {
    const low = { commandColumns: 1, skillColumns: 1, spineFontSize: 8, commandFontSize: 10, skillFontSize: 10 }
    const high = { commandColumns: 5, skillColumns: 5, spineFontSize: 14, commandFontSize: 16, skillFontSize: 16 }
    expect(sanitize(low)).toMatchObject(low)
    expect(sanitize(high)).toMatchObject(high)
  })

  it('refuse a value outside its range, a fraction or a word, on its own', () => {
    const clean = sanitize({ commandColumns: 6, skillColumns: 2, spineFontSize: 15, commandFontSize: 12.5, skillFontSize: '14' })
    expect(clean).toMatchObject({ commandColumns: 3, skillColumns: 2, spineFontSize: 9, commandFontSize: 12, skillFontSize: 12 })
  })
})

describe('reordering the Commands and the Skills', () => {
  it('stores the built-ins in the new order, since an empty list means the built-ins', () => {
    const ids = preferences.shortcuts().map((each) => each.id)
    preferences.setShortcutOrder([ids[6], ...ids.slice(0, 6)])
    expect(preferences.read().shortcuts.map((each) => each.id)).toEqual([ids[6], ...ids.slice(0, 6)])
    expect(preferences.shortcuts()[0]).toMatchObject({ label: 'Exit', glyph: 'sign-out' })
  })

  it('keeps a button the order does not name, and drops an id it does not know', () => {
    preferences.setSkills([
      { id: 'a', label: 'tdd', command: '/tdd', submits: false, glyph: 'test-tube' },
      { id: 'b', label: 'grill', command: '/grill', submits: false, glyph: null },
      { id: 'c', label: 'review', command: '/review', submits: false, glyph: 'eye' },
    ])
    preferences.setSkillOrder(['c', 'nonsense', 'a'])
    expect(preferences.skills().map((each) => [each.id, each.glyph])).toEqual([
      ['c', 'eye'],
      ['a', 'test-tube'],
      ['b', null],
    ])
  })

  it('gives an old stored Skill without an icon the Skill its own', () => {
    writeRaw(JSON.stringify({ skills: [{ id: 'a', label: 'tdd', command: '/tdd', submits: false }] }))
    expect(preferences.skills()[0].glyph).toBe('lightning')
  })
})
