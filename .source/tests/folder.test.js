import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { locate, findFolderRoot, MARKER, DATA, RESOURCES, BRAIN } from '../src/core/folder.js'

// Jarvis is one folder with compartments, and the app runs inside one of them.
// Finding the way back up to the root is what lets both platforms read the same
// voices and the same listening model. Getting it wrong is silent: the app finds
// no voices and falls back to the system's, or writes its preferences somewhere
// that does not travel with the folder.

// The folders below are built with `path.join` rather than written out, because
// this suite runs on both platforms and a path spelled with forward slashes is
// not the path `path.join` returns on Windows. Written out, three of these tests
// compared a Mac's answer against a Windows one and failed for that alone.
const HOME = path.join(path.sep, 'Users', 'me')

// A filesystem probe standing in for the disk: every path in `present` exists.
// Case-folded, because the machines this runs on are case-insensitive.
function prober(present) {
  const set = new Set(present.map((each) => each.toLowerCase()))
  return (candidate) => set.has(String(candidate).toLowerCase())
}

describe('finding the folder root', () => {
  it('returns the folder that holds the marker', () => {
    const root = path.join(HOME, 'Jarvis')
    const app = path.join(root, '.source')
    expect(findFolderRoot(app, prober([path.join(root, MARKER)]))).toBe(root)
  })

  it('finds it from deep inside a packaged app', () => {
    const root = path.join(HOME, 'Jarvis')
    const app = path.join(root, 'macOS', 'Jarvis.app', 'Contents', 'Resources', 'app')
    expect(findFolderRoot(app, prober([path.join(root, MARKER)]))).toBe(root)
  })

  it('returns null when no ancestor holds the marker', () => {
    expect(findFolderRoot('/Applications/Jarvis.app/Contents/Resources/app', prober([]))).toBe(null)
  })

  it('stops at the filesystem root rather than looping forever', () => {
    expect(findFolderRoot('/', prober([]))).toBe(null)
  })
})

describe('locating the compartments', () => {
  const root = path.join(HOME, 'Jarvis')
  const userData = path.join(HOME, 'Library', 'Application Support', 'jarvis')
  const inside = (appRoot, env = {}) =>
    locate({ appRoot, userData, env, exists: prober([path.join(root, MARKER)]) })

  it('reads the shared voices and listening model from Resources at the root', () => {
    const where = inside(path.join(root, '.source'))
    expect(where.inFolder).toBe(true)
    expect(where.root).toBe(root)
    expect(where.resourcesDir).toBe(path.join(root, RESOURCES))
    expect(where.voicesDir).toBe(path.join(root, RESOURCES, 'voices'))
    expect(where.listeningModelDir).toBe(path.join(root, RESOURCES, 'models'))
  })

  it('gives the assembled app the same Resources as the one run from source', () => {
    const fromSource = inside(path.join(root, '.source'))
    const assembled = inside(path.join(root, 'macOS', 'Jarvis.app', 'Contents', 'Resources', 'app'))
    expect(assembled.resourcesDir).toBe(fromSource.resourcesDir)
    expect(assembled.dataDir).toBe(fromSource.dataDir)
  })

  it('writes what it produces into the hidden data compartment', () => {
    const where = inside(path.join(root, '.source'))
    expect(where.dataDir).toBe(path.join(root, DATA))
    expect(where.preferencesFile).toBe(path.join(root, DATA, 'preferences.json'))
    expect(where.modelsDir).toBe(path.join(root, DATA, 'models'))
  })

  it('names no place for a project record: it stays in the project', () => {
    expect(inside(path.join(root, '.source'))).not.toHaveProperty('historyDir')
  })

  it('reads the behaviour it carries from Brain at the root', () => {
    // One copy, where a person can read and edit it. A second inside the app
    // would be the one that travels, and it would fall behind the first.
    expect(inside(path.join(root, '.source')).brainDir).toBe(path.join(root, BRAIN))
    expect(inside(path.join(root, 'macOS', 'Jarvis.app', 'Contents', 'Resources', 'app')).brainDir)
      .toBe(path.join(root, BRAIN))
  })

  it('lets an explicit data-dir move what it writes without moving what it reads', () => {
    const override = '/Volumes/carry/jarvis-data'
    const where = inside(path.join(root, '.source'), { JARVIS_DATA_DIR: override })
    expect(where.dataDir).toBe(override)
    expect(where.preferencesFile).toBe(path.join(override, 'preferences.json'))
    expect(where.resourcesDir).toBe(path.join(root, RESOURCES))
  })

  it('ignores an override that is only whitespace', () => {
    const where = inside(path.join(root, '.source'), { JARVIS_DATA_DIR: '   ' })
    expect(where.dataDir).toBe(path.join(root, DATA))
  })
})

describe('running from outside the folder', () => {
  const userData = '/Users/me/Library/Application Support/jarvis'
  const appRoot = '/Applications/Jarvis.app/Contents/Resources/app'
  const outside = locate({ appRoot, userData, env: {}, exists: prober([]) })

  it('falls back to the system user-data folder for what it writes', () => {
    expect(outside.inFolder).toBe(false)
    expect(outside.preferencesFile).toBe(path.join(userData, 'preferences.json'))
    expect(outside.modelsDir).toBe(path.join(userData, 'models'))
  })

  it("falls back to the app's own assets for what it reads", () => {
    expect(outside.resourcesDir).toBe(path.join(appRoot, 'assets'))
    expect(outside.voicesDir).toBe(path.join(appRoot, 'assets', 'voices'))
  })
})

describe('a Windows folder', () => {
  it('is located exactly the same way', () => {
    const root = 'D:\\Jarvis'
    const app = path.win32.join(root, 'Windows', 'runtime', 'resources', 'app')
    // path.dirname walks Windows paths on a POSIX host only for the separator it
    // knows, so the walk itself is checked with the platform's own separator.
    expect(findFolderRoot(app.split('\\').join(path.sep), prober([
      path.join(root.split('\\').join(path.sep), MARKER),
    ]))).toBe(root.split('\\').join(path.sep))
  })
})
