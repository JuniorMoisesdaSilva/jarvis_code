'use strict'

// Assembles the Windows app into the `Windows/` compartment.
//
// The compiled pieces — the speech engine, the ONNX runtime, the terminal — are
// published per platform, and npm installs only this machine's. So this builds
// for Windows x64, from a Windows machine, and nothing else.
//
// The output does not carry the voices or the listening model. They live once,
// in `Resources/` at the folder's root, and the running app walks up to find
// them (src/core/folder.js).
//
// Two things here are not optional and are easy to get wrong silently:
//
//  1. The dependencies must stay outside the archive — all of them. A `.node`
//     file loads from an archive, but the `.dll` files sitting next to it do
//     not, and the pieces started from a path look for the packages
//     they import on disk and nowhere else. Either mistake produces an app whose
//     dictation fails at first use, with nothing wrong at build time.
//  2. Binaries for other platforms are excluded. Left in, they more than double
//     the size of an app that can never run them.

const fs = require('node:fs')
const path = require('node:path')
const { packager } = require('@electron/packager')
const icons = require('../src/core/icon-files')
const natural = require('../src/core/natural-voices')
const { findFolderRoot, RESOURCES } = require('../src/core/folder')

const ROOT = path.join(__dirname, '..')

/** The compartment the app belongs in. */
const COMPARTMENT = 'Windows'

if (process.platform !== 'win32') {
  console.error('  Jarvis is assembled on Windows, for Windows. This machine is not one.')
  process.exit(1)
}

const folderRoot = findFolderRoot(ROOT, (candidate) => fs.existsSync(candidate))
if (!folderRoot) {
  console.error('  This is not inside a Jarvis folder — no .jarvis-root above it.')
  process.exit(1)
}
const OUT = path.join(folderRoot, COMPARTMENT)

/**
 * The icons folder as a glob, derived from the constant the app itself reads
 * rather than spelled out again. asar matches with forward slashes whatever the
 * platform, so the separators are converted rather than assumed.
 */
const ICONS = `**/${icons.FOLDER.split(path.sep).join('/')}/**`

/**
 * Everything that has to exist as a real file on disk rather than inside the
 * archive:
 *
 * - every dependency, because a `.node` file loads from the archive but the
 *   libraries beside it do not, and because the two pieces started from a path
 *   resolve their imports from disk — see the note below;
 * - the speech host scripts, because they are handed to another program by path
 *   and it knows nothing about Electron's archive format;
 * - the Whisper worker, because a worker thread is started from a path too.
 *
 * Each of these fails only at the moment it is first used, in an assembled
 * build, which is the worst time to find out.
 */
const MUST_BE_ON_DISK = [
  // Every dependency, with none named. The Whisper worker and the voice host are
  // started from disk, so Node resolves their imports from disk too and never
  // looks inside the archive — which means it is not enough for the packages
  // they import to be out here, every package underneath those has to be as
  // well. This list used to name them one at a time, and was wrong: it held
  // onnxruntime-node but not onnxruntime-common below it, and the first
  // dictation in an assembled build failed on a package it could not find. A
  // named list has to be right about the whole graph, forever, and nothing
  // checks it. So the whole tree comes out, and there is no list to get wrong.
  //
  // It costs almost nothing. The heavy packages were already out here; what is
  // left inside the archive is the app's own code, which is where the loading
  // time an archive saves actually is.
  '**/node_modules/**',
  '**/src/main/helpers/**',
  '**/src/main/whisper-worker.js',
  // The icons, because the system opens them itself — the taskbar, the
  // notification area, a shortcut — and none of that knows what an archive is. Left
  // packed, an assembled app simply has no icon, and says nothing about why.
  ICONS,
]

/**
 * Binaries for machines this app will never run on. Some packages ship every
 * platform's build inside themselves, whichever machine installed them.
 */
function foreignPlatforms() {
  return [
    /node_modules[\\/]onnxruntime-node[\\/]bin[\\/][^\\/]+[\\/](darwin|linux)[\\/]/,
    /node_modules[\\/]onnxruntime-node[\\/]bin[\\/][^\\/]+[\\/]win32[\\/]arm64[\\/]/,
    /node_modules[\\/]node-pty[\\/]prebuilds[\\/](?!win32-x64)/,
    // One rule, not two: `sharp-(?!win32-x64)` on its own also throws away
    // `sharp-libvips-win32-x64`, the 15 MB of image library the other half
    // loads at first use.
    /node_modules[\\/]@img[\\/]sharp-(?!(?:libvips-)?win32-x64([\\/]|$))/,
    /node_modules[\\/]sherpa-onnx-(?!node|win-x64)/,
  ]
}

/** Parts of the source folder that have no business in an assembled app. */
const SOURCE_ONLY = [
  /^[\\/]tests([\\/]|$)/,
  /^[\\/]scripts([\\/]|$)/,
  /^[\\/]\.git([\\/]|$)/,
  // The icons themselves ship; the note explaining how to apply them does not.
  /^[\\/]assets[\\/]icons[\\/]README\.md$/,
]

/**
 * The models are fetched by a separate script and are not in Git, so the way to
 * assemble a mute, deaf app is to forget to run it. Said out loud here because
 * the build otherwise succeeds and the loss only shows up when somebody speaks.
 */
function warnAboutMissingResources() {
  const resources = path.join(folderRoot, RESOURCES)
  const missing = []
  if (!fs.existsSync(natural.pronunciationFolder(resources))) missing.push('the voices')
  if (!fs.existsSync(path.join(resources, 'models'))) missing.push('the listening model')
  if (missing.length === 0) return
  console.warn(
    `\n  Resources is missing ${missing.join(' and ')}.\n` +
      '  The app assembles either way — it reads them from the folder root, not from\n' +
      '  inside itself — but it will have nothing to speak or listen with until\n' +
      '  `npm run fetch-assets` has been run.\n',
  )
}

/**
 * What lives in the compartment without being build output: `electron/`, the
 * runtime `npm start` opens the app with, fetched by scripts/platform-runtime.js and costing 150 MB
 * to fetch again, and the README that explains the compartment to whoever opens
 * it.
 */
const KEPT = new Set(['electron', 'README.md'])

/** Empties the compartment of everything the last assembly put there. */
function clearCompartment() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const name of fs.readdirSync(OUT)) {
    if (KEPT.has(name)) continue
    fs.rmSync(path.join(OUT, name), { recursive: true, force: true })
  }
}

warnAboutMissingResources()
clearCompartment()

packager({
  dir: ROOT,
  out: OUT,
  name: 'Jarvis',
  platform: process.platform,
  arch: process.arch,
  overwrite: true,
  prune: true,
  // Named once, in the core, so this and the running window cannot drift apart:
  // the executable on disk and the app in the taskbar are the one thing.
  icon: path.join(ROOT, icons.FOLDER, icons.APP),
  appVersion: require('../package.json').version,
  appCopyright: 'Jarvis',
  win32metadata: {
    CompanyName: 'Jarvis',
    FileDescription: 'A voice assistant for Claude Code',
    ProductName: 'Jarvis',
  },
  ignore: [...SOURCE_ONLY, ...foreignPlatforms()],
  asar: { unpack: `{${MUST_BE_ON_DISK.join(',')}}` },
})
  .then(([built]) => {
    // Packager writes into a folder of its own naming — Jarvis-win32-x64 — and
    // the compartment is already named for the platform, so the second name
    // says nothing twice. The app is lifted up and the wrapper removed, leaving
    // Windows/Jarvis.exe.
    built = lift(built)
    if (!everyDependencyLanded(built)) return
    console.log(`\n  ${COMPARTMENT}/ assembled — ${path.relative(folderRoot, built)}`)
    console.log('  The voices and the listening model stay in Resources/ and are read from there.\n')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })

/**
 * Walks what the app depends on and says so if any of it is not in the bundle.
 *
 * What lands outside the archive is decided by globs, and what is left out
 * altogether by patterns — and both fail quietly. A glob that matches less than
 * it should, or an exclusion that reaches further than it meant to, still
 * assembles: the package is simply not there, and nothing looks for it until
 * somebody dictates. Both have happened here.
 *
 * The tree installed beside this script is the answer key. npm put exactly the
 * packages this machine needs into it, optional ones included, so anything in
 * there and not in the bundle was lost on the way.
 *
 * With one subtraction: anything foreignPlatforms() throws away on purpose is
 * not counted as lost. Without it the check would cry wolf over packages a
 * Windows x64 app has no use for, and a check that cries wolf is a check nobody
 * reads.
 */
function everyDependencyLanded(built) {
  const resources = path.join(path.dirname(built), 'resources')
  const bundled = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const installed = path.join(ROOT, 'node_modules')

  const read = (where, name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(where, name, 'package.json'), 'utf8'))
    } catch {
      return null
    }
  }

  // Deliberately thrown away is not lost. Asked of the same patterns packager
  // was given, so the two can never drift apart.
  const foreign = foreignPlatforms()
  const thrownAway = (name) =>
    foreign.some((pattern) => pattern.test(path.join('node_modules', name) + path.sep))

  const missing = []
  const seen = new Set()
  const queue = Object.keys(require('../package.json').dependencies ?? {})
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)

    const here = read(installed, name)
    if (!here) continue // an optional one for another platform; never installed
    if (thrownAway(name)) continue // for another platform, and excluded on purpose
    if (!read(bundled, name)) {
      missing.push(name)
      continue
    }
    queue.push(...Object.keys(here.dependencies ?? {}))
    queue.push(...Object.keys(here.optionalDependencies ?? {}))
  }
  if (missing.length === 0) return true

  console.error(
    `\n  ${missing.length} package(s) never reached the disk beside the archive:\n` +
      `    ${missing.join(', ')}\n` +
      '  Dictation or speech would fail at first use on something they cannot find.\n' +
      '  Check what MUST_BE_ON_DISK unpacks and what foreignPlatforms() throws away.\n',
  )
  process.exitCode = 1
  return false
}

/** Moves the single app out of packager's wrapper folder and drops the wrapper. */
function lift(built) {
  const inside = fs
    .readdirSync(built)
    .filter((name) => name === 'Jarvis.exe')
  if (inside.length !== 1) return built // something unexpected; leave it alone
  const from = path.join(built, inside[0])
  const to = path.join(OUT, inside[0])
  fs.rmSync(to, { recursive: true, force: true })
  fs.renameSync(from, to)
  // Whatever else packager left beside the app — licences, notices — comes too.
  for (const name of fs.readdirSync(built)) {
    fs.renameSync(path.join(built, name), path.join(OUT, name))
  }
  fs.rmSync(built, { recursive: true, force: true })
  return to
}
