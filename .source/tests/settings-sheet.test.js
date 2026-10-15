import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { electronBinary } from './helpers/electron-path.js'
import { describe, expect, it } from 'vitest'

// The second test in the suite that starts a real process, and like the first it
// earns its keep by catching something no unit test can see.
//
// A preload runs sandboxed: `require` there reaches Electron's own modules and
// nothing else. A relative import — the core, say — throws, and everything
// after it is skipped, so the bridge the page talks to is never built. Nothing
// errors where a test was looking. What the user gets is a Settings sheet in the
// wrong theme, with no voices, no shell, and no button that does anything.
//
// So this opens the real sheet in a real window and asks it what it looks like.

const harness = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'sheet-harness.js',
)

/** The sheet, opened for real, reporting on itself. */
const sheet = JSON.parse(
  execFileSync(electronBinary(), [harness], { encoding: 'utf8', timeout: 180_000 })
    .trim()
    .split('\n')
    .pop(),
)

describe('the Settings sheet, opened for real', () => {
  it('builds the bridge its preload is there to build', () => {
    expect(sheet.problems).toEqual([])
    expect(sheet.bridge).toBe('object')
  })

  it('comes up in the theme that was stored, not the one it falls back to', () => {
    // 'dark' is the fallback. Seeing it here means the sheet never read the
    // preferences at all — which is what a dead bridge looks like from outside.
    expect(sheet.theme).toBe('iron')
  })

  it('fills itself in from the stored settings', () => {
    expect(sheet.shell).toBe('pwsh.exe')
    expect(sheet.voiceOptions).toBeGreaterThan(0)
    expect(sheet.modelOptions).toBeGreaterThan(0)
  })

  it('says a model that is already here is here, not a download', () => {
    // The accurate model travels in Resources now. Describing it as "940 MB to
    // download" is how a user comes to press the microphone and watch a
    // gigabyte arrive that was on the disk the whole time.
    expect(sheet.modelNote).toContain('already here')
    expect(sheet.modelNote).not.toContain('to download')
  })

  it('shows every section at once in four columns at 1366 by 768, with nothing to scroll', () => {
    const { view } = sheet
    expect(view).toMatchObject({ width: 1366, height: 768, spill: { x: 0, y: 0 } })
    expect(view.columns.map((column) => column.sections)).toEqual([
      ['Appearance', 'Text sizes', 'Panel side'],
      ['Spine buttons', 'Claude Code'],
      ['Command buttons'],
      ['Skills', 'Reading aloud', 'Shell and dictation'],
    ])
    for (const column of view.columns) {
      expect(column.tall).toBeLessThanOrEqual(column.high)
      expect(column.wide).toBeLessThanOrEqual(column.room)
    }
    expect(view.cutOff).toEqual([])
  })

  it('offers the five text sizes as number boxes, each with its own range', () => {
    // The Deck's apart from the terminal's, as before; the Spine's and the
    // two kinds of button new with the Spine. The terminal's takes half-points.
    expect(sheet.sizes).toEqual({
      'terminal-font': { type: 'number', value: '13.5', min: '9', max: '24', step: '0.5', label: 'Terminal' },
      'spine-font': { type: 'number', value: '9', min: '8', max: '14', step: '1', label: 'Spine' },
      'deck-font': { type: 'number', value: '12', min: '9', max: '14', step: '1', label: 'Deck' },
      'command-font': { type: 'number', value: '12', min: '10', max: '16', step: '1', label: 'Command buttons' },
      'skill-font': { type: 'number', value: '12', min: '10', max: '16', step: '1', label: 'Skill buttons' },
    })
  })

  it('applies a size once the typing pauses, and brings one out of range back on leaving the box', () => {
    expect(sheet.typed).toEqual({ deckLive: '13', commandHigh: '16', terminalOff: '15.5', spineWord: '9' })
    // Nothing is written key by key: 9 then 13 is one write, of 13.
    expect(sheet.writtenWhileTyping).toBe(0)
    // Each written alone; a word is put back to what was stored and writes nothing.
    expect(sheet.sizeWrites).toEqual([{ deckFontSize: 13 }, { commandFontSize: 16 }, { terminalFontSize: 15.5 }])
  })

  it('keeps a size or a cell half typed when Escape closes the sheet', () => {
    expect(sheet.escapedSize).toEqual({ writes: [{ skillFontSize: 14 }], closes: 1 })
    expect(sheet.escapedCell).toEqual({ stored: ['tdd-loop', 'review'], closes: 2 })
  })

  it('sets the theme, the language and the side through the Panel’s own actions', () => {
    expect(sheet).toMatchObject({ themeOn: 'iron', languageOn: 'pt-BR', sideOn: 'right' })
    expect(sheet.sides).toEqual(['left', 'top', 'right', 'bottom'])
    // Choosing the language already on does nothing; the other flips it once.
    expect(sheet.acted).toEqual([
      ['setTheme', 'light'],
      ['toggleLanguage', null],
      ['placePanel', 'left'],
    ])
    expect(sheet.afterClicks).toEqual({ themeOn: 'light', languageOn: 'en-US', sideOn: 'left', commandColumnsOn: '2' })
  })

  it('stores the columns of each list from its own row of five', () => {
    expect(sheet).toMatchObject({ commandColumnsOn: '3', skillColumnsOn: '3' })
    expect(sheet.clickedWrites).toEqual([{ commandColumns: 2 }, { skillColumns: 5 }])
  })

  it('lists the Spine’s buttons in its order, with a tick for each one shown', () => {
    expect(sheet.spineList.map((row) => row.part)).toEqual([
      'plan', 'gauge', 'commands', 'skills', 'events', 'agents', 'loops', 'readings', 'session',
    ])
    expect(sheet.spineList.filter((row) => !row.shown).map((row) => row.part)).toEqual(['loops'])
  })

  it('hides a button and turns its Part off on an untick; shows it again, still off, on a tick', () => {
    expect(sheet.tickWrites).toEqual([
      { spineHidden: ['loops', 'plan'], deckPlan: false },
      { spineHidden: ['plan'] },
    ])
  })

  it('hides a button on top of what another window hid since the sheet opened', () => {
    expect(sheet.staleTick).toEqual([{ spineHidden: ['plan', 'events', 'agents'], deckAgents: false }])
  })

  it('edits the Command rows in place, each dragged only by its handle', () => {
    expect(sheet.commandRows).toHaveLength(7)
    expect(sheet.commandRows[0]).toEqual({
      id: '1', name: 'Claude', command: 'claude', glyph: 'terminal-window', handle: true, rowDraggable: false,
    })
    expect(sheet.skillRows).toEqual(['s1', 's2', 's3', 's4'])
    // The rename is stored at once, through the existing write.
    expect(sheet.lists.shortcuts[0][1]).toMatchObject({ id: '2', label: 'Carry on', command: 'claude -c' })
  })

  it('keeps a row being added out of storage until it has a command, and on screen', () => {
    expect(sheet.added).toEqual({ rows: 8, focused: true, rowsAfter: 8 })
    for (const list of sheet.lists.shortcuts) {
      expect(list.map((each) => each.label)).not.toContain('Half typed')
    }
  })

  it('picks an icon from the set, or none, and stores it on the row', async () => {
    const { GLYPHS } = await import('../src/core/button-look.js')
    expect(sheet.picker).toMatchObject({ open: true, inside: true, closedAfter: true, shown: 'rocket' })
    expect(sheet.picker.choices).toEqual(['', ...GLYPHS])
    expect(sheet.lists.shortcuts.at(-2)[0]).toMatchObject({ id: '1', glyph: 'rocket' })
    expect(sheet.lists.skills.at(-1)[0]).toMatchObject({ id: 's1', glyph: null })
  })

  it('reorders the Commands by a row dragged by its handle, a line marking where it lands', () => {
    expect(sheet.rowDrag).toMatchObject({ accepted: true, mark: 'drop-before', left: 0 })
    expect(sheet.rowDrag.order.slice(0, 2)).toEqual(['7', '1'])
    expect(sheet.lists.shortcuts.at(-1).map((each) => each.id)).toEqual(['7', '1', '2', '3', '4', '5', '6'])
  })

  it('edits, renames and removes the row the hand is on, whatever is half done above it', () => {
    // s2's command cleared: it stays on screen, where it was, out of storage.
    expect(sheet.inPlace.rows).toEqual([['s1', 'tdd'], ['s2', 'grill-me'], ['s3', 'review']])
    expect(sheet.inPlace.stored).toEqual([['s1', 'tdd'], ['s3', 'review']])
  })

  it('closes the icon picker when a column scrolls or the window is resized', () => {
    expect(sheet.pickerScrolled).toEqual({ opened: true, closed: true })
    expect(sheet.pickerResized).toEqual({ opened: true, closed: true })
  })

  it('stands in two columns in a smaller window and one in a narrow one, cutting no table', () => {
    expect(sheet.at1366).toMatchObject({ across: 4, cut: [], spillX: 0, pageScrolls: false })
    expect(sheet.at1024).toMatchObject({ across: 2, cut: [], spillX: 0 })
    expect(sheet.at480).toMatchObject({ across: 1, cut: [], spillX: 0, pageScrolls: true })
  })

  it('opens at a row when the Panel asks, its name box focused', () => {
    expect(sheet.editing).toEqual({ focused: true, marked: true })
  })

  it('says hooks of an older Jarvis are out of date, and offers Connect to bring them up', () => {
    expect(sheet.connection.stale.text).toMatch(/^Out of date/)
    expect(sheet.connection.stale.connect).toBe('Connect')
    expect(sheet.connection.stale).toMatchObject({ connectEnabled: true, disconnectEnabled: true })
  })

  it('says whose hooks they are when another Jarvis folder connected Claude Code', () => {
    // A checkout run beside the Jarvis the user keeps: its hooks are current,
    // and they are that Jarvis's. Not "out of date", and not taken over unasked.
    const { elsewhere } = sheet.connection
    expect(elsewhere.text).toContain('Connected to the Jarvis in C:\\Other\\Jarvis')
    expect(elsewhere.text).not.toMatch(/out of date/i)
    expect(elsewhere.connect).toBe('Connect this one')
    expect(elsewhere.connectEnabled).toBe(true)
  })

  it('calls the button Connect again once nothing else is connected', () => {
    expect(sheet.connection.none).toMatchObject({ text: expect.stringMatching(/^Not connected/), connect: 'Connect' })
    expect(sheet.connection.connected).toMatchObject({ connectEnabled: false, connect: 'Connect' })
  })

  it('names the place this machine actually keeps its settings', () => {
    expect(sheet.micLink).toContain('Windows settings')
  })

  it('says the voices need no setting up, and offers no switch for others', () => {
    // Jarvis reads with the voices it carries and nothing else. There is no
    // second set to choose between, so there is no control for one, and nothing
    // sends the user off to install a voice the app would not use.
    expect(sheet.voiceNote).toContain('need no setting up')
    expect(sheet.voiceNote).not.toMatch(/Windows/)
  })
})
