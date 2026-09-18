'use strict'

// Electron's own binary, one per platform, in that platform's compartment.
//
// `node_modules` is one tree seen by two machines (scripts/native-binaries.js
// says why, and puts back the compiled packages npm leaves out). That trick
// works because every compiled package publishes one folder per platform and
// the loaders pick their own. Electron does not: it unpacks into a single
// `node_modules/electron/dist`, so the tree carries whichever machine installed
// last, and on the other machine `npm start` finds a Mac binary on Windows, or
// the reverse, and cannot start the app at all.
//
// So the runtime is not kept in the tree. It is fetched into `Windows/` or
// `macOS/` — the compartment that already belongs to one platform and is
// already outside Git — and `npm start` runs the one for the machine it is on.
// Both can sit in the folder at once without touching each other, which is the
// whole point: the folder is synchronised, and a shared path is what fights.
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

/** The compartment this platform's pieces belong in, and what it is called there. */
const COMPARTMENT = process.platform === 'win32' ? 'Windows' : 'macOS'

/** Somewhere to land the archive that is not the folder being filled. */
const STAGING = path.join(os.tmpdir(), 'jarvis-platform-runtime')

/**
 * Where inside the unpacked release the thing that actually starts lives. On
 * Windows it is the executable itself; on a Mac the release is an app bundle
 * and the binary sits four levels inside it.
 */
const EXECUTABLE =
  process.platform === 'win32'
    ? 'electron.exe'
    : path.join('Electron.app', 'Contents', 'MacOS', 'Electron')

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
