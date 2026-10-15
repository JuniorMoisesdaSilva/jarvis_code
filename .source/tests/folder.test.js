import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { locate, findFolderRoot, MARKER, DATA, RESOURCES, BRAIN } from '../src/core/folder.js'

// Jarvis is one folder with compartments, and the app runs inside one of them.
// Finding the way back up to the root is what lets the app run from source and
// the assembled one read the same voices and the same listening model. Getting
// it wrong is silent: the app finds no voices, or writes its preferences
// somewhere that does not travel with the folder.

const HOME = path.join('C:\\', 'Users', 'me')

// A filesystem probe standing in for the disk: every path in `present` exists.
// Case-folded, because Windows is case-insensitive.
function prober(present) {
  const set = new Set(present.map((each) => each.toLowerCase()))
  return (candidate) => set.has(String(candidate).toLowerCase())
}

/** Where an assembled app's code sits, inside the `Windows/` compartment. */
function assembledIn(root) {
  return path.join(root, 'Windows', 'resources', 'app.asar')
}

describe('finding the folder root', () => {
  it('returns the folder that holds the marker', () => {
    const root = path.join(HOME, 'Jarvis')
    const app = path.join(root, '.source')
    expect(findFolderRoot(app, prober([path.join(root, MARKER)]))).toBe(root)
  })

  it('finds it from deep inside an assembled app', () => {
    const root = path.join('D:\\', 'Jarvis')
    expect(findFolderRoot(assembledIn(root), prober([path.join(root, MARKER)]))).toBe(root)
  })

  it('returns null when no ancestor holds the marker', () => {
    const app = path.join('C:\\', 'Program Files', 'Jarvis', 'resources', 'app.asar')
    expect(findFolderRoot(app, prober([]))).toBe(null)
  })

  it('stops at the drive root rather than looping forever', () => {
    expect(findFolderRoot('C:\\', prober([]))).toBe(null)
  })
})

describe('locating the compartments', () => {
  const root = path.join(HOME, 'Jarvis')
  const userData = path.join(HOME, 'AppData', 'Roaming', 'jarvis')
  const inside = (appRoot, env = {}) =>
    locate({ appRoot, userData, env, exists: prober([path.join(root, MARKER)]) })

  it('reads the voices and listening model from Resources at the root', () => {
    const where = inside(path.join(root, '.source'))
    expect(where.inFolder).toBe(true)
    expect(where.root).toBe(root)
    expect(where.resourcesDir).toBe(path.join(root, RESOURCES))
    expect(where.voicesDir).toBe(path.join(root, RESOURCES, 'voices'))
    expect(where.listeningModelDir).toBe(path.join(root, RESOURCES, 'models'))
  })

  it('gives the assembled app the same Resources as the one run from source', () => {
    const fromSource = inside(path.join(root, '.source'))
    const assembled = inside(assembledIn(root))
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
    expect(inside(assembledIn(root)).brainDir).toBe(path.join(root, BRAIN))
  })

  it('lets an explicit data-dir move what it writes without moving what it reads', () => {
    const override = path.join('E:\\', 'carry', 'jarvis-data')
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
  const userData = path.join(HOME, 'AppData', 'Roaming', 'jarvis')
  const appRoot = path.join('C:\\', 'Program Files', 'Jarvis', 'resources', 'app.asar')
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
