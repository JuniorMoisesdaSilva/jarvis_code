import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  VOICES,
  PREFIX,
  FOLDER,
  WEIGHTS,
  TOKENS,
  nameOf,
  isOurs,
  find,
  speedFor,
  folderFor,
  pronunciationFolder,
} from '../src/core/natural-voices.js'

// The voices Jarvis ships. The catalogue is read by the script that downloads
// them, the script that packages them and the host that speaks them, so what is
// checked here is mostly that it cannot say two different things to two of them.
// See Docs/decisions/0010-a-neural-voice-of-our-own.md.

describe('the voices Jarvis ships', () => {
  it('offers both languages the app speaks', () => {
    const cultures = new Set(VOICES.map((each) => each.culture))
    expect(cultures.has('pt-BR')).toBe(true)
    expect(cultures.has('en-US')).toBe(true)
  })

  it('reads Portuguese first, because that is the language of the person it is for', () => {
    expect(VOICES[0].culture).toBe('pt-BR')
  })

  it('describes every voice completely', () => {
    for (const voice of VOICES) {
      expect(voice.id, voice.id).toMatch(/^[a-z]{2}_[A-Z]{2}-[a-z]+-(low|medium|high)$/)
      expect(voice.archive, voice.id).toBe(`vits-piper-${voice.id}`)
      expect(voice.label, voice.id).toBeTruthy()
      expect(voice.gender, voice.id).toMatch(/^(Male|Female)$/)
      // The culture is what the Settings sheet filters on, so it has to be the
      // first half of the id and not a second opinion about it.
      expect(voice.id.startsWith(voice.culture.replace('-', '_')), voice.id).toBe(true)
    }
  })

  it('gives every voice a name of its own', () => {
    const names = VOICES.map(nameOf)
    expect(new Set(names).size).toBe(VOICES.length)
  })
})

describe('telling our voices from Windows’', () => {
  it('claims the ones it shipped', () => {
    for (const voice of VOICES) expect(isOurs(nameOf(voice))).toBe(true)
  })

  it('leaves everything else to Windows', () => {
    expect(isOurs('Microsoft Maria Desktop - Portuguese(Brazil)')).toBe(false)
    expect(isOurs('')).toBe(false)
    expect(isOurs(undefined)).toBe(false)
    expect(isOurs(null)).toBe(false)
  })

  it('finds the voice a stored name refers to', () => {
    const voice = VOICES[0]
    expect(find(nameOf(voice))).toBe(voice)
  })

  it('finds nothing for a name that is not one of ours', () => {
    expect(find('Microsoft Daniel - Portuguese(Brazil)')).toBe(null)
    // Ours in shape, but naming a voice that was removed from the catalogue: a
    // preferences file written by an older build must not resolve to the wrong
    // voice, and must not throw either.
    expect(find(`${PREFIX}pt_BR-nobody-medium`)).toBe(null)
  })
})

describe('where the voices are on disk', () => {
  it('puts each one in a folder named after it', () => {
    const voice = VOICES[0]
    expect(folderFor('C:\\app', voice)).toBe(path.join('C:\\app', FOLDER, voice.id))
  })

  it('shares one copy of the pronunciation rules between all of them', () => {
    expect(pronunciationFolder('C:\\app')).toBe(path.join('C:\\app', FOLDER, 'espeak-ng-data'))
  })

  it('names the two files the same way for every voice, so the host need not guess', () => {
    expect(WEIGHTS).toBe('model.onnx')
    expect(TOKENS).toBe('tokens.txt')
  })
})

describe('the reading rate', () => {
  it('leaves the voice alone when nobody asked for faster or slower', () => {
    expect(speedFor(0)).toBe(1)
  })

  it('goes one way for faster and the other for slower', () => {
    expect(speedFor(5)).toBeGreaterThan(1)
    expect(speedFor(-5)).toBeLessThan(1)
  })

  it('never gets so slow or so fast that it stops being speech', () => {
    for (let rate = -20; rate <= 20; rate += 1) {
      expect(speedFor(rate), String(rate)).toBeGreaterThanOrEqual(0.5)
      expect(speedFor(rate), String(rate)).toBeLessThanOrEqual(2)
    }
  })

  it('reads a missing or nonsense rate as normal, rather than as silence', () => {
    expect(speedFor(undefined)).toBe(1)
    expect(speedFor(null)).toBe(1)
    expect(speedFor('quickly')).toBe(1)
  })

  it('stays close to Windows across the range, so changing voice does not change the pace', () => {
    // Windows' own scale is roughly this: the extremes are about half and about
    // double, and the middle is gentle. Held to loosely on purpose — the point
    // is that 3 on one voice is not 8 on another.
    expect(speedFor(10)).toBeGreaterThan(1.9)
    expect(speedFor(-10)).toBeLessThan(0.5001)
    expect(speedFor(3)).toBeGreaterThan(1.2)
    expect(speedFor(3)).toBeLessThan(1.3)
  })
})
