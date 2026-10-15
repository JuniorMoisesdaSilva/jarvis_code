import { describe, expect, it } from 'vitest'
import { BLOCKS } from '../src/core/deck-chips.js'
import { DEFAULT_ORDER, PARTS, cleanOrder, cleanHidden, partsOn, moved, hiding } from '../src/core/spine.js'

// The Spine: one button per Part of the Panel's page. Nine Parts — the five
// Deck blocks and four sections — in one table, the Deck's five taken from the
// Deck's own catalogue.

describe('the nine Parts', () => {
  it('are the five Deck blocks and Commands, Skills, Recent readings and Session', () => {
    expect(PARTS.map((part) => part.id)).toEqual([
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
  })

  it('take the Deck blocks’ abbreviation, name and glyph from the Deck’s catalogue', () => {
    for (const block of BLOCKS) {
      const part = PARTS.find((each) => each.id === block.id)
      expect(part).toMatchObject({
        abbreviation: block.abbreviation,
        name: block.name,
        glyph: block.glyph,
        preference: block.preference,
        deck: true,
      })
    }
  })

  it('give each section an abbreviation, a name, a glyph and a switch of its own', () => {
    const sections = PARTS.filter((part) => !part.deck)
    expect(sections.map((part) => [part.id, part.abbreviation, part.name, part.preference])).toEqual([
      ['commands', 'CMD', 'Commands', 'partCommands'],
      ['skills', 'SKL', 'Skills', 'partSkills'],
      ['readings', 'READ', 'Recent readings', 'partReadings'],
      ['session', 'SESS', 'Session', 'partSession'],
    ])
    for (const part of sections) expect(part.glyph).toMatch(/^[a-z-]+$/)
  })
})

describe('the Spine’s order', () => {
  it('starts with the Deck blocks, CTX at the head, then the four sections', () => {
    expect(DEFAULT_ORDER).toEqual(['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session'])
  })

  it('keeps a stored order', () => {
    const stored = ['commands', 'plan', 'gauge', 'skills', 'events', 'agents', 'loops', 'session', 'readings']
    expect(cleanOrder(stored)).toEqual(stored)
  })

  it('drops an id it does not know, and a repeated one', () => {
    expect(cleanOrder(['commands', 'nonsense', 'commands', 'plan', 7])).toEqual([
      'commands',
      'plan',
      'gauge',
      'events',
      'agents',
      'loops',
      'skills',
      'readings',
      'session',
    ])
  })

  it('appends what is missing in the default order', () => {
    expect(cleanOrder(['session'])).toEqual(['session', ...DEFAULT_ORDER.filter((id) => id !== 'session')])
    expect(cleanOrder([])).toEqual(DEFAULT_ORDER)
  })
})

describe('the hidden Parts', () => {
  it('keep only known ids, once each', () => {
    expect(cleanHidden(['loops', 'loops', 'nonsense', 3, 'skills'])).toEqual(['loops', 'skills'])
  })
})

describe('which Parts are on', () => {
  const stored = {
    deckGauge: true,
    deckEvents: false,
    deckPlan: true,
    deckAgents: false,
    deckLoops: true,
    partCommands: true,
    partSkills: false,
    partReadings: true,
    partSession: true,
    spineHidden: [],
  }

  it('is each Part’s own switch', () => {
    expect(partsOn(stored)).toEqual({
      gauge: true,
      events: false,
      plan: true,
      agents: false,
      loops: true,
      commands: true,
      skills: false,
      readings: true,
      session: true,
    })
  })

  it('leaves a hidden Part off, whatever its switch says', () => {
    const on = partsOn({ ...stored, spineHidden: ['plan', 'commands'] })
    expect(on.plan).toBe(false)
    expect(on.commands).toBe(false)
    expect(on.gauge).toBe(true)
  })
})

describe('a Spine button dropped on another', () => {
  const order = ['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session']

  it('lands before the target', () => {
    expect(moved(order, 'session', 'events', false)).toEqual([
      'gauge',
      'session',
      'events',
      'plan',
      'agents',
      'loops',
      'commands',
      'skills',
      'readings',
    ])
  })

  it('lands after the target', () => {
    expect(moved(order, 'gauge', 'plan', true)).toEqual([
      'events',
      'plan',
      'gauge',
      'agents',
      'loops',
      'commands',
      'skills',
      'readings',
      'session',
    ])
  })

  it('leaves the order as it was when dropped on itself or on something unknown', () => {
    expect(moved(order, 'plan', 'plan', true)).toEqual(order)
    expect(moved(order, 'plan', 'nonsense', true)).toEqual(order)
    expect(moved(order, 'nonsense', 'plan', true)).toEqual(order)
  })

  it('comes back whole from an order that was short', () => {
    expect(moved(['session'], 'gauge', 'session', true)).toEqual(cleanOrder(['session', 'gauge']))
  })
})

// Settings lists the Spine's buttons with a tick each. Unticking hides the
// button and turns its Part off; ticking shows the button again and leaves
// the Part off, for a click on the Spine to turn on.
describe('a Spine button hidden or shown from Settings', () => {
  it('hides the button and turns its Part off', () => {
    expect(hiding({ spineHidden: ['loops'], deckPlan: true }, 'plan', true)).toEqual({
      spineHidden: ['loops', 'plan'],
      deckPlan: false,
    })
    expect(hiding({}, 'commands', true)).toEqual({ spineHidden: ['commands'], partCommands: false })
  })

  it('shows it again and leaves its Part off', () => {
    expect(hiding({ spineHidden: ['loops', 'plan'] }, 'plan', false)).toEqual({ spineHidden: ['loops'] })
  })

  it('changes nothing for a Part it does not know', () => {
    expect(hiding({ spineHidden: ['loops'] }, 'nonsense', true)).toEqual({})
  })

  it('hides a button once however often it is unticked', () => {
    expect(hiding({ spineHidden: ['plan'] }, 'plan', true).spineHidden).toEqual(['plan'])
  })
})
