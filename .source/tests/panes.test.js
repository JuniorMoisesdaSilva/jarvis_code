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
// at runtime, and whether four controls fit a 316-point footer depends on
// Inter's own metrics. `Docs/history/the-cut-off-terminal` was closed by
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

  it('fits its whole footer in 316 points, with the mark gone and the mover in', () => {
    // 0018 measured this footer to the pixel once already, and it came to one
    // pixel over. The mark left with the header; the mover is spending its room.
    expect(seen.right.foot.need).toBeLessThanOrEqual(seen.right.foot.room + ROUNDING)
  })

  it('carries the edit labels, which 316 points guarantees by construction', () => {
    expect(seen.right.edit).toBe('wide')
    expect(seen.right.editWords).toBe(3)
  })

  it('gains a column of commands when it is dragged wider, rather than stretching', () => {
    // 277 wide is three tracks of 72 and their gaps; 481 is five.
    expect(seen.wide.commandsBox.w).toBeGreaterThan(seen.right.commandsBox.w)
    expect(seen.wide.commandsBox.h).toBeLessThan(seen.right.commandsBox.h)
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

  it('breaks its footer into two lines, and stops there', () => {
    // One line of controls spans 29 points; two and their gap, 55; three, 85.
    // The handoff's 140-point ceiling gave three, because the ceiling is on the
    // box and the footer's own padding comes out of it first — see the note in
    // panel.css.
    expect(seen.bottom.footBox.w).toBeLessThanOrEqual(156)
    expect(seen.right.footSpan).toBeLessThan(45)
    expect(seen.bottom.footSpan).toBeGreaterThan(45)
    expect(seen.bottom.footSpan).toBeLessThan(80)
    expect(seen.bottom.foot.need).toBeLessThanOrEqual(seen.bottom.foot.room + ROUNDING)
  })

  it('keeps PT and EN, which have nowhere else to go', () => {
    // The handoff sends them to Settings. Settings has no language control at
    // all, so they stay: a language you cannot reach is worse than a tight row.
    const named = seen.bottom.footKids.map((kid) => kid.id)
    expect(named).toContain('language')
    expect(named).toContain('move-panel')
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

  it('puts the Session pair under the strip, and the page keeps it down a side', () => {
    // One node, two homes. In a band the first column is everything about the
    // session and the middle is what you press; down a side it is the third
    // block of the page, where 0018 put it.
    expect(seen.bottom.sessionIn).toBe('head')
    expect(seen.top.sessionIn).toBe('head')
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

describe('the panel shut', () => {
  it('fits its widest button inside 52 points', () => {
    // The microphone is the widest thing on it at 36, and the bar's own padding
    // is what had to give: at the wider step the two came to 52.8 inside 52.
    expect(seen.shutSide.barNeeds.across).toBeLessThanOrEqual(52)
    expect(seen.shutBand.barNeeds.across).toBeLessThanOrEqual(52)
  })

  it('carries all thirteen of them', () => {
    // Ten, and then the reading's own three: hold, again, stop. A reading is
    // what you sit through with the panel shut, so the controls for it are the
    // last thing that should have needed the panel open.
    expect(seen.shutSide.barNeeds.buttons).toBe(13)
  })

  it('stacks them inside the height a side gives it', () => {
    expect(seen.shutSide.barNeeds.along).toBeLessThanOrEqual(780)
  })

  it('is as long as the pane it is in, and not four points of it', () => {
    // The one that bit. `.bar` is theme.css's 4-point progress bar, and the
    // shut column borrowed the name: `height: 4px` reached it, `overflow:
    // hidden` swallowed the result, and every button but the first was simply
    // not on screen with nothing to say so.
    expect(seen.shutSide.barBox.h).toBeGreaterThan(700)
    expect(seen.shutSide.barBox.h).toBeGreaterThan(seen.shutSide.barNeeds.along)
  })

  it('fits the whole column in the shortest window the app allows', () => {
    // Thirteen icons want 499 points and the window may be 420 tall. They give
    // way together rather than the last of them falling off the bottom: on a
    // bar where every button is the only way to reach what it does, a button
    // drawn past the edge is a button that is gone.
    expect(seen.shutShort.barRoom.tall).toBeLessThanOrEqual(seen.shutShort.barRoom.high)
    expect(seen.shutShort.spill).toEqual({ x: 0, y: 0 })
    // And where the room is there, nothing has given way at all.
    expect(seen.shutSide.barNeeds.along).toBeGreaterThan(seen.shutShort.barNeeds.along)
  })

  it('takes the whole band when it is shut along an edge', () => {
    expect(seen.shutBand.barBox).toEqual({ w: 1240, h: 52 })
  })
})

describe('the button that moves the panel', () => {
  it('points at where the panel is going, not at where it is', () => {
    expect(seen.left.mover).toContain('caret-double-up')
    expect(seen.top.mover).toContain('caret-double-right')
    expect(seen.right.mover).toContain('caret-double-down')
    expect(seen.bottom.mover).toContain('caret-double-left')
  })

  it('is on the shut bar as well as in the footer', () => {
    expect(seen.shutSide.mover).toContain('caret-double-down')
    expect(seen.shutBand.mover).toContain('caret-double-right')
  })
})
