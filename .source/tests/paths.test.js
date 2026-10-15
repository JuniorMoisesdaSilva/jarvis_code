import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalize, samePath, within } from '../src/core/paths.js'

// Both systems hand the same folder back written differently depending on who
// was asked. Getting the comparison wrong makes Jarvis ignore every event from
// the project the user actually has open, with nothing on screen to explain why
// — and getting the tidying wrong hands the rest of the app a path it cannot
// open.

describe('deciding two paths are the same place', () => {
  it('accepts the same path written identically', () => {
    expect(samePath('C:\\Projects\\alpha', 'C:\\Projects\\alpha')).toBe(true)
  })

  it('ignores the case of the drive letter and the folders', () => {
    expect(samePath('c:\\projects\\ALPHA', 'C:\\Projects\\alpha')).toBe(true)
  })

  it('ignores which slash was used', () => {
    expect(samePath('C:/Projects/alpha', 'C:\\Projects\\alpha')).toBe(true)
  })

  it('ignores a trailing slash', () => {
    expect(samePath('C:\\Projects\\alpha\\', 'C:\\Projects\\alpha')).toBe(true)
  })

  it('ignores a doubled separator in the middle', () => {
    expect(samePath('C:\\Projects\\\\alpha', 'C:\\Projects\\alpha')).toBe(true)
  })

  it('still tells different folders apart', () => {
    expect(samePath('C:\\Projects\\alpha', 'C:\\Projects\\beta')).toBe(false)
  })

  it('does not treat a parent folder as the same place', () => {
    expect(samePath('C:\\Projects', 'C:\\Projects\\alpha')).toBe(false)
  })

  it('refuses a missing or empty path rather than matching everything', () => {
    expect(samePath(null, 'C:\\Projects\\alpha')).toBe(false)
    expect(samePath(undefined, 'C:\\Projects\\alpha')).toBe(false)
    expect(samePath('', 'C:\\Projects\\alpha')).toBe(false)
    expect(samePath('C:\\Projects\\alpha', null)).toBe(false)
  })
})

describe('deciding two Unix paths are the same place', () => {
  it('accepts the same path written identically', () => {
    expect(samePath('/Users/me/projects/alpha', '/Users/me/projects/alpha')).toBe(true)
  })

  it('ignores the case of the folders', () => {
    expect(samePath('/Users/me/Projects/ALPHA', '/users/me/projects/alpha')).toBe(true)
  })

  it('ignores a trailing slash', () => {
    expect(samePath('/Users/me/projects/alpha/', '/Users/me/projects/alpha')).toBe(true)
  })

  it('still tells different folders apart', () => {
    expect(samePath('/Users/me/projects/alpha', '/Users/me/projects/beta')).toBe(false)
  })
})

describe('deciding a folder is inside the project', () => {
  // Claude Code reports the folder its shell has moved to, not the one it was
  // opened in.
  it('accepts the project itself, however it is written', () => {
    expect(within('/Users/me/Projects/ALPHA/', '/users/me/projects/alpha')).toBe(true)
  })

  it('accepts a folder inside it', () => {
    expect(within(path.join(path.sep, 'p', 'alpha', 'receipts'), path.join(path.sep, 'p', 'alpha'))).toBe(true)
  })

  it('does not accept a sibling that only begins with the same name', () => {
    expect(within('/p/alpha-old', '/p/alpha')).toBe(false)
  })

  it('does not accept the folder above it', () => {
    expect(within('/p', '/p/alpha')).toBe(false)
  })

  it('refuses a missing path rather than matching everything', () => {
    expect(within(null, '/p/alpha')).toBe(false)
    expect(within('/p/alpha', '')).toBe(false)
  })
})

describe('tidying a path the app then goes on to use', () => {
  // The tidied path is not only compared: a terminal is opened there and a
  // Transcript is written into it. Folding its case made every project a
  // lower-case one, on screen and on disk.
  it('keeps the case the user gave it', () => {
    const tidy = normalize(path.join(path.sep, 'Users', 'me', 'Projects', 'Alpha'))
    expect(tidy).toContain('Projects')
    expect(tidy).toContain('Alpha')
  })

  it("speaks this machine's separator", () => {
    expect(normalize('one/two\\three')).toBe(['one', 'two', 'three'].join(path.sep))
  })

  it('collapses a doubled separator and drops a trailing one', () => {
    expect(normalize(`one${path.sep}${path.sep}two${path.sep}`)).toBe(`one${path.sep}two`)
  })

  it('refuses a missing or empty path rather than inventing one', () => {
    expect(normalize(null)).toBe(null)
    expect(normalize('')).toBe(null)
  })
})
