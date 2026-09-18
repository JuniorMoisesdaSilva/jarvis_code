'use strict'

// Puts back the compiled packages npm leaves out when it installs on the other
// platform.
//
// This folder is kept in OneDrive and opened from both a Mac and a Windows
// machine, so `node_modules` is one tree seen by two platforms. npm installs
// only the compiled packages that match the machine it runs on, so whichever
// machine installed last is the only one whose speech engine is there. On the
// other, `require('sherpa-onnx-node')` fails with `Could not find
// sherpa-onnx-node`, the process that speaks dies the moment it is first asked
// to read, and Jarvis falls back to Windows' voices — or, on a machine with none
// installed, to silence. Nothing the user can see says why, which is what makes
// it worth a script.
//
// It adds, and only adds. `npm install` would put this platform's copies in
// place of the other's, which is the loop this is here to break; the tarballs
// are unpacked beside them instead. Both platforms' pieces in one tree is
// already what the loaders expect — each looks for the one folder named after
// the machine it is on and ignores the rest.
//
// Which packages those are is not written down here. Every one is in
// package-lock.json already, declared with the `os` and `cpu` it is for and with
// the address and checksum of its tarball, so a new dependency with compiled
// pieces needs no change to this file.
//
// Two things it cannot put back. Electron's own binary is unpacked into one
// `node_modules/electron/dist`, not one per platform, so a tree installed on a
// Mac still cannot start the app on Windows. Nor the `.bin` shims, which npm
// writes as Unix symlinks on a Mac and as `.cmd` files on Windows. A tree
// installed on the other platform is enough to speak and enough to assemble; it
// is not enough for `npm start`.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { unpack } = require('./unpack')

const ROOT = path.join(__dirname, '..')
const LOCK = path.join(ROOT, 'package-lock.json')

/** Somewhere to land a tarball that is not inside the tree being repaired. */
const STAGING = path.join(os.tmpdir(), 'jarvis-native-binaries')

const HERE = `${process.platform}-${process.arch}`

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

/**
 * npm's own rule for an `os` or `cpu` list: an empty list means anywhere, a bare
 * name means only there, and a name behind `!` means anywhere but there.
 */
function matches(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true
  const denied = list.filter((each) => each.startsWith('!')).map((each) => each.slice(1))
  if (denied.includes(value)) return false
  const allowed = list.filter((each) => !each.startsWith('!'))
  return allowed.length === 0 || allowed.includes(value)
}

/**
 * Every package in the lockfile that belongs on this machine and is fetched
 * rather than built. `libc` is not read: neither platform Jarvis runs on has
 * that question, and answering it wrongly would fetch a package that cannot
 * load.
 */
function wanted() {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  return Object.entries(lock.packages ?? {})
    .filter(([, each]) => (each.os || each.cpu) && each.resolved && !each.libc)
    .filter(([, each]) => matches(each.os, process.platform) && matches(each.cpu, process.arch))
    .map(([where, each]) => ({
      where,
      name: where.replace(/^node_modules[\/]/, ''),
      folder: path.join(ROOT, where),
      ...each,
    }))
}

/**
 * Whether a package is really there. The folder alone is not the answer: a run
 * that was interrupted halfway through unpacking leaves one behind, and its
 * manifest is the last thing to arrive.
 */
function present(entry) {
  return fs.existsSync(path.join(entry.folder, 'package.json'))
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * The checksum the lockfile recorded when the tree was resolved. These are
 * compiled binaries loaded into the app's own process, so the one place we can
 * check them is worth checking.
 */
function verify(bytes, integrity) {
  if (!integrity) return
  const [algorithm, expected] = integrity.split(' ')[0].split('-')
  const actual = createHash(algorithm).update(bytes).digest('base64')
  if (actual !== expected) {
    throw new Error(`the download does not match the ${algorithm} in the lockfile`)
  }
}

async function install(entry) {
  const archive = path.join(STAGING, `${entry.name.replace(/[^a-zA-Z0-9.-]/g, '-')}.tgz`)
  try {
    const bytes = await download(entry.resolved)
    verify(bytes, entry.integrity)
    fs.writeFileSync(archive, bytes)
    // Every npm tarball wraps its contents in a folder called `package`.
    unpack(archive, entry.folder, ['-z', '--strip-components=1'])
    console.log(`  ${entry.name} — ${megabytes(bytes.length)}`)
  } catch (error) {
    // Half a package is worse than none: it would be taken for installed on the
    // next run and never fetched again.
    fs.rmSync(entry.folder, { recursive: true, force: true })
    // Worth saying out loud, not worth failing an install over — everything in
    // the tree that does not speak still works.
    console.warn(`  ${entry.name} — not fetched: ${error.message}`)
  }
}

async function main() {
  const missing = wanted().filter((entry) => !present(entry))
  if (missing.length === 0) {
    console.log(`Every compiled package for ${HERE} is already here.`)
    return
  }

  console.log(`Fetching what npm left out for ${HERE}:`)
  fs.mkdirSync(STAGING, { recursive: true })
  for (const entry of missing) await install(entry)
  fs.rmSync(STAGING, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
