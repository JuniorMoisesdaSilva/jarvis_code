import { describe, expect, it } from 'vitest'
import { BLOCKS, lineFor, sentenceCase, typeCase } from '../src/core/deck-chips.js'
import { initialDeck, reduce, view } from '../src/core/deck.js'
import { agentEvent } from '../src/core/hook-payload.js'
import { fixture } from './helpers.js'

// The Deck drawn as lines: every block that is on is one dense line — its
// abbreviation and its key figures — opened with a click. In a Band the same
// figures make its chip. What a line says is worked out here, without a window.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'
const NOW = 1_760_000_000_000

function hook(name, changes = {}) {
  return agentEvent({ ...JSON.parse(fixture(name)), session_id: SESSION, ...changes })
}

/** The parts of a line that draw something other than words. */
const drawn = (line) => line.parts.filter((part) => part.text === undefined)

describe('sentence case', () => {
  it('capitalises the first letter and leaves the rest as written', () => {
    expect(sentenceCase('advisor')).toBe('Advisor')
    expect(sentenceCase('general-purpose')).toBe('General-purpose')
    expect(sentenceCase('Software-Architect')).toBe('Software-Architect')
    expect(sentenceCase('read the MAP.md')).toBe('Read the MAP.md')
  })

  it('never lowers a letter of what Claude Code wrote', () => {
    expect(sentenceCase('MCP API')).toBe('MCP API')
    expect(sentenceCase('ADR 0034')).toBe('ADR 0034')
    expect(sentenceCase('npm test')).toBe('Npm test')
    expect(sentenceCase('ADVISOR')).toBe('ADVISOR')
  })

  it('brings a type name sent all in capitals down, and only a type name', () => {
    // Agent types, and compaction triggers, are identifiers, not
    // words anybody wrote: one sent in capitals is a name, not an acronym.
    expect(typeCase('ADVISOR')).toBe('Advisor')
    expect(typeCase('EXPLORE')).toBe('Explore')
    expect(typeCase('general-purpose')).toBe('General-purpose')
    expect(typeCase('Software-Architect')).toBe('Software-Architect')
    expect(typeCase('auto')).toBe('Auto')
    expect(typeCase(null)).toBe(null)
  })

  it('leaves what does not begin with a letter, and nothing, alone', () => {
    expect(sentenceCase('3 in all')).toBe('3 in all')
    expect(sentenceCase('')).toBe('')
    expect(sentenceCase(null)).toBe(null)
  })
})

describe('a line for every block', () => {
  it('says something, in sentence case, for each of the six before anything has happened', () => {
    const empty = view(initialDeck(SESSION))
    for (const block of BLOCKS) {
      const line = lineFor(block.id, empty[block.id], NOW)
      expect(line.abbreviation).toBe(block.abbreviation)
      expect(line.parts.length).toBeGreaterThan(0)
      expect(line.text.startsWith(`${block.abbreviation} `)).toBe(true)
      const words = line.text.slice(block.abbreviation.length + 1)
      expect(words[0]).toBe(words[0].toUpperCase())
      expect(line.attention).toBeNull()
      expect(line.live).toBe(false)
    }
  })

  it('knows no block it was not told of', () => {
    expect(lineFor('weather', {}, NOW)).toBeNull()
  })
})

describe('the Plan line', () => {
  const row = (over = {}) => ({
    id: 'main',
    title: 'Main',
    done: 3,
    total: 5,
    current: 'Writing the reducer',
    finished: false,
    inAgent: false,
    ...over,
  })
  const steps = ['completed', 'completed', 'completed', 'in_progress', 'pending'].map((status, n) => ({
    label: `Step ${n + 1}`,
    status,
  }))

  it('draws the main plan as one segment per step, with done of total and the step under way', () => {
    const line = lineFor('plan', { rows: [row()], steps }, NOW)
    expect(line.text).toBe('PLN 3/5 Writing the reducer')
    expect(drawn(line)).toEqual([{ steps: ['completed', 'completed', 'completed', 'in_progress', 'pending'] }])
    expect(line.attention).toBeNull()
  })

  it('says the step as Claude Code wrote it, but for a capital first letter', () => {
    const line = lineFor('plan', { rows: [row({ current: 'register the MCP API' })], steps }, NOW)
    expect(line.text).toBe('PLN 3/5 Register the MCP API')
    expect(line.parts.find((part) => part.text === 'Register the MCP API').written).toBe(true)
    expect(lineFor('plan', { rows: [row({ current: 'ADR 0034' })], steps }, NOW).text).toBe('PLN 3/5 ADR 0034')
  })

  it('counts the other plans after it', () => {
    const agent = row({ id: 'a1', title: 'Find the installer', done: 1, total: 2, current: null, inAgent: true })
    expect(lineFor('plan', { rows: [row(), agent], steps }, NOW).text).toBe('PLN 3/5 Writing the reducer +1')
  })

  it('draws a plain bar for a long plan, or for a subagent’s alone', () => {
    const many = [...Array(30)].map((_, n) => ({ label: `Step ${n}`, status: n < 15 ? 'completed' : 'pending' }))
    expect(drawn(lineFor('plan', { rows: [row({ done: 15, total: 30 })], steps: many }, NOW))).toEqual([{ bar: 50 }])
    const alone = row({ id: 'a1', title: 'Find', done: 1, total: 4, inAgent: true })
    expect(drawn(lineFor('plan', { rows: [alone], steps: [] }, NOW))).toEqual([{ bar: 25 }])
  })

  it('says Done when it is, Waiting between steps, and the step in sentence case', () => {
    expect(lineFor('plan', { rows: [row({ done: 5, current: null, finished: true })], steps }, NOW).text).toBe('PLN 5/5 Done')
    expect(lineFor('plan', { rows: [row({ current: null })], steps }, NOW).text).toBe('PLN 3/5 Waiting')
    expect(lineFor('plan', { rows: [row({ current: 'tracing hook writes' })], steps }, NOW).text).toBe(
      'PLN 3/5 Tracing hook writes',
    )
  })

  it('says so before any plan', () => {
    expect(lineFor('plan', { rows: [], steps: [] }, NOW).text).toBe('PLN No plan yet')
  })
})

describe('the Gauge line', () => {
  const gauge = (over = {}) => ({
    reported: true,
    context: { percent: 62, compactions: [] },
    limits: { fiveHour: { percent: 40, resetsAt: NOW }, sevenDay: { percent: 12, resetsAt: NOW } },
    model: 'Opus',
    effort: 'high',
    permissionMode: 'default',
    ...over,
  })

  it('draws the context as a tiny bar, then its figures and both windows, and no cost', () => {
    const line = lineFor('gauge', gauge({ costUsd: 1.84 }), NOW)
    expect(line.text).toBe('CTX 62% 5H 40% 7D 12%')
    expect(drawn(line)).toEqual([{ bar: 62 }])
  })

  it('leaves out what is not reported, and says so when nothing is', () => {
    expect(lineFor('gauge', gauge({ limits: { fiveHour: null, sevenDay: null } }), NOW).text).toBe('CTX 62%')
    expect(lineFor('gauge', { ...gauge(), reported: false }, NOW).text).toBe('CTX No figures yet')
  })

  it('asks to be looked at above 80% of the context, as its chip does', () => {
    expect(lineFor('gauge', gauge({ context: { percent: 86, compactions: [] } }), NOW).attention).toBe('warning')
  })
})

describe('the Agents line', () => {
  const agent = (status, over = {}) => ({ id: status, type: 'Explore', task: null, steps: 3, startedAt: NOW - 60_000, lastSeen: NOW, endedAt: null, status, tokens: null, outOfOutput: null, ...over })

  it('shows the running, the done, the failed and the tokens', () => {
    const line = lineFor(
      'agents',
      {
        running: 1,
        done: 1,
        failed: 1,
        quietForMs: 3_600_000,
        agents: [
          agent('running'),
          agent('done', { tokens: { total: 48_200 } }),
          agent('failed', { tokens: { total: 92_000 }, outOfOutput: true }),
        ],
      },
      NOW,
    )
    expect(line.text).toBe('AGT 1▶ 1✓ 1✗ 140k tok')
    expect(drawn(line)).toEqual([{ glyph: 'flag', tone: 'alarm' }])
    expect(line.attention).toBe('alarm')
  })
})

describe('the Loops line', () => {
  it('shows a compaction at work, with its clock, and the strays at work', () => {
    const line = lineFor(
      'loops',
      {
        liveForMs: 30_000,
        graceMs: 3_000,
        compactionLimitMs: 600_000,
        compactions: [{ trigger: 'auto', running: true, startedAt: NOW - 21_000, endedAt: null }],
        strays: [{ id: 'a3f9c2e1', short: 'a3f9c2e', steps: 4, firstSeen: NOW - 60_000, lastSeen: NOW - 1_000 }],
      },
      NOW,
    )
    expect(line.text).toBe('LPS ▶ 0:21 Compacting 1 stray')
    expect(line.live).toBe(true)
  })

  it('says nothing is loose when nothing is', () => {
    const quiet = { liveForMs: 30_000, graceMs: 3_000, compactionLimitMs: 600_000, compactions: [], strays: [] }
    expect(lineFor('loops', quiet, NOW).text).toBe('LPS Nothing loose')
  })
})

describe('the Events line', () => {
  const at = NOW
  const time = (() => {
    const when = new Date(at)
    return [when.getHours(), when.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
  })()

  it('shows the latest entry with its time, an edited file by its name alone', () => {
    const entries = [{ id: 2, at, kind: 'edit', label: 'Edit', detail: 'C:\\Jarvis\\.source\\src\\renderer\\panel.js', note: null, inAgent: false }]
    expect(lineFor('events', entries, NOW).text).toBe(`EVT ${time} Edit panel.js`)
  })

  it('writes a subagent’s type in sentence case, and keeps a tool’s name and a detail as written', () => {
    const spawn = [{ id: 1, at, kind: 'spawn', label: 'general-purpose', detail: 'find the hooks', note: null, inAgent: false }]
    expect(lineFor('events', spawn, NOW).text).toBe(`EVT ${time} General-purpose find the hooks`)
    const tool = [{ id: 1, at, kind: 'denied', label: 'mcp__x__y', detail: 'rm -rf /', note: null, inAgent: false }]
    const line = lineFor('events', tool, NOW)
    expect(line.text).toBe(`EVT ${time} mcp__x__y rm -rf /`)
    expect(line.parts.filter((part) => part.verbatim).map((part) => part.text)).toEqual(['mcp__x__y', 'rm -rf /'])
  })

  it('says so when nothing has happened', () => {
    expect(lineFor('events', [], NOW).text).toBe('EVT Nothing yet')
  })
})
