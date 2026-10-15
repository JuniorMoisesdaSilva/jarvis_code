'use strict'

// Electron's own binary, in the `Windows/` compartment.
//
// The runtime `npm start` opens the app with is not the one npm unpacks into
// `node_modules/electron/dist`. It is fetched into `Windows/electron` — a
// compartment already outside Git, and one `npm install` never touches — so
// reinstalling the dependencies, or a sync client half-way through rewriting
// `node_modules`, cannot leave the app with no runtime to start on.
//
// The version is read from the lockfile rather than written here, so upgrading
// Electron stays a matter of changing one dependency.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { unpack } = require('./unpack')
const { findFolderRoot } = require('../src/core/folder')

const ROOT = path.join(__dirname, '..')
const LOCK = path.join(ROOT, 'package-lock.json')

/** The compartment the runtime belongs in. */
const COMPARTMENT = 'Windows'

/** Somewhere to land the archive that is not the folder being filled. */
const STAGING = path.join(os.tmpdir(), 'jarvis-platform-runtime')

/** The executable at the top of the unpacked release. */
const EXECUTABLE = 'electron.exe'

function folderRoot() {
  const root = findFolderRoot(ROOT, (candidate) => fs.existsSync(candidate))
  if (!root) {
    throw new Error('This is not inside a Jarvis folder — no .jarvis-root above it.')
  }
  return root
}

/** The version the lockfile resolved, which is the one the app was tested with. */
function wantedVersion() {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  const entry = lock.packages?.['node_modules/electron']
  if (!entry?.version) throw new Error('the lockfile names no electron version')
  return entry.version
}

/** The compartment's runtime folder, whether or not anything is in it yet. */
function runtimeDir() {
  return path.join(folderRoot(), COMPARTMENT, 'electron')
}

/** The binary `npm start` runs, whether or not it is there yet. */
function runtimeExecutable() {
  return path.join(runtimeDir(), EXECUTABLE)
}

/**
 * Whether what is on disk is the release we want. Every Electron release drops
 * a `version` file beside the binary, so the answer is read rather than assumed
 * — an upgrade that left the old binary in place would otherwise never be
 * noticed.
 */
function present(version) {
  try {
    if (!fs.existsSync(runtimeExecutable())) return false
    return fs.readFileSync(path.join(runtimeDir(), 'version'), 'utf8').trim() === version
  } catch {
    return false
  }
}

function releaseUrl(version) {
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`
  return `https://github.com/electron/electron/releases/download/v${version}/${name}`
}

async function fetchRuntime(version) {
  const url = releaseUrl(version)
  console.log(`Fetching Electron ${version} for ${process.platform}-${process.arch}…`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())

  fs.mkdirSync(STAGING, { recursive: true })
  const archive = path.join(STAGING, `electron-${version}.zip`)
  fs.writeFileSync(archive, bytes)

  // A half-unpacked runtime would be taken for installed on the next run.
  fs.rmSync(runtimeDir(), { recursive: true, force: true })
  unpack(archive, runtimeDir())
  fs.rmSync(STAGING, { recursive: true, force: true })

  console.log(`  ${(bytes.length / 1024 / 1024).toFixed(0)} MB into ${COMPARTMENT}/electron`)
}

/**
 * The binary for this machine, fetched first if it is not there. Called by
 * `npm start` as well as from the command line, so starting the app on a
 * machine that has never run it is one step rather than two.
 */
async function ensureRuntime() {
  const version = wantedVersion()
  if (!present(version)) await fetchRuntime(version)
  return runtimeExecutable()
}

module.exports = { ensureRuntime, runtimeExecutable, runtimeDir, COMPARTMENT }

if (require.main === module) {
  ensureRuntime()
    .then((where) => console.log(`Ready: ${where}`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
