import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GLYPHS,
  COMMAND_GLYPH,
  SKILL_GLYPH,
  cleanGlyph,
  COLUMNS,
  SPINE_FONT,
  BUTTON_FONT,
  within,
  reordered,
  dropsAfter,
  inOrder,
  TERMINAL_FONT,
  settle,
} from '../src/core/button-look.js'

// How the Panel's Command and Skill buttons look, in one list the preferences,
// the shortcuts, the Panel and Settings' icon picker all read.

const PHOSPHOR = fs.readFileSync(new URL('../src/renderer/assets/phosphor/phosphor.css', import.meta.url), 'utf8')

describe('the icons a button may carry', () => {
  it('are about fifty Phosphor names, each once', () => {
    expect(GLYPHS.length).toBeGreaterThanOrEqual(45)
    expect(GLYPHS.length).toBeLessThanOrEqual(60)
    expect(new Set(GLYPHS).size).toBe(GLYPHS.length)
  })

  it('are every one drawn by the vendored Phosphor set', () => {
    const missing = GLYPHS.filter((name) => !PHOSPHOR.includes(`.ph-${name}:`))
    expect(missing).toEqual([])
  })

  it('hold the two a new Command and a new Skill carry', () => {
    expect(COMMAND_GLYPH).toBe('terminal-window')
    expect(SKILL_GLYPH).toBe('lightning')
    expect(GLYPHS).toContain(COMMAND_GLYPH)
    expect(GLYPHS).toContain(SKILL_GLYPH)
  })

  it('turn a name not among them, or no name, into none', () => {
    expect(cleanGlyph('rocket')).toBe('rocket')
    for (const bad of ['not-an-icon', 'ph-rocket', '', null, undefined, 3, {}]) {
      expect(cleanGlyph(bad)).toBeNull()
    }
  })
})

describe('the ranges the user sets', () => {
  it('are one to five columns, three to start', () => {
    expect(COLUMNS).toEqual({ min: 1, max: 5, size: 3 })
  })

  it('are 8 to 14 for the Spine’s labels, 9 to start, and 10 to 16 for a button, 12 to start', () => {
    expect(SPINE_FONT).toEqual({ min: 8, max: 14, size: 9 })
    expect(BUTTON_FONT).toEqual({ min: 10, max: 16, size: 12 })
  })

  it('take whole numbers inside the range only', () => {
    expect(within(COLUMNS, 1)).toBe(true)
    expect(within(COLUMNS, 5)).toBe(true)
    for (const bad of [0, 6, 2.5, '3', null]) expect(within(COLUMNS, bad)).toBe(false)
  })
})

describe('reordering by a drop', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('puts the dropped id just before or just after the one it lands on', () => {
    expect(reordered(ids, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c'])
    expect(reordered(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('leaves the order alone dropped on itself or with an id it does not know', () => {
    expect(reordered(ids, 'b', 'b', true)).toEqual(ids)
    expect(reordered(ids, 'x', 'b', true)).toEqual(ids)
    expect(reordered(ids, 'b', 'x', true)).toEqual(ids)
  })

  it('puts a stored list in the order given, keeping any item the order does not name', () => {
    const list = ids.map((id) => ({ id }))
    expect(inOrder(list, ['c', 'a', 'nonsense', 'c']).map((each) => each.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(inOrder(list, 'not a list').map((each) => each.id)).toEqual(ids)
  })
})

// Settings types a size into a number box; what lands is the number brought
// back inside its range on leaving the box, on the range's own step.
describe('a typed size, settled', () => {
  it('keeps a size inside the range as it is', () => {
    expect(settle(BUTTON_FONT, 13)).toBe(13)
    expect(settle(TERMINAL_FONT, 13.5)).toBe(13.5)
  })

  it('brings a size outside the range back to its nearer end', () => {
    expect(settle(BUTTON_FONT, 40)).toBe(16)
    expect(settle(BUTTON_FONT, 2)).toBe(10)
    expect(settle(SPINE_FONT, -3)).toBe(8)
    expect(settle(TERMINAL_FONT, 99)).toBe(24)
  })

  it('rounds onto the step: whole pixels, or half-points for the terminal', () => {
    expect(settle(BUTTON_FONT, 12.6)).toBe(13)
    expect(settle(TERMINAL_FONT, 13.3)).toBe(13.5)
    expect(settle(TERMINAL_FONT, 13.2)).toBe(13)
  })

  it('reads a typed string, and gives nothing back for what is not a number', () => {
    expect(settle(BUTTON_FONT, '14')).toBe(14)
    expect(settle(BUTTON_FONT, '')).toBeNull()
    expect(settle(BUTTON_FONT, 'big')).toBeNull()
    expect(settle(BUTTON_FONT, Number.NaN)).toBeNull()
  })

  it('holds the terminal’s range, the one the preferences keep', () => {
    expect(TERMINAL_FONT).toEqual({ min: 9, max: 24, step: 0.5, size: 13.5 })
  })
})

describe('which half of the target a drop is in', () => {
  const box = { left: 100, top: 200, width: 44, height: 34 }

  it('is above or below the middle in a list that flows down a column', () => {
    expect(dropsAfter('column', { x: 999, y: 210 }, box)).toBe(false)
    expect(dropsAfter('column', { x: 0, y: 225 }, box)).toBe(true)
  })

  it('is left or right of the middle in a list that flows along a row', () => {
    expect(dropsAfter('row', { x: 110, y: 999 }, box)).toBe(false)
    expect(dropsAfter('row', { x: 130, y: 0 }, box)).toBe(true)
  })
})
