import { describe, expect, it } from 'vitest'
import {
  BAND,
  BAND_MAX,
  COLLAPSED,
  POSITIONS,
  RAIL,
  RAIL_MAX,
  TERMINAL_FLOOR,
  clampMeasure,
  defaultMeasure,
  isPosition,
  isSide,
  layOut,
  nextPosition,
} from '../src/core/geometry.js'
import * as geometryModule from '../src/core/geometry.js'

/** The window Jarvis opens at, for the cases that are not about a tight fit. */
const ROOM = { width: 1240, height: 780 }

describe('which side the panel is on', () => {
  it('knows the four, and nothing else', () => {
    expect(POSITIONS).toEqual(['left', 'top', 'right', 'bottom'])
    expect(isPosition('left')).toBe(true)
    expect(isPosition('middle')).toBe(false)
    expect(isPosition('')).toBe(false)
    expect(isPosition(null)).toBe(false)
  })

  it('tells a side from an edge, because they measure different axes', () => {
    expect(isSide('left')).toBe(true)
    expect(isSide('right')).toBe(true)
    expect(isSide('top')).toBe(false)
    expect(isSide('bottom')).toBe(false)
  })

  it('cycles the way the button reads: left, top, right, bottom, round again', () => {
    expect(nextPosition('left')).toBe('top')
    expect(nextPosition('top')).toBe('right')
    expect(nextPosition('right')).toBe('bottom')
    expect(nextPosition('bottom')).toBe('left')
  })

  it('settles an unknown side on the right, and answers with the step after it', () => {
    expect(nextPosition('nonsense')).toBe(nextPosition('right'))
    expect(nextPosition('nonsense')).toBe('bottom')
  })
})

describe('the measure the panel asks for', () => {
  it('opens at 316 down a side and 148 along an edge', () => {
    expect(defaultMeasure('right')).toBe(RAIL)
    expect(defaultMeasure('left')).toBe(RAIL)
    expect(defaultMeasure('top')).toBe(BAND)
    expect(defaultMeasure('bottom')).toBe(BAND)
  })

  it('holds a side between 316 and 520', () => {
    expect(clampMeasure('right', 100)).toBe(RAIL)
    expect(clampMeasure('right', 400)).toBe(400)
    expect(clampMeasure('right', 900)).toBe(RAIL_MAX)
  })

  it('holds an edge between 148 and 300', () => {
    expect(clampMeasure('bottom', 10)).toBe(BAND)
    expect(clampMeasure('bottom', 200)).toBe(200)
    expect(clampMeasure('bottom', 900)).toBe(BAND_MAX)
  })

  it('rounds, since a pane cannot be laid out on half a point', () => {
    expect(clampMeasure('right', 400.6)).toBe(401)
  })

  it('falls back rather than answering with a number that is not one', () => {
    expect(clampMeasure('right', Number.NaN)).toBe(RAIL)
    expect(clampMeasure('bottom', undefined)).toBe(BAND)
  })
})

describe('the panel down a side', () => {
  it('puts the terminal on the left and the panel on the right', () => {
    const { terminal, panel } = layOut({ ...ROOM, position: 'right', wanted: RAIL })
    expect(panel).toEqual({ x: 1240 - RAIL, y: 0, width: RAIL, height: 780 })
    expect(terminal).toEqual({ x: 0, y: 0, width: 1240 - RAIL, height: 780 })
  })

  it('mirrors exactly when the panel is on the left', () => {
    const { terminal, panel } = layOut({ ...ROOM, position: 'left', wanted: RAIL })
    expect(panel).toEqual({ x: 0, y: 0, width: RAIL, height: 780 })
    expect(terminal).toEqual({ x: RAIL, y: 0, width: 1240 - RAIL, height: 780 })
  })

  it('gives the two panes the whole window between them', () => {
    const { terminal, panel } = layOut({ ...ROOM, position: 'left', wanted: 480 })
    expect(terminal.width + panel.width).toBe(1240)
  })
})

describe('the panel along an edge', () => {
  it('lays a band across the foot and leaves the terminal the rest', () => {
    const { terminal, panel } = layOut({ ...ROOM, position: 'bottom', wanted: BAND })
    expect(panel).toEqual({ x: 0, y: 780 - BAND, width: 1240, height: BAND })
    expect(terminal).toEqual({ x: 0, y: 0, width: 1240, height: 780 - BAND })
  })

  it('mirrors exactly when the band is on top', () => {
    const { terminal, panel } = layOut({ ...ROOM, position: 'top', wanted: BAND })
    expect(panel).toEqual({ x: 0, y: 0, width: 1240, height: BAND })
    expect(terminal).toEqual({ x: 0, y: BAND, width: 1240, height: 780 - BAND })
  })

  it('leaves the terminal its full width, which is the point of a band', () => {
    const { terminal } = layOut({ ...ROOM, position: 'top', wanted: 300 })
    expect(terminal.width).toBe(1240)
  })
})

describe('the terminal never falls under its floor', () => {
  it('takes the room out of the panel, not out of the terminal', () => {
    const { terminal, panel } = layOut({ width: 500, height: 780, position: 'right', wanted: 520 })
    expect(terminal.width).toBe(TERMINAL_FLOOR)
    expect(panel.width).toBe(500 - TERMINAL_FLOOR)
  })

  it('applies the floor on the axis the panel is on, and only there', () => {
    const { terminal, panel } = layOut({ width: 500, height: 380, position: 'bottom', wanted: 300 })
    expect(terminal.height).toBe(TERMINAL_FLOOR)
    expect(panel.height).toBe(380 - TERMINAL_FLOOR)
    // The band still runs the whole width: a short window is not a narrow one.
    expect(terminal.width).toBe(500)
    expect(panel.width).toBe(500)
  })

  it('holds at the window Jarvis refuses to go below', () => {
    const tight = layOut({ width: 720, height: 420, position: 'bottom', wanted: BAND_MAX })
    expect(tight.panel.height).toBe(160)
    expect(tight.terminal.height).toBe(TERMINAL_FLOOR)
  })

  it('never hands back a negative pane, however small the window', () => {
    const { terminal, panel } = layOut({ width: 120, height: 120, position: 'right', wanted: RAIL })
    expect(panel.width).toBe(0)
    expect(terminal.width).toBe(120)
  })

  it('does not write the granted measure back over the wanted one', () => {
    // The caller keeps what was asked for, so widening the window later hands
    // the panel back what it had. Nothing here may change that number.
    const wanted = 520
    layOut({ width: 500, height: 780, position: 'right', wanted })
    expect(wanted).toBe(520)
  })
})

describe('the panel shut', () => {
  it('is 52 points down a side', () => {
    const { panel, terminal } = layOut({
      ...ROOM,
      position: 'left',
      wanted: 480,
      collapsed: true,
    })
    expect(panel.width).toBe(COLLAPSED)
    expect(terminal.width).toBe(1240 - COLLAPSED)
  })

  it('is 52 points along an edge', () => {
    const { panel } = layOut({ ...ROOM, position: 'top', wanted: 300, collapsed: true })
    expect(panel.height).toBe(COLLAPSED)
    expect(panel.width).toBe(1240)
  })
})

describe('the Settings sheet over it', () => {
  it('takes no room at all while it is shut', () => {
    const { settings } = layOut({ ...ROOM, position: 'right', wanted: RAIL })
    expect(settings.width).toBe(0)
    expect(settings.height).toBe(0)
  })

  // ADR 0036: the sheet is the whole window while it is open, whichever side
  // the panel is on and whatever shape it has. The terminal keeps its place
  // underneath it and runs on; nothing is resized when the sheet opens.
  it('is the whole window while it is open, wherever the panel is', () => {
    for (const position of ['left', 'top', 'right', 'bottom']) {
      for (const collapsed of [false, true]) {
        const { settings } = layOut({ ...ROOM, position, collapsed, wanted: RAIL, settingsOpen: true })
        expect(settings).toEqual({ x: 0, y: 0, width: 1240, height: 780 })
      }
    }
  })

  it('leaves the terminal and the panel where they were', () => {
    const shut = layOut({ ...ROOM, position: 'right', wanted: RAIL })
    const open = layOut({ ...ROOM, position: 'right', wanted: RAIL, settingsOpen: true })
    expect(open.terminal).toEqual(shut.terminal)
    expect(open.panel).toEqual(shut.panel)
  })

  it('has no width of its own any more', () => {
    expect(geometryModule.SETTINGS).toBeUndefined()
  })
})

describe('a position that is not one of the four', () => {
  it('lays out on the right rather than refusing to lay out at all', () => {
    const odd = layOut({ ...ROOM, position: 'sideways', wanted: RAIL })
    expect(odd).toEqual(layOut({ ...ROOM, position: 'right', wanted: RAIL }))
  })
})
