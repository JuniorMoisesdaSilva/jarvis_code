'use strict'

// Where everything Jarvis owns lives, worked out from wherever it is running.
//
// Jarvis is one folder of compartments the user opens and two they never have
// to. The app itself sits in one of them — `.source` while it is being built,
// `Windows/` once assembled — and has to find its way back up to the folder's
// root to reach the ones beside it: `Resources`, which it reads its voices and
// listening model from, and `Brain`, which holds the behaviour it carries into a
// machine's Claude Code.
//
// The decision is pure — a walk up the tree looking for a marker, with the disk
// injected — so it can be tested without one. The adapter supplies the real
// paths and the real probe; see src/main/data-location.js.
//
// A project's conversation record is not one of these. It is written inside the
// project and stays there; see
// Docs/decisions/0023-the-record-lives-only-in-the-project.md.

const path = require('node:path')

/**
 * The marker at the folder's root. Hidden, because the user asked for six
 * compartments and nothing else, and a marker they can see is a seventh thing
 * to explain. Its mere presence is what tells a running Jarvis "this is the
 * top; the compartments are here".
 */
const MARKER = '.jarvis-root'

/** The compartment holding what Jarvis writes: preferences, downloaded models. */
const DATA = '.jarvis-data'

/** The compartment holding the voices and the listening model. */
const RESOURCES = 'Resources'

/**
 * The compartment holding the behaviour Jarvis carries into a machine's Claude
 * Code: the Maestro's instruction, the reply style, and the Maestro's embedded
 * copies of the skills it reads.
 *
 * At the folder's root and not inside the app, so there is one copy of each and
 * a person can read and edit them without going near the code.
 */
const BRAIN = 'Brain'

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Walks up from `start`, inclusive, and returns the first folder carrying the
 * marker — or null if none does before the top.
 *
 * The stop condition is `dirname` no longer changing: at a drive or filesystem
 * root `dirname` returns the root itself, so a plain loop would never end.
 */
function findFolderRoot(start, exists) {
  let directory = start
  while (typeof directory === 'string' && directory !== '') {
    if (exists(path.join(directory, MARKER))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return null
}

/**
 * The shape every caller gets back.
 *
 * `dataDir` and `resourcesDir` are decided separately because they can come
 * apart: an override moves what Jarvis writes without moving what it reads, and
 * a Jarvis running outside its folder has neither compartment and falls back to
 * the ordinary places for both.
 */
function shape({ root, inFolder, dataDir, resourcesDir, brainDir }) {
  return {
    inFolder,
    root,
    dataDir,
    preferencesFile: path.join(dataDir, 'preferences.json'),
    modelsDir: path.join(dataDir, 'models'),
    resourcesDir,
    voicesDir: path.join(resourcesDir, 'voices'),
    listeningModelDir: path.join(resourcesDir, 'models'),
    brainDir,
  }
}

/**
 * Decide where each of Jarvis's folders is.
 *
 * @param appRoot  where the app itself sits (app.getAppPath()).
 * @param userData the ordinary per-user folder (app.getPath('userData')).
 * @param env      the process environment; JARVIS_DATA_DIR forces where Jarvis writes.
 * @param exists   a probe: does this path exist on disk?
 *
 * A Jarvis that cannot find the marker is running from somewhere that is not
 * the folder — a checkout, an unpacked archive — and falls back to what came
 * before it: the system's user-data folder to write in, and the app's own
 * `assets` to read from.
 */
function locate({ appRoot, userData, env = {}, exists }) {
  const root = findFolderRoot(appRoot, exists)
  const override = nonEmpty(env.JARVIS_DATA_DIR)

  if (root) {
    return shape({
      root,
      inFolder: true,
      dataDir: override ?? path.join(root, DATA),
      resourcesDir: path.join(root, RESOURCES),
      brainDir: path.join(root, BRAIN),
    })
  }

  const dataDir = override ?? userData
  return shape({
    root: override ? path.dirname(override) : userData,
    inFolder: Boolean(override),
    dataDir,
    resourcesDir: path.join(appRoot, 'assets'),
    brainDir: path.join(appRoot, BRAIN),
  })
}

module.exports = { locate, findFolderRoot, shape, MARKER, DATA, RESOURCES, BRAIN }
