import { describe, expect, it } from 'vitest'
import { onDisk, isPackaged } from '../src/main/unpacked.js'

// PowerShell and worker threads are handed a path and open it themselves.
// Neither knows what Electron's archive is, so both fail only in a packaged
// build, at the moment the feature is first used.

const SEP = '\\'
const p = (...parts) => parts.join(SEP)

describe('finding a file on the real disk', () => {
  it('redirects a path inside the archive', () => {
    const inside = p('C:', 'Apps', 'Jarvis', 'resources', 'app.asar', 'src', 'main', 'speech.js')
    const outside = p(
      'C:',
      'Apps',
      'Jarvis',
      'resources',
      'app.asar.unpacked',
      'src',
      'main',
      'speech.js',
    )
    expect(onDisk(inside)).toBe(outside)
  })

  it('handles forward slashes too', () => {
    expect(onDisk('/Apps/Jarvis/resources/app.asar/src/main/whisper-worker.js')).toBe(
      '/Apps/Jarvis/resources/app.asar.unpacked/src/main/whisper-worker.js',
    )
  })

  it('redirects the archive itself, with nothing after it', () => {
    // What `app.getAppPath()` hands back. The models are looked for underneath
    // it, so getting this wrong loses all of them at once.
    expect(onDisk(p('C:', 'Apps', 'Jarvis', 'resources', 'app.asar'))).toBe(
      p('C:', 'Apps', 'Jarvis', 'resources', 'app.asar.unpacked'),
    )
    expect(onDisk('/Apps/Jarvis/resources/app.asar')).toBe(
      '/Apps/Jarvis/resources/app.asar.unpacked',
    )
  })

  it('leaves a development path alone', () => {
    const here = p('C:', 'Users', 'me', 'Jarvis', 'src', 'main', 'whisper-worker.js')
    expect(onDisk(here)).toBe(here)
  })

  it('does not touch a path already pointing outside the archive', () => {
    const already = p('C:', 'Apps', 'resources', 'app.asar.unpacked', 'src', 'main', 'x.js')
    expect(onDisk(already)).toBe(already)
  })

  it('does not rewrite a file whose name merely contains the archive name', () => {
    const named = p('C:', 'Apps', 'my-app.asar-notes.txt')
    expect(onDisk(named)).toBe(named)
  })

  it('recognises when it is running from a package', () => {
    expect(isPackaged(p('C:', 'Apps', 'Jarvis', 'resources', 'app.asar', 'src', 'main', 'a.js'))).toBe(
      true,
    )
    expect(isPackaged(p('C:', 'Apps', 'Jarvis', 'resources', 'app.asar'))).toBe(true)
    expect(isPackaged(p('C:', 'Users', 'me', 'Jarvis', 'src', 'main', 'a.js'))).toBe(false)
  })
})
