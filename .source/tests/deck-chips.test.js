import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { chipFor } from '../src/core/deck-chips.js'
import { BLOCKS, initialDeck, reduce, view } from '../src/core/deck.js'
import { agentEvent } from '../src/core/hook-payload.js'
import { fixture } from './helpers.js'

// The Deck in a Band: one chip per block, an abbreviation and the block's key
// figures, the detail in its title, and whether the block needs you. Each chip
// is made from the view its block is published as.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'
const NOW = 1_760_000_000_000

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

const gauge = (over = {}) => ({
  reported: true,
  context: { percent: 62, compactions: [] },
  limits: { fiveHour: { percent: 40, resetsAt: NOW + 3_600_000 }, sevenDay: { percent: 12, resetsAt: NOW + 86_400_000 * 3 } },
  model: 'Opus',
  effort: 'high',
  permissionMode: 'default',
  ...over,
})

describe('a chip for every block', () => {
  it('says something for each of the six before anything has happened', () => {
    const empty = view(initialDeck(SESSION))
    for (const block of BLOCKS) {
      const chip = chipFor(block.id, empty[block.id], NOW)
      expect(chip.abbreviation).toBe(block.abbreviation)
      expect(chip.text.startsWith(`${block.abbreviation} `)).toBe(true)
      expect(chip.attention).toBeNull()
      expect(chip.live).toBe(false)
      expect(chip.title).not.toBe('')
    }
  })

  it('knows no block it was not told of', () => {
    expect(chipFor('weather', {}, NOW)).toBeNull()
  })
})

describe('the Gauge chip', () => {
  it('carries the context and the five-hour window, and no cost', () => {
    const chip = chipFor('gauge', gauge({ costUsd: 1.84 }), NOW)
    expect(chip.text).toBe('CTX 62% · 5H 40%')
    expect(chip.title).not.toContain('$')
    expect(chip.title).toContain('Seven-day limit 12%')
    expect(chip.title).toContain('Opus · high · default')
  })

  it('drops what is not reported, and says so when nothing is', () => {
    expect(chipFor('gauge', gauge({ limits: { fiveHour: null, sevenDay: null } }), NOW).text).toBe('CTX 62%')
    expect(chipFor('gauge', gauge({ context: { percent: null, compactions: [] } }), NOW).text).toBe('CTX — · 5H 40%')
    expect(chipFor('gauge', { ...gauge(), reported: false }, NOW).text).toBe('CTX —')
  })

  it('asks to be looked at above 80% of the context, and not at it', () => {
    expect(chipFor('gauge', gauge({ context: { percent: 80, compactions: [] } }), NOW).attention).toBeNull()
    expect(chipFor('gauge', gauge({ context: { percent: 80.5, compactions: [] } }), NOW).attention).toBe('warning')
  })
})

describe('the Agents chip', () => {
  const agent = (status, outOfOutput = null) => ({ id: status, status, outOfOutput })

  it('shows the running, the done and the failed', () => {
    const chip = chipFor('agents', { running: 2, done: 3, failed: 0, agents: [agent('running'), agent('done')] }, NOW)
    expect(chip.text).toBe('AGT 2▶ 3✓')
    expect(chip.attention).toBeNull()
    expect(chipFor('agents', { running: 0, done: 3, failed: 1, agents: [agent('failed')] }, NOW).text).toBe('AGT 3✓ 1✗')
  })

  it('raises the alarm when one failed or ran out of output room', () => {
    expect(chipFor('agents', { running: 0, done: 1, failed: 1, agents: [agent('failed')] }, NOW).attention).toBe('alarm')
    const cut = chipFor('agents', { running: 0, done: 1, failed: 0, agents: [agent('done', true)] }, NOW)
    expect(cut.attention).toBe('alarm')
    expect(cut.title).toContain('1 ran out of output room')
  })
})

describe('the Loops chip', () => {
  const loops = (strays, compactions = []) => ({ liveForMs: 30_000, graceMs: 3_000, compactions, strays })
  const stray = (firstAgo, lastAgo) => ({ id: 'a', short: 'a', steps: 2, firstSeen: NOW - firstAgo, lastSeen: NOW - lastAgo })

  it('counts running compactions and the strays the block would show at work', () => {
    const chip = chipFor(
      'loops',
      loops(
        [stray(60_000, 1_000), stray(900_000, 800_000), stray(1_000, 500)],
        [{ trigger: 'auto', running: true, startedAt: NOW - 5_000, endedAt: null }],
      ),
      NOW,
    )
    // One compaction, one stray at work; the quiet one and the one still in its grace are not counted.
    expect(chip.text).toBe('LPS 2')
    expect(chip.live).toBe(true)
  })

  it('wants a clock while a stray in its grace may yet be counted, and none when all is quiet', () => {
    expect(chipFor('loops', loops([stray(1_000, 500)]), NOW).live).toBe(true)
    const quiet = chipFor('loops', loops([stray(900_000, 800_000)]), NOW)
    expect(quiet.text).toBe('LPS 0')
    expect(quiet.live).toBe(false)
  })
})

describe('the Events chip', () => {
  it('shows the latest entry, clipped, and the recent ones in its title', () => {
    const entries = [
      { id: 2, kind: 'denied', label: 'Bash', detail: 'rm -rf C:\\Jarvis\\Resources\\voices', note: 'Not allowed in auto mode' },
      { id: 1, kind: 'prompt', label: 'Prompt', detail: 'diga apenas: ok', note: null },
    ]
    const chip = chipFor('events', entries, NOW)
    expect(chip.text).toBe('EVT Bash rm -rf C:\\Jarvis\\Resou…')
    expect(chip.figures.length).toBeLessThanOrEqual(28)
    expect(chip.title).toContain('Bash rm -rf C:\\Jarvis\\Resources\\voices — Not allowed in auto mode')
    expect(chip.title).toContain('Prompt diga apenas: ok')
  })
})

describe('the Plan chip', () => {
  const row = (over = {}) => ({
    id: 'main',
    title: 'Main',
    done: 3,
    total: 8,
    current: 'Writing the reducer',
    finished: false,
    inAgent: false,
    ...over,
  })

  it('carries done of total and the step under way', () => {
    const chip = chipFor('plan', { rows: [row()], steps: [] }, NOW)
    expect(chip.text).toBe('PLN 3/8 · Writing the reducer')
    expect(chip.attention).toBeNull()
    expect(chip.live).toBe(false)
  })

  it('cuts a long step short', () => {
    const chip = chipFor('plan', { rows: [row({ current: 'Writing the reducer and every one of its tests' })], steps: [] }, NOW)
    expect(chip.figures.length).toBeLessThanOrEqual(34)
    expect(chip.figures.endsWith('…')).toBe(true)
  })

  it('says the main plan first, and every plan in its title', () => {
    const chip = chipFor(
      'plan',
      { rows: [row(), row({ id: 'a1', title: 'Find the installer', done: 1, total: 2, current: null, inAgent: true })], steps: [] },
      NOW,
    )
    expect(chip.figures.startsWith('3/8')).toBe(true)
    expect(chip.title).toContain('Main · 3/8 · Writing the reducer')
    expect(chip.title).toContain('Find the installer · 1/2')
  })

  it('says a plan is done when it is', () => {
    const chip = chipFor('plan', { rows: [row({ done: 8, current: null, finished: true })], steps: [] }, NOW)
    expect(chip.text).toBe('PLN 8/8 · Done')
  })

  it('is a dash before any plan', () => {
    expect(chipFor('plan', { rows: [], steps: [] }, NOW).text).toBe('PLN —')
  })
})

describe('the block catalogue', () => {
  it('is one list, which the reducer and the preferences read from here', () => {
    const load = createRequire(import.meta.url)
    const chips = load('../src/core/deck-chips.js')
    expect(load('../src/core/deck.js').BLOCKS).toBe(chips.BLOCKS)
    expect(fs.readFileSync(new URL('../src/core/preferences.js', import.meta.url), 'utf8')).not.toContain("require('./deck')")
    for (const block of chips.BLOCKS) {
      expect(block.glyph).toMatch(/^[a-z-]+$/)
      expect(block.about).not.toBe('')
    }
  })
})

// A Deck block's button on the Spine carries its one live figure while the
// block is on: CTX 62%, PLN 3/8, AGT 2▶. Four characters at most, for a 44-point button:
// a figure that will not fit is said another way, never cut.
describe('the figure on a block’s Spine button', () => {
  it('is the context for the Gauge, and a dash before anything is reported', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    expect(spineFigure('gauge', gauge(), NOW)).toBe('62%')
    expect(spineFigure('gauge', null, NOW)).toBe('—')
  })

  it('is done of total for the Plan', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    const plan = { rows: [{ id: 'main', title: 'Main', done: 3, total: 8, current: 'Writing', finished: false, inAgent: false }], steps: [] }
    expect(spineFigure('plan', plan, NOW)).toBe('3/8')
    expect(spineFigure('plan', { rows: [] }, NOW)).toBe('—')
  })

  it('is the running count for Agents while one runs, and the done count after', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    const agent = (status) => ({ id: status, status, startedAt: NOW - 1000, lastSeen: NOW - 1000, endedAt: null })
    expect(spineFigure('agents', { running: 2, done: 1, failed: 0, quietForMs: 600_000, agents: [agent('running'), agent('running'), agent('done')] }, NOW)).toBe('2▶')
    expect(spineFigure('agents', { running: 0, done: 3, failed: 0, agents: [agent('done')] }, NOW)).toBe('3✓')
  })

  it('is the number at work for Loops, and the number of entries for Events', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    expect(spineFigure('loops', null, NOW)).toBe('0')
    expect(spineFigure('events', [{ id: 1 }, { id: 2 }], NOW)).toBe('2')
    expect(spineFigure('events', [], NOW)).toBe('—')
  })

  it('is a percentage when done of total would not fit, never a cut figure', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    const plan = (done, total) => ({ rows: [{ id: 'main', title: 'Main', done, total, current: null, finished: false, inAgent: false }], steps: [] })
    expect(spineFigure('plan', plan(9, 12), NOW)).toBe('9/12')
    expect(spineFigure('plan', plan(12, 40), NOW)).toBe('30%')
    expect(spineFigure('plan', plan(10, 100), NOW)).toBe('10%')
    expect(spineFigure('plan', plan(99, 100), NOW)).toBe('99%')
    expect(spineFigure('plan', plan(999, 1000), NOW)).toBe('99%')
    expect(spineFigure('plan', plan(100, 100), NOW)).toBe('100%')
  })

  it('caps a count it cannot show at 999+, rather than cutting its digits', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    const many = Array.from({ length: 1234 }, (_, id) => ({ id }))
    expect(spineFigure('events', many, NOW)).toBe('999+')
    const strays = Array.from({ length: 12345 }, (_, id) => ({ id: `s${id}`, firstSeen: NOW - 60_000, lastSeen: NOW }))
    expect(spineFigure('loops', { compactions: [], strays, liveForMs: 60_000, graceMs: 0 }, NOW)).toBe('999+')
    expect(spineFigure('loops', { compactions: [], strays: strays.slice(0, 12), liveForMs: 60_000, graceMs: 0 }, NOW)).toBe('12')
    expect(spineFigure('agents', { running: 150, done: 0, failed: 0, agents: [] }, NOW)).toBe('99+▶')
  })

  it('is never longer than four characters', async () => {
    const { spineFigure } = await import('../src/core/deck-chips.js')
    const many = Array.from({ length: 200 }, (_, id) => ({ id }))
    expect(spineFigure('events', many, NOW).length).toBeLessThanOrEqual(4)
    expect(spineFigure('gauge', gauge({ context: { percent: 99.6, compactions: [] } }), NOW).length).toBeLessThanOrEqual(4)
  })
})
