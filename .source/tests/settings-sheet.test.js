import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { electronBinary } from './helpers/electron-path.js'
import { describe, expect, it } from 'vitest'

// The second test in the suite that starts a real process, and like the first it
// earns its keep by catching something no unit test can see.
//
// A preload runs sandboxed: `require` there reaches Electron's own modules and
// nothing else. A relative import — the core, say — throws, and everything
// after it is skipped, so the bridge the page talks to is never built. Nothing
// errors where a test was looking. What the user gets is a Settings sheet in the
// wrong theme, with no voices, no shell, and no button that does anything.
//
// So this opens the real sheet in a real window and asks it what it looks like.

const harness = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'sheet-harness.js',
)

/** The sheet, opened for real, reporting on itself. */
const sheet = JSON.parse(
  execFileSync(electronBinary(), [harness], { encoding: 'utf8', timeout: 60_000 })
    .trim()
    .split('\n')
    .pop(),
)

describe('the Settings sheet, opened for real', () => {
  it('builds the bridge its preload is there to build', () => {
    expect(sheet.problems).toEqual([])
    expect(sheet.bridge).toBe('object')
  })

  it('comes up in the theme that was stored, not the one it falls back to', () => {
    // 'dark' is the fallback. Seeing it here means the sheet never read the
    // preferences at all — which is what a dead bridge looks like from outside.
    expect(sheet.theme).toBe('iron')
  })

  it('fills itself in from the stored settings', () => {
    expect(sheet.shell).toBe('/bin/zsh')
    expect(sheet.voiceOptions).toBeGreaterThan(0)
    expect(sheet.modelOptions).toBeGreaterThan(0)
  })

  it('says a model that is already here is here, not a download', () => {
    // The accurate model travels in Resources now. Describing it as "940 MB to
    // download" is how a user comes to press the microphone and watch a
    // gigabyte arrive that was on the disk the whole time.
    expect(sheet.modelNote).toContain('already here')
    expect(sheet.modelNote).not.toContain('to download')
  })

  it('names the place this machine actually keeps its settings', () => {
    const expected = process.platform === 'darwin' ? 'System Settings' : 'Windows settings'
    expect(sheet.micLink).toContain(expected)
  })

  it('says the voices need no setting up, and offers no switch for others', () => {
    // Jarvis reads with the voices it carries and nothing else. There is no
    // second set to choose between, so there is no control for one, and nothing
    // sends the user off to install a voice the app would not use.
    expect(sheet.voiceNote).toContain('need no setting up')
    expect(sheet.voiceNote).not.toMatch(/Windows|macOS/)
  })
})
