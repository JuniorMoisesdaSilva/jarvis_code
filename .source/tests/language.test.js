import { describe, expect, it } from 'vitest'
import {
  PORTUGUESE,
  ENGLISH,
  ALL,
  claudeName,
  next,
  shortLabel,
} from '../src/core/language.js'

// One switch decides three things: the engine that hears, the voice that reads,
// and — since 18 September 2026 — the language Claude Code answers in. The first
// two were always the switch's; this file pins down the third, because it is the
// one that leaves the app and lands in somebody's Claude Code settings.

describe('the language Claude Code is told to answer in', () => {
  it('is Portuguese on PT and English on EN', () => {
    expect(claudeName(PORTUGUESE)).toBe('portuguese')
    expect(claudeName(ENGLISH)).toBe('english')
  })

  it('is a name for every language the panel can show', () => {
    for (const language of ALL) {
      expect(claudeName(language), `${shortLabel(language)} has no name`).toMatch(/^[a-z]+$/)
    }
  })

  it('follows the switch both ways, so neither setting can stick', () => {
    expect(claudeName(next(PORTUGUESE))).toBe('english')
    expect(claudeName(next(next(PORTUGUESE)))).toBe('portuguese')
  })
})
