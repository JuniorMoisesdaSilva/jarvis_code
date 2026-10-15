import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { electronBinary } from './helpers/electron-path.js'
import { describe, expect, it } from 'vitest'

// The third test in the suite that starts a real process, and like the other two
// it earns its keep by catching something no unit test can see.
//
// Two questions here cannot be answered by reading the stylesheet. Whether the
// shell is told about rows the pane can actually show depends on a font loaded
// at runtime, and whether the Spine and three columns of Commands fit a
// 316-point Rail depends on the type's own metrics. `Docs/history/the-cut-off-terminal` was closed by
// measuring the real page rather than reasoning about it, and this keeps that
// method: everything below is a relation between two numbers the page reported
// about itself.

const harness = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'panes-harness.js',
)

const seen = JSON.parse(
  execFileSync(electronBinary(), [harness], { encoding: 'utf8', timeout: 180_000 })
    .trim()
    .split('\n')
    .pop(),
)

/**
 * What a flex row overruns by once it has been shrunk proportionally.
 *
 * Flex divides a shortfall in proportion to what each item asked for, and the
 * last fraction of a point has to land somewhere; `scrollWidth` then rounds it
 * up. Swept across every band width from 900 to 1400, that residue is between
 * 0 and 5 points and never grows with the window — where a band is genuinely
 * too narrow the figure climbs into the tens instead. Eight points is above the
 * residue and well under the 28-point buttons, which makes it the line between
 * "the row is whole" and "a control is cut".
 */
const ROUNDING = 8

describe('both panes, opened for real', () => {
  it('builds every page without an error in it', () => {
    expect(seen.problems).toEqual([])
  })
})

describe('the terminal pane', () => {
  it('takes every paste ahead of xterm and says whether it may keep its lines', () => {
    // xterm's own paste would type a line break as Enter at a plain prompt.
    // The pane's handler sends the text on instead, and nothing is typed.
    const { prevented, pastes, typing } = seen.terminalPaste
    expect(prevented).toEqual([true, true, true])
    expect(pastes).toEqual([
      { text: 'a\nb', bracketed: false },
      { text: 'c\td', bracketed: true },
      // Empty, but asked for: Claude Code's cue to take an image.
      { text: '', bracketed: true },
      // The panel's button, by the same handler and the same rule.
      { text: 'e\nf', bracketed: true },
    ])
    expect(typing).toEqual([])
  })

  it('has no header of its own any more', () => {
    expect(seen.terminalTall.header).toBe(false)
    expect(seen.terminalBand.header).toBe(false)
  })

  it('has the same margin on all four sides', () => {
    const { pad } = seen.terminalTall
    expect(pad.top).toBe(pad.bottom)
    expect(pad.left).toBe(pad.right)
    expect(pad.top).toBe(pad.left)
  })

  const shapes = {
    'beside a panel down a side': 'terminalTall',
    'under a band along an edge': 'terminalBand',
    'at the smallest text size': 'terminalSmall',
    'at the largest text size': 'terminalLarge',
  }
  for (const [where, shape] of Object.entries(shapes)) {
    describe(where, () => {
      const pane = seen[shape]

      it('tells the shell a number of rows, and draws exactly that many', () => {
        expect(pane.told).not.toBeNull()
        expect(pane.told.rows).toBeGreaterThan(0)
        expect(pane.told.cols).toBeGreaterThan(0)
      })

      it('draws them inside the box, not past its bottom edge', () => {
        // The whole of `the-cut-off-terminal` in one line.
        expect(pane.drawn.height).toBeLessThanOrEqual(pane.inner.height)
        expect(pane.drawn.width).toBeLessThanOrEqual(pane.inner.width)
      })

      it('keeps two rows clear at the foot for the status line', () => {
        const cell = pane.drawn.height / pane.told.rows
        const spare = pane.inner.height - pane.drawn.height
        expect(spare).toBeGreaterThanOrEqual(cell * 2)
      })
    })
  }
})

describe('the panel down a side', () => {
  for (const side of ['right', 'left']) {
    it(`draws nothing past its own edge on the ${side}`, () => {
      expect(seen[side].axis).toBe('side')
      expect(seen[side].spill).toEqual({ x: 0, y: 0 })
    })
  }

  it('has no footer: its work is done at the Spine’s foot', () => {
    // The footer measured to the pixel in 0018 is gone (0035): the theme, the
    // language, Settings and the mover moved to the foot of the Spine.
    expect(seen.right.footer).toBe(false)
    expect(seen.left.footer).toBe(false)
  })

  it('carries the edit labels, none cut, which 316 points guarantees by construction', () => {
    expect(seen.right.edit).toBe('wide')
    expect(seen.right.editWords).toBe(3)
    expect(seen.right.editCut).toEqual([])
    // The three words need 187 or so; the Spine leaves the row 214.
    expect(seen.right.editNeed).toBeLessThanOrEqual(seen.right.editBox.w)
  })

  it('keeps the commands to three columns when it is dragged wider', () => {
    // Seven commands in three columns are three rows at any width: the grid widens
    // its buttons rather than gaining a column.
    expect(seen.wide.commandsBox.w).toBeGreaterThan(seen.right.commandsBox.w)
    expect(seen.wide.commandsBox.h).toBe(seen.right.commandsBox.h)
  })
})

describe('the Spine down a side', () => {
  for (const side of ['right', 'left']) {
    it(`is 52 points on the outer edge, the pane 264 beside it, inside the 316 Rail, on the ${side}`, () => {
      expect(seen[side].spineBox.w).toBe(52)
      expect(seen[side].paneBox.w).toBe(264)
      expect(seen[side].spineEdge).toBe(side)
      expect(seen[side].spineBox.w + seen[side].paneBox.w).toBe(316)
    })
  }

  it('holds all its buttons in the height a side gives it', () => {
    expect(seen.right.spineRoom.tall).toBeLessThanOrEqual(seen.right.spineRoom.high)
    expect(seen.right.spineRoom.need).toBeLessThanOrEqual(seen.right.spineRoom.room)
    for (const part of seen.right.spineParts) expect(part.w).toBe(44)
  })

  it('fits three columns of the built-in Commands in the pane, no label cut', () => {
    expect(seen.right.commandColumns).toBe(3)
    expect(seen.right.commandsCut).toEqual([])
  })

  it('carries one button per Part, the Deck blocks first and CTX at the head', () => {
    expect(seen.right.spineParts.map((part) => part.part)).toEqual([
      'gauge',
      'events',
      'plan',
      'agents',
      'loops',
      'commands',
      'skills',
      'readings',
      'session',
    ])
    expect(seen.right.spineParts.every((part) => part.shown)).toBe(true)
  })

  it('presses the buttons whose Part is on: to start, the four sections', () => {
    const pressed = Object.fromEntries(seen.right.spineParts.map((part) => [part.part, part.pressed]))
    expect(pressed).toEqual({
      gauge: 'false',
      events: 'false',
      plan: 'false',
      agents: 'false',
      loops: 'false',
      commands: 'true',
      skills: 'true',
      readings: 'true',
      session: 'true',
    })
  })

  it('shows a Deck block’s live figure on its button while it is on, its glyph while off', () => {
    expect(seen.allRail.spineParts.slice(0, 5).map((part) => part.face)).toEqual([
      'CTX 86%',
      'EVT 3',
      'PLN 3/8',
      'AGT 1▶',
      'LPS 2',
    ])
    expect(seen.right.spineParts.slice(0, 5).map((part) => part.face)).toEqual([
      'CTX glyph',
      'EVT glyph',
      'PLN glyph',
      'AGT glyph',
      'LPS glyph',
    ])
    // A section's button is its glyph over its abbreviation.
    expect(seen.right.spineParts.slice(5).map((part) => part.face)).toEqual([
      'glyph CMD',
      'glyph SKL',
      'glyph READ',
      'glyph SESS',
    ])
  })

  it('stacks the Parts that are on, in the Spine’s order', () => {
    // To start: Commands, Skills and the Session card; no reading yet, so the
    // Recent readings stay out of the page though their Part is on.
    expect(seen.right.stack).toEqual(['commands', 'skills', 'session'])
    // An order of the user's, Loops hidden from the Spine and so off.
    expect(seen.spineOrdered.stack).toEqual(['session', 'plan', 'commands', 'gauge', 'readings', 'skills', 'events', 'agents'])
    expect(seen.spineOrdered.spineParts.map((part) => [part.part, part.shown])).toEqual([
      ['session', true],
      ['plan', true],
      ['commands', true],
      ['gauge', true],
      ['readings', true],
      ['skills', true],
      ['events', true],
      ['agents', true],
      ['loops', false],
    ])
    expect(seen.spineOrdered.spill).toEqual({ x: 0, y: 0 })
  })

  it('adds each Part with a click on its button, and takes each away with another', () => {
    const every = ['commands', 'skills', 'readings', 'session', 'gauge', 'events', 'plan', 'agents', 'loops']
    expect(seen.spineOn.asked).toEqual(every.map((part) => ['setPart', { part, on: true }]))
    expect(seen.spineOn.stack).toEqual(['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session'])
    expect(seen.spineOn.spineParts.every((part) => part.pressed === 'true')).toBe(true)
    expect(seen.spineOff.asked).toEqual(every.map((part) => ['setPart', { part, on: false }]))
    expect(seen.spineOff.stack).toEqual([])
    expect(seen.spineOff.spineParts.every((part) => part.pressed === 'false')).toBe(true)
  })

  it('marks where a dragged button will land: above or below the one it is held over', () => {
    const [first, second] = seen.spineDragged.dropMarks
    // Held over Context's upper half, Context takes a line along its top; over
    // the Plan's lower half, along its foot. Both drops are taken.
    expect(first).toMatchObject({ over: 'gauge', accepted: true, mark: 'drop-before', lifted: true })
    expect(second).toMatchObject({ over: 'plan', accepted: true, mark: 'drop-after', lifted: true })
    for (const drop of [first, second]) {
      // A line across the button, not down it.
      expect(drop.line.h).toBe(2)
      expect(drop.line.w).toBeGreaterThan(30)
      // Nothing is left marked once the drop has landed.
      expect(drop.left).toBe(0)
    }
  })

  it('reorders the Spine and the page together on a drop, and clicks nothing', () => {
    const once = ['session', 'gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings']
    const twice = ['session', 'events', 'plan', 'gauge', 'agents', 'loops', 'commands', 'skills', 'readings']
    // Each drop is the whole new order, and a drag is never also a click.
    expect(seen.spineDragged.asked).toEqual([
      ['setSpineOrder', once],
      ['setSpineOrder', twice],
    ])
    expect(seen.spineDragged.spineParts.map((part) => part.part)).toEqual(twice)
    expect(seen.spineDragged.stack).toEqual(twice)
    expect(seen.spineDragged.spill).toEqual({ x: 0, y: 0 })
  })

  it('brings a Part just added into view', () => {
    // Session goes on last, at the foot of a page longer than the window: the
    // page scrolls to it rather than leaving it below the fold.
    const { scrolled, top, bottom } = seen.spineScrolled.sessionInView
    // Within a point: the scroll lands on whole pixels, the layout on fractions.
    expect(scrolled).toBeGreaterThan(0)
    expect(top).toBeGreaterThan(-1)
    expect(bottom).toBeGreaterThan(-1)
  })

  it('leaves the page empty and whole with every Part off', () => {
    expect(seen.spineEmpty.stack).toEqual([])
    expect(seen.spineEmpty.spill).toEqual({ x: 0, y: 0 })
  })

  it('heads each section with its name and a cross that takes it off', () => {
    expect(seen.right.heads).toEqual([
      { name: 'Commands', remove: true },
      { name: 'Skills', remove: true },
      { name: 'Session', remove: true },
    ])
  })

  it('carries the theme, the language, Settings, the mover and Shut at its foot', () => {
    expect(seen.right.spineFoot).toEqual(['theme', 'language', 'settings', 'move-panel', 'collapse'])
    expect(seen.right.spineFootShown).toBe(true)
  })

  it('shows the theme it is in and names the one a click goes to', () => {
    expect(seen.right.theme).toEqual({ glyph: 'ph ph-moon', title: 'Theme: Dark. Click for Light' })
    expect(seen.spineIron.theme).toEqual({ glyph: 'ph ph-shield-star', title: 'Theme: Iron Man. Click for Dark' })
  })

  it('shows the language answers come in', () => {
    expect(seen.right.language).toBe('PT')
    expect(seen.spineIron.language).toBe('EN')
  })
})

describe('the panel along an edge', () => {
  it('lays itself out as a band, not as a rail on its side', () => {
    expect(seen.bottom.axis).toBe('band')
    expect(seen.top.axis).toBe('band')
  })

  it('draws nothing past its own edge, at either edge', () => {
    expect(seen.bottom.spill).toEqual({ x: 0, y: 0 })
    expect(seen.top.spill).toEqual({ x: 0, y: 0 })
  })

  it('keeps the commands to three rows inside the 148 it has', () => {
    expect(seen.bottom.commandsBox.h).toBeLessThanOrEqual(seen.bottom.panelBox.h)
    expect(seen.bottom.bodyBox.h).toBeLessThanOrEqual(seen.bottom.panelBox.h)
  })

  it('drops the edit labels, the row being far too short for three of them', () => {
    expect(seen.bottom.edit).toBe('tight')
    expect(seen.bottom.editWords).toBe(0)
  })

  it('keeps PT and EN, the mover and Shut at the Spine’s foot', () => {
    expect(seen.bottom.spineFoot).toEqual(['theme', 'language', 'settings', 'move-panel', 'collapse'])
    expect(seen.bottom.spineFootShown).toBe(true)
  })

  it('shows everything it has in a window that can afford it', () => {
    expect(seen.bottom.sessionShown).toBe(true)
    expect(seen.bottom.bodyRoom.need).toBeLessThanOrEqual(seen.bottom.bodyRoom.room)
  })

  it('lets the dock give way before a button does', () => {
    // 420 is what the dock asks for and 400 is what it comes down to. A band
    // that has to take room from something takes it from here first. The floor
    // was 296 until the reading controls and the notices moved into the strip:
    // it carries more now, so it has less to give, and a band that cannot pay
    // the 400 takes the rest from the middle rather than from a button.
    expect(seen.bottom.dockBox.w).toBe(420)
    expect(seen.bandTight.dockBox.w).toBe(400)
  })

  it('puts the Session pair in the page on either axis, a Part like any other', () => {
    // Until the Band had a Spine of its own it stood under the strip, in the
    // head; now it is a column of the page, where the Spine's order puts it.
    expect(seen.bottom.sessionIn).toBe('body')
    expect(seen.top.sessionIn).toBe('body')
    expect(seen.right.sessionIn).toBe('body')
    expect(seen.bottom.sessionShown).toBe(true)
  })

  it('keeps the Session pair at every width, since it costs the row nothing', () => {
    // It used to be hidden under a measured width, back when it stood between
    // Skills and the dock and was the reason the row ran out of room. From the
    // first column it takes nothing the buttons wanted.
    expect(seen.bandFloor.sessionShown).toBe(true)
    expect(seen.bandTight.sessionShown).toBe(true)
  })

  it('scrolls rather than clipping once even that is not enough', () => {
    // At 924 the dock has been at its floor for fifty points and the row is 59
    // short — not a residue but a real overrun. It scrolls: a button you can
    // reach by scrolling is a button, one drawn past the edge is not, and
    // nothing here is drawn past the edge.
    const at = seen.bandTight.bodyRoom
    expect(at.need - at.room).toBeGreaterThan(ROUNDING * 4)
    expect(seen.bandTight.spill).toEqual({ x: 0, y: 0 })
  })
})

describe('the Spine in a Band', () => {
  const ORDER = ['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session']

  it('is a row 36 deep on the Band’s outer edge, the Band still 148', () => {
    expect(seen.bottom.panelBox.h + 5).toBe(148)
    for (const [shown, edge] of [[seen.bottom, 'below'], [seen.top, 'above']]) {
      expect(shown.spineBox).toEqual({ w: 1240, h: 36 })
      expect(shown.spineRow).toBe(edge)
      expect(shown.paneBox.h + shown.spineBox.h).toBe(shown.panelBox.h)
    }
  })

  it('carries a button per Part in the Spine’s order, then its foot, nothing spilling', () => {
    for (const shown of [seen.bottom, seen.top]) {
      expect(shown.spineParts.map((part) => part.part)).toEqual(ORDER)
      expect(shown.spineParts.every((part) => part.shown)).toBe(true)
      expect(shown.spineRoom.need).toBeLessThanOrEqual(shown.spineRoom.room)
      expect(shown.spineRoom.tall).toBeLessThanOrEqual(shown.spineRoom.high)
      expect(shown.spineFoot).toEqual(['theme', 'language', 'settings', 'move-panel', 'collapse'])
    }
    // A section's button reads glyph then abbreviation, a Deck block's its
    // abbreviation then its figure while on, as down a side.
    expect(seen.bottom.spineParts.slice(5).map((part) => part.face)).toEqual(['glyph CMD', 'glyph SKL', 'glyph READ', 'glyph SESS'])
    expect(seen.allBand.spineParts.slice(0, 5).map((part) => part.face)).toEqual(['CTX 86%', 'EVT 3', 'PLN 3/8', 'AGT 1▶', 'LPS 2'])
  })

  it('lays the pane out as columns: the strip first, the Parts in the Spine’s order, the Dock last', () => {
    const names = (shown) => shown.columns.map((column) => column.name)
    expect(names(seen.bottom)).toEqual(['head', 'commands', 'skills', 'session', 'dock-band'])
    // An order of the user's: the Deck is one column of chips, standing where
    // the first block that is on falls — here the Plan, second.
    expect(names(seen.bandOrdered)).toEqual(['head', 'session', 'deck', 'commands', 'readings', 'skills', 'dock-band'])
    expect(seen.bandOrdered.chips.map((chip) => chip.block)).toEqual(['gauge', 'events', 'plan', 'agents', 'loops'])
    for (const shown of [seen.bottom, seen.bandOrdered]) {
      // The page's columns left to right (a long page scrolls under the Dock,
      // which stands after all of them on screen).
      const lefts = shown.columns.slice(0, -1).map((column) => column.left)
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
      expect(shown.columns.at(-1).left).toBeGreaterThan(shown.columns[1].left)
      expect(shown.spill).toEqual({ x: 0, y: 0 })
    }
  })

  it('keeps every column inside the height the Spine leaves it', () => {
    for (const shown of [seen.bottom, seen.top, seen.bandOrdered, seen.allBand]) {
      expect(shown.bodyRoom.tall).toBeLessThanOrEqual(shown.bodyRoom.high)
      expect(shown.headRoom.tall).toBeLessThanOrEqual(shown.headRoom.high)
      expect(shown.commandsBox.h).toBeLessThanOrEqual(shown.paneBox.h)
    }
  })

  it('marks where a dragged button will land along the row: left or right of the one held over', () => {
    const [first, second] = seen.bandDragged.dropMarks
    expect(first).toMatchObject({ over: 'gauge', accepted: true, mark: 'drop-before', lifted: true })
    expect(second).toMatchObject({ over: 'plan', accepted: true, mark: 'drop-after', lifted: true })
    for (const drop of [first, second]) {
      // A line down the button, not across it.
      expect(drop.line.w).toBe(2)
      expect(drop.left).toBe(0)
    }
    const twice = ['session', 'events', 'plan', 'gauge', 'agents', 'loops', 'commands', 'skills', 'readings']
    expect(seen.bandDragged.asked.map(([name]) => name)).toEqual(['setSpineOrder', 'setSpineOrder'])
    expect(seen.bandDragged.spineParts.map((part) => part.part)).toEqual(twice)
    expect(seen.bandDragged.columns.map((column) => column.name)).toEqual(['head', 'session', 'deck', 'commands', 'skills', 'readings', 'dock-band'])
  })
})

describe('the Dock’s microphone', () => {
  const names = (shape) => seen[shape].dockPlay.map((each) => each.name)
  const at = (shape, name) => seen[shape].dockPlay.find((each) => each.name === name)
  const pairs = { 'down a side': ['right', 'listenRail'], 'in a band': ['bottom', 'listenBand'], 'in a band at its floor': ['bandTight', 'listenTight'] }

  for (const [where, [idle, listening]] of Object.entries(pairs)) {
    it(`heads the reading controls, before the bar, ${where}`, () => {
      expect(names(idle)).toEqual(['Speak', 'pause', 'bar', 'again', 'stop'])
      expect(at(idle, 'Speak')).toMatchObject({ label: 'Speak', glyph: 'ph ph-microphone' })
    })

    it(`is drawn the size of pause, again and stop, ${where}`, () => {
      const pause = at(idle, 'pause')
      for (const name of ['Speak', 'again', 'stop']) {
        expect(at(idle, name)).toMatchObject({ w: pause.w, h: pause.h })
      }
    })

    it(`gives its place to Finish and Cancel while listening, ${where}`, () => {
      expect(names(listening)).toEqual(['Finish', 'Cancel', 'pause', 'bar', 'again', 'stop'])
      expect(at(listening, 'Finish')).toMatchObject({ label: 'Finish', glyph: 'ph ph-check', left: at(idle, 'Speak').left })
      expect(at(listening, 'Cancel')).toMatchObject({ label: 'Cancel', glyph: 'ph ph-x' })
    })

    it(`moves nothing else in the row when the listening starts, ${where}`, () => {
      for (const name of ['pause', 'bar', 'again', 'stop']) {
        expect(at(listening, name)).toMatchObject({ left: at(idle, name).left, w: at(idle, name).w })
      }
    })

    it(`still draws the bar, ${where}`, () => {
      expect(at(idle, 'bar').w).toBeGreaterThan(20)
    })

    it(`shows the wave on the state line, and only while listening, ${where}`, () => {
      expect(seen[listening].waveIn).toBe('dock-head')
      expect(seen[listening].waveShown).toBe(true)
      expect(seen[idle].waveShown).toBe(false)
    })
  }

  it('leaves the voice group no taller than its state line and the note', () => {
    // Down a side: the head line, its gap, and the note under it while
    // listening; with nothing to note, the head alone. The pane beside the
    // Spine is 264, and the design's note takes two lines of it there: 61
    // points, where one line came to under 50 in the Rail before the Spine.
    expect(seen.right.dockMicBox.h).toBeLessThan(24)
    expect(seen.listenRail.dockMicBox.h).toBeLessThan(64)
    expect(seen.listenBand.dockMicBox.h).toBe(seen.bottom.dockMicBox.h)
    expect(seen.listenBand.spill).toEqual({ x: 0, y: 0 })
    expect(seen.listenTight.spill).toEqual({ x: 0, y: 0 })
  })
})

describe('the panel shut', () => {
  const ORDER = ['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session']
  const FOOT = ['spine-mic', 'theme', 'language', 'settings', 'move-panel', 'collapse']

  it('is the Spine alone: 52 across down a side, 52 deep along an edge', () => {
    // The old thirteen-button bar is gone; shut, the Panel is its Spine.
    expect(seen.shutSide.spineBox.w).toBe(52)
    expect(seen.shutBand.spineBox).toEqual({ w: 1240, h: 52 })
    for (const shut of [seen.shutSide, seen.shutBand]) {
      expect(shut.collapsed).toBe('true')
      expect(shut.paneShown).toBe(false)
      expect(shut.gripShown).toBe(false)
    }
  })

  it('carries the Spine’s buttons and the microphone, and nothing else', () => {
    // As the client chose it from the prototype: no pause, again or stop, no
    // Copy, Paste or Folder, no New session while shut.
    for (const shut of [seen.shutSide, seen.shutBand]) {
      expect(shut.buttonsShown).toEqual([...ORDER, ...FOOT])
      expect(shut.spineFoot).toEqual(FOOT)
    }
    // Open, the microphone is the Dock's, and not on the Spine.
    expect(seen.right.mic.shown).toBe(false)
    expect(seen.right.spineFoot).toEqual(FOOT.slice(1))
  })

  it('paints the microphone as the one filled button', () => {
    expect(seen.shutSide.mic.filled).toEqual(['spine-mic'])
    expect(seen.shutBand.mic.filled).toEqual(['spine-mic'])
    // It fits the Spine's 52 with room either side.
    expect(seen.shutSide.mic.box.w).toBeLessThanOrEqual(44)
    expect(seen.shutBand.mic.box.h).toBeLessThanOrEqual(44)
  })

  it('starts and ends the dictation exactly as Speak does', () => {
    expect(seen.shutSide.mic).toMatchObject({ title: 'Speak', glyph: 'ph ph-microphone', disabled: false })
    expect(seen.shutSpeak.asked).toEqual([['micPressed', null]])
    // Listening, it is Finish, as the Dock's is.
    expect(seen.shutListening.mic).toMatchObject({ title: 'Finish', glyph: 'ph ph-check', disabled: false })
  })

  it('keeps the live figures of the Deck blocks that are on', () => {
    const faces = (shut) => shut.spineParts.slice(0, 5).map((part) => part.face)
    expect(faces(seen.shutSideAll)).toEqual(['CTX 86%', 'EVT 3', 'PLN 3/8', 'AGT 1▶', 'LPS 2'])
    expect(faces(seen.allShut)).toEqual(['CTX 86%', 'EVT 3', 'PLN 3/8', 'AGT 1▶', 'LPS 2'])
    // And a section still shows its glyph and its abbreviation.
    expect(seen.allShut.spineParts.slice(5).map((part) => part.face)).toEqual([
      'glyph CMD',
      'glyph SKL',
      'glyph READ',
      'glyph SESS',
    ])
  })

  it('opens again from the button that shut it', () => {
    expect(seen.right.collapseTitle).toBe('Shut the panel')
    expect(seen.shutSide.collapseTitle).toBe('Open the panel')
  })

  it('scrolls the Spine in the shortest window rather than spilling it', () => {
    // Nine Parts, the microphone and the foot want more than 420 points; the
    // Spine scrolls, as it does open, and every button stays reachable.
    expect(seen.shutShort.spineScrolls).toBe('auto')
    expect(seen.shutShort.spill).toEqual({ x: 0, y: 0 })
    expect(seen.shutSide.spineRoom.tall).toBeLessThanOrEqual(seen.shutSide.spineRoom.high)
  })
})

describe('the button that moves the panel', () => {
  it('points at where the panel is going, not at where it is', () => {
    expect(seen.left.mover).toContain('caret-double-up')
    expect(seen.top.mover).toContain('caret-double-right')
    expect(seen.right.mover).toContain('caret-double-down')
    expect(seen.bottom.mover).toContain('caret-double-left')
  })

  it('stays at the Spine’s foot while the panel is shut', () => {
    expect(seen.shutSide.mover).toContain('caret-double-down')
    expect(seen.shutBand.mover).toContain('caret-double-right')
  })
})

describe('the Deck', () => {
  it('stays out of the page while no block is on', () => {
    expect(seen.right.deckShown).toBe(false)
    expect(seen.bottom.deckShown).toBe(false)
  })

  it('is switched block by block from the Spine, each block’s button carrying its abbreviation', () => {
    // The five switches that were the Mods group are the Spine's first five
    // buttons (0035).
    const deck = seen.right.spineParts.slice(0, 5)
    expect(deck.map((part) => part.face.split(' ')[0])).toEqual(['CTX', 'EVT', 'PLN', 'AGT', 'LPS'])
  })

  it('keeps the band’s head, the strip alone, inside its height', () => {
    expect(seen.bottom.headRoom.tall).toBeLessThanOrEqual(seen.bottom.headRoom.high)
    expect(seen.bottom.headBox.h).toBeLessThanOrEqual(seen.bottom.panelBox.h)
  })

  it('draws only the blocks that are on, each as one line, the Gauge open to start', () => {
    expect(seen.deckRail.deckShown).toBe(true)
    expect(seen.deckRail.lines.map((line) => [line.block, line.open])).toEqual([
      ['gauge', true],
      ['events', false],
    ])
    // A closed line draws no detail.
    expect(seen.deckRail.deckRows).toBe(0)
    expect(seen.deckRail.spill).toEqual({ x: 0, y: 0 })
  })

  it('draws every block as one line, in the Spine’s order, with the Plan and the Gauge open', () => {
    expect(seen.allRail.lines.map((line) => [line.block, line.open, line.detailShown])).toEqual([
      ['gauge', true, true],
      ['events', false, false],
      ['plan', true, true],
      ['agents', false, false],
      ['loops', false, false],
    ])
    expect(seen.allRail.chips).toEqual([])
  })

  it('says each block’s key figures on its line', () => {
    const said = Object.fromEntries(seen.allRail.lines.map((line) => [line.block, line.text]))
    expect(said.plan).toBe('PLN 3/8 Writing the reducer for the Plan block and its tests +1')
    expect(said.gauge).toBe('CTX 86% 5H 40% 7D 12%')
    expect(said.agents).toBe('AGT 1▶ 1✓ 1✗ 120k tok')
    expect(said.loops).toMatch(/^LPS ▶ 0:\d\d Compacting 1 stray$/)
    expect(said.events).toMatch(/^EVT \d\d:\d\d Bash rm -rf C:\\Jarvis\\Resources$/)
  })

  it('opens a closed line and closes an open one with a click, its detail in place under it', () => {
    expect(seen.allToggled.lines.map((line) => [line.block, line.open, line.detailShown])).toEqual([
      ['gauge', true, true],
      ['events', true, true],
      ['plan', false, false],
      ['agents', false, false],
      ['loops', false, false],
    ])
    expect(seen.allToggled.deckRows).toBe(3)
    expect(seen.allOpen.lines.every((line) => line.open && line.detailShown)).toBe(true)
  })

  it('tints the lines that need you, as the chips are', () => {
    const attention = Object.fromEntries(seen.allRail.lines.map((line) => [line.block, line.attention]))
    expect(attention).toEqual({
      plan: null,
      gauge: 'warning',
      agents: 'alarm',
      loops: null,
      events: null,
    })
  })

  it('fits every line, none past its room, in the narrowest Rail, at every type size', () => {
    for (const shown of [seen.allRail, seen.allOpen, seen.allRail9, seen.allRail14]) {
      expect(shown.lines).toHaveLength(5)
      expect(new Set(shown.lines.map((line) => line.h)).size).toBe(1)
      for (const line of shown.lines) {
        expect(line.over).toBe(0)
        expect(line.right).toBeLessThanOrEqual(0)
      }
      expect(shown.spill).toEqual({ x: 0, y: 0 })
    }
    // Five closed lines are a short list: two lines of type each, near enough.
    expect(seen.allRail.lines[0].h).toBe(20)
  })

  it('draws the subagents as a list, none cut, in the narrowest Rail', () => {
    expect(seen.agentList.deckShown).toBe(true)
    expect(seen.agentList.agentLanes).toBe(3)
    expect(seen.agentList.agentFlags).toBe(1)
    // Each row carries its bar on the time line the rows share.
    expect(seen.agentList.agentLaneBars).toBe(3)
    expect(seen.agentList.agentLaneOver).toBe(0)
    expect(seen.agentList.spill).toEqual({ x: 0, y: 0 })
    expect(seen.agentLanes.agentLanes).toBe(5)
    expect(seen.agentLanes.spill).toEqual({ x: 0, y: 0 })
  })

  it('leaves a running bar room to grow rather than pinning it to the end', () => {
    // Three minutes in, the line is five long: the running bar stops short.
    expect(seen.agentList.agentRunningEnd).toBeGreaterThan(0)
    expect(seen.agentList.agentRunningEnd).toBeLessThan(0.9)
  })

  it('draws the loops as rows, live ones marked, in a Rail', () => {
    const shown = seen.loopsRail
    expect(shown.deckShown).toBe(true)
    expect(shown.loopRows).toBe(4)
    expect(shown.loopsLive).toBe(2)
    expect(shown.spill).toEqual({ x: 0, y: 0 })
  })

  it('draws the Plan as a row per plan and the main plan’s steps, none cut, in the narrowest Rail', () => {
    expect(seen.allRail.planRows).toBe(2)
    expect(seen.allRail.planSteps).toBe(5)
    expect(seen.allRail.planOver).toBe(0)
  })

  it('puts the Plan’s mute at the end of its line, a speaker, struck through while muted', () => {
    expect(seen.allRail.planMute).toEqual({
      pressed: 'false',
      glyph: 'ph ph-speaker-high',
      title: 'Mute plan sounds',
      inLine: true,
    })
    expect(seen.allMuted.planMute).toMatchObject({ pressed: 'true', glyph: 'ph ph-speaker-slash' })
    // Still there with the Plan's detail closed.
    expect(seen.allToggled.planMute).toMatchObject({ inLine: true })
  })

  it('shows a step Claude Code wrote with its acronyms as written', () => {
    expect(seen.allRail.planStepTexts).toContain('ADR 0034')
  })

  it('draws its text at its own size, 10 to start, apart from the rest of the Panel', () => {
    expect(seen.allRail.deckFont).toBe(10)
    expect(seen.allRail9.commandsFont).toBe(seen.allRail14.commandsFont)
  })

  it('fits every detail, none cut, in the narrowest Rail at the smallest and the largest type size', () => {
    for (const size of [9, 14]) {
      const shown = seen[`allRail${size}`]
      expect(shown.deckFont).toBe(size)
      expect(shown.blocksDrawn).toBe(5)
      expect(shown.planRows).toBe(2)
      expect(shown.planOver).toBe(0)
      expect(shown.agentLanes).toBe(3)
      expect(shown.agentLaneOver).toBe(0)
      expect(shown.spill).toEqual({ x: 0, y: 0 })
    }
  })

  it('writes every word in sentence case — a type sent in capitals too — but for the acronyms', () => {
    for (const shown of [seen.allRail, seen.allOpen, seen.allRail9, seen.allRail14, seen.loopsRail, seen.agentList, seen.allBand, seen.allBandMuted]) {
      expect(shown.casing).toEqual([])
    }
  })
})

describe('the Deck in a Band', () => {
  it('keeps the Plan’s mute on its chip, so the sounds can be silenced in a Band', () => {
    expect(seen.allBand.chipMute).toEqual({
      pressed: 'false',
      glyph: 'ph ph-speaker-high',
      title: 'Mute plan sounds',
      label: 'Mute plan sounds',
    })
    expect(seen.allBandMuted.chipMute).toMatchObject({ pressed: 'true', glyph: 'ph ph-speaker-slash' })
    // Down a side, the chip's is hidden with the chip: one mute shows at a time.
    expect(seen.allRail.chipMute).toBeNull()
  })

  it('draws one chip per block that is on, in place of the blocks', () => {
    expect(seen.deckBand.blocksDrawn).toBe(0)
    expect(seen.deckBand.chips.map((chip) => chip.block)).toEqual(['gauge', 'events'])
    // The same figures as the lines.
    expect(seen.agentBand.chips.map((chip) => chip.text)).toEqual(['AGT 1▶ 1✓ 1✗ 120k tok'])
    const [loops] = seen.loopsBand.chips.map((chip) => chip.text)
    expect(loops).toMatch(/^LPS ▶ 0:\d\d Compacting 1 stray$/)
    for (const shown of [seen.allBand, seen.allTop]) {
      expect(shown.blocksDrawn).toBe(0)
      expect(shown.chips.map((chip) => chip.block)).toEqual([
        'gauge',
        'events',
        'plan',
        'agents',
        'loops',
      ])
    }
  })

  it('fits all five inside the band, nothing spilling, nothing cut', () => {
    for (const shown of [seen.deckBand, seen.agentBand, seen.loopsBand, seen.allBand, seen.allTop]) {
      expect(shown.deckBox.h).toBeLessThanOrEqual(shown.panelBox.h)
      expect(shown.spill).toEqual({ x: 0, y: 0 })
      for (const chip of shown.chips) {
        expect(chip.h).toBeLessThanOrEqual(24)
        expect(chip.below).toBeLessThanOrEqual(0)
        expect(chip.above).toBeLessThanOrEqual(0)
        expect(chip.over).toBe(0)
      }
    }
  })

  it('turns a chip to the warning or the alarm when its block needs you', () => {
    const attention = Object.fromEntries(seen.allBand.chips.map((chip) => [chip.block, chip.attention]))
    expect(attention).toEqual({
      plan: null,
      gauge: 'warning',
      agents: 'alarm',
      loops: null,
      events: null,
    })
  })

  it('fits all five inside the band at the smallest and the largest type size', () => {
    for (const size of [9, 14]) {
      const shown = seen[`allBand${size}`]
      expect(shown.deckFont).toBe(size)
      expect(shown.chips).toHaveLength(5)
      expect(shown.deckBox.h).toBeLessThanOrEqual(shown.panelBox.h)
      expect(shown.spill).toEqual({ x: 0, y: 0 })
      for (const chip of shown.chips) {
        expect(chip.h).toBeLessThanOrEqual(24)
        expect(chip.below).toBeLessThanOrEqual(0)
        expect(chip.above).toBeLessThanOrEqual(0)
        expect(chip.over).toBe(0)
      }
    }
  })

  it('draws no chips while the panel is shut, only the figures on the Spine', () => {
    expect(seen.allShut.chips).toEqual([])
    expect(seen.allShut.buttonsShown).toEqual(seen.shutBand.buttonsShown)
  })
})

describe('Commands and Skills your way', () => {
  const sizes = (list) => new Set(list.map((button) => `${button.w}x${button.h}`))

  it('fits three columns of the built-in Commands, icons and all, in the 264 pane, no label cut', () => {
    expect(seen.right.commandColumns).toBe(3)
    expect(seen.right.commandsCut).toEqual([])
    expect(seen.right.buttons.shortcuts.map((button) => button.glyph)).toEqual([
      'ph ph-terminal-window',
      'ph ph-play',
      'ph ph-clock-counter-clockwise',
      'ph ph-arrow-circle-up',
      'ph ph-gauge',
      'ph ph-stack',
      'ph ph-sign-out',
    ])
  })

  it('draws every button of a list the same size, what it carries centred', () => {
    for (const shown of [seen.right, seen.buttonsSized, seen.buttonsBig]) {
      for (const list of ['shortcuts', 'skills']) {
        expect(sizes(shown.buttons[list]).size).toBe(1)
        for (const button of shown.buttons[list]) {
          expect(Math.abs(button.before - button.after)).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('draws a Skill with no icon as its label alone', () => {
    expect(seen.right.buttons.skills.map((button) => button.glyph)).toEqual(['ph ph-lightning', null, 'ph ph-eye'])
  })

  it('stands the Commands and the Skills in the columns chosen, down a side', () => {
    expect(seen.buttonsSized.commandColumns).toBe(2)
    expect(seen.buttonsSized.skillColumns).toBe(1)
    expect(seen.buttonsSized.commandsCut).toEqual([])
    expect(seen.buttonsSized.skillsCut).toEqual([])
    expect(seen.buttonsSized.spill).toEqual({ x: 0, y: 0 })
  })

  it('draws each list at its own text size, the button growing with it', () => {
    expect(seen.right.buttons.shortcuts[0].font).toBe(12)
    expect(seen.buttonsSized.buttons.shortcuts[0].font).toBe(16)
    expect(seen.buttonsSized.buttons.skills[0].font).toBe(10)
    expect(seen.buttonsSized.buttons.shortcuts[0].h).toBeGreaterThan(seen.right.buttons.shortcuts[0].h)
    expect(seen.buttonsSized.buttons.skills[0].h).toBeLessThan(seen.right.buttons.skills[0].h)
  })

  it('draws the Spine’s labels at their own size', () => {
    expect(seen.right.spineFont).toBe(9)
    expect(seen.buttonsSized.spineFont).toBe(13)
    expect(seen.buttonsSized.spineRoom.need).toBeLessThanOrEqual(seen.buttonsSized.spineRoom.room)
  })

  it('keeps three rows flowing sideways in a Band, whatever the columns chosen', () => {
    const band = seen.buttonsBand
    expect(band.commandColumns).toBe(3)
    expect(band.bodyRoom.tall).toBeLessThanOrEqual(band.bodyRoom.high)
    for (const button of band.buttons.shortcuts) expect(button.h).toBeLessThanOrEqual(24)
  })

  it('reorders a list by a drag, a line marking where it lands, a click still presses, and a right click edits', () => {
    const [commands, skills] = seen.buttonsDragged.dropMarks
    expect(commands).toMatchObject({ over: '1', accepted: true, mark: 'drop-before', lifted: true, left: 0 })
    expect(skills).toMatchObject({ over: 's3', accepted: true, mark: 'drop-after', lifted: true, left: 0 })
    expect(commands.line.w).toBe(2)
    expect(seen.buttonsDragged.asked).toEqual([
      ['setShortcutOrder', ['7', '1', '2', '3', '4', '5', '6']],
      ['setSkillOrder', ['s2', 's3', 's1']],
      ['pressShortcut', '7'],
      ['editShortcut', '3'],
      ['editSkill', 's3'],
    ])
    expect(seen.buttonsDragged.buttons.shortcuts.map((button) => button.label)[0]).toBe('Exit')
    expect(seen.buttonsDragged.buttons.skills.map((button) => button.id)).toEqual(['s2', 's3', 's1'])
    expect(seen.right.buttons.shortcuts.every((button) => button.draggable)).toBe(true)
  })

  it('reads a drop above or below in a Band, where the lists flow down their columns', () => {
    const [commands, skills] = seen.buttonsBandDragged.dropMarks
    expect(commands).toMatchObject({ over: '1', accepted: true, mark: 'drop-before', lifted: true, left: 0 })
    expect(skills).toMatchObject({ over: 's3', accepted: true, mark: 'drop-after', lifted: true, left: 0 })
    // A line across the button, on the edge it will land by.
    for (const drop of [commands, skills]) expect(drop.line.h).toBe(2)
    expect(seen.buttonsBandDragged.asked.slice(0, 2)).toEqual([
      ['setShortcutOrder', ['7', '1', '2', '3', '4', '5', '6']],
      ['setSkillOrder', ['s2', 's3', 's1']],
    ])
  })
})
