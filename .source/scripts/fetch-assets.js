'use strict'

// Fetches the models Jarvis ships with: the voices it reads in, and the model
// it listens with.
//
// These are hundreds of megabytes of weights. They are not in Git — a
// repository is for text somebody wrote — but they are in the packaged app, so
// that a machine which has never run Jarvis can speak and listen the first time
// it is opened, offline, with nothing to download and no Windows voice to
// install. Run this before `npm run package`; `npm start` works without it,
// falling back to Windows' voices and to downloading Whisper on first use.
//
// Nothing already on disk is fetched twice, and a file that arrived in part is
// carried on from where it stopped rather than started again. A run that has
// nothing to do still ends by opening each listening model with the network shut
// off, which takes a few seconds and is the only way to know the folder is whole.

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pipeline } = require('node:stream/promises')
const natural = require('../src/core/natural-voices')
const models = require('../src/main/models')
const { findFolderRoot, RESOURCES: RESOURCES_NAME } = require('../src/core/folder')
const { unpack } = require('./unpack')

const ROOT = path.join(__dirname, '..')

/**
 * The compartment the voices and the listening model are fetched into: one copy
 * at the folder's root, read by both platforms. A checkout that is not inside a
 * Jarvis folder keeps them beside the app, which is where they used to live.
 */
const RESOURCES = (() => {
  const folder = findFolderRoot(ROOT, (candidate) => fs.existsSync(candidate))
  return folder ? path.join(folder, RESOURCES_NAME) : path.join(ROOT, 'assets')
})()

const VOICES = path.join(RESOURCES, natural.FOLDER)
const WHISPER = path.join(RESOURCES, 'models')
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const HUB = 'https://huggingface.co'

/** Somewhere to unpack into that is not the folder we are building. */
const STAGING = path.join(RESOURCES, '.staging')

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function exists(where) {
  try {
    return fs.readdirSync(where).length > 0
  } catch {
    return false
  }
}

async function download(url, into) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }
  await pipeline(response.body, fs.createWriteStream(into))
  return fs.statSync(into).size
}

async function fetchVoice(voice) {
  const folder = natural.folderFor(RESOURCES, voice)
  const pronunciation = natural.pronunciationFolder(RESOURCES)
  const haveVoice = fs.existsSync(path.join(folder, natural.WEIGHTS))
  const havePronunciation = exists(pronunciation)

  if (haveVoice && havePronunciation) {
    console.log(`  ${voice.id} — already here`)
    return
  }

  const archive = path.join(STAGING, `${voice.archive}.tar.bz2`)
  fs.mkdirSync(STAGING, { recursive: true })
  const size = await download(`${RELEASE}/${voice.archive}.tar.bz2`, archive)
  unpack(archive, STAGING, ['-j'])
  fs.rmSync(archive, { force: true })

  const unpacked = path.join(STAGING, voice.archive)

  // The weights are named after the voice in the archive and the same in every
  // folder here, so the host can open one without being told which.
  const weights = fs
    .readdirSync(unpacked)
    .find((each) => each.endsWith('.onnx') && !each.endsWith('.onnx.json'))
  if (!weights) throw new Error(`${voice.archive} carries no .onnx file`)

  fs.mkdirSync(folder, { recursive: true })
  fs.renameSync(path.join(unpacked, weights), path.join(folder, natural.WEIGHTS))
  fs.renameSync(path.join(unpacked, 'tokens.txt'), path.join(folder, natural.TOKENS))
  // Kept so the licence and the provenance of the recording survive packaging.
  // Which file carries them depends on who published the voice: Piper's own
  // come with a MODEL_CARD, and the ones fine-tuned by others carry a README or
  // a LICENSE instead. Two of the voices Jarvis ships are CC BY-NC-ND, which
  // requires the attribution to travel with them.
  for (const name of ['MODEL_CARD', 'README.md', 'LICENSE']) {
    const paper = path.join(unpacked, name)
    if (fs.existsSync(paper)) fs.renameSync(paper, path.join(folder, name))
  }

  // Every archive carries the same 18 MB of pronunciation rules. The first one
  // to arrive keeps them for all the others.
  if (!havePronunciation) {
    fs.mkdirSync(path.dirname(pronunciation), { recursive: true })
    fs.renameSync(path.join(unpacked, natural.PRONUNCIATION), pronunciation)
  }

  fs.rmSync(unpacked, { recursive: true, force: true })
  console.log(`  ${voice.id} — ${megabytes(size)} downloaded`)
}

async function ask(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }
  return response.json()
}

/**
 * What a listening model is made of, asked of the source rather than remembered
 * here: the two weight files the app opens, and every description file beside
 * them. The repositories are not alike — the accurate one carries four small
 * files the recommended one does not — and a description that never arrives is
 * a model that will not load.
 */
async function partsOf(name) {
  const id = models.model(name).id
  const listing = await ask(`${HUB}/api/models/${id}`)
  const described = listing.siblings
    .map((each) => each.rfilename)
    .filter((each) => !each.includes('/') && each.endsWith('.json'))

  const wanted = [...described, ...models.weights(name)]
  const found = await ask(`${HUB}/api/models/${id}/paths-info/main`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths: wanted }),
  })

  const parts = found.map((each) => ({
    name: each.path,
    size: each.size,
    // Only the weights are kept as large files, and only those come with a
    // digest of their contents. For the rest a size is all there is to check.
    digest: each.lfs?.oid ?? null,
  }))

  for (const name of wanted) {
    if (!parts.some((part) => part.name === name)) throw new Error(`${id} has no ${name}`)
  }
  return parts
}

async function digestOf(file) {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

/**
 * One file, and only the part of it that is not here yet.
 *
 * The accurate model is a gigabyte over a link that can drop, and starting again
 * from nothing each time is how a download never finishes: this asks for the
 * bytes after the ones already on disk and appends the answer. Found on
 * 6 September 2026, after two attempts inside the app reached 94 per cent and
 * left 1.3 GB of abandoned halves behind.
 */
async function fetchPart(id, part) {
  const target = path.join(WHISPER, ...id.split('/'), ...part.name.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })

  const here = fs.existsSync(target) ? fs.statSync(target).size : 0
  if (here === part.size) return 0
  // Longer than it should be is not a file to carry on from; it is one to fetch
  // again from the start.
  const from = here > 0 && here < part.size ? here : 0

  const response = await fetch(`${HUB}/${id}/resolve/main/${part.name}`, {
    headers: from > 0 ? { range: `bytes=${from}-` } : {},
  })
  if (!response.ok) {
    throw new Error(`${part.name} answered ${response.status} ${response.statusText}`)
  }

  // A server that ignores the range answers with the whole file. Appending that
  // to what is already here makes a longer file, not a finished one.
  const resuming = response.status === 206
  const live = process.stdout.isTTY
  let done = from
  let last = -1

  await pipeline(
    response.body,
    async function* (chunks) {
      for await (const chunk of chunks) {
        done += chunk.length
        const step = Math.floor((done / part.size) * 100)
        if (live && step !== last) {
          last = step
          process.stdout.write(`\r  ${part.name} — ${step}%   `)
        }
        yield chunk
      }
    },
    fs.createWriteStream(target, { flags: resuming ? 'a' : 'w' }),
  )
  if (live) process.stdout.write('\r' + ' '.repeat(70) + '\r')

  const size = fs.statSync(target).size
  if (size !== part.size) {
    throw new Error(`${part.name} came to ${size} bytes, not the ${part.size} published`)
  }
  if (part.digest && (await digestOf(target)) !== part.digest) {
    throw new Error(`${part.name} does not match the digest published for it`)
  }
  return part.size - from
}

/**
 * Proof that what is in the folder is a model this app can open: the same
 * library the app uses, pointed at the folder and told it may not go to the
 * network. Every run ends here, whether anything was fetched or not.
 */
async function proveItLoads(name) {
  const { pipeline: build, env } = await import('@huggingface/transformers')
  env.cacheDir = WHISPER
  env.allowLocalModels = true
  env.allowRemoteModels = false
  // The same precision the app asks for. Proving that some other precision
  // loads would prove nothing about the files just fetched.
  await build('automatic-speech-recognition', models.model(name).id, {
    dtype: models.quantization(name),
  })
}

/**
 * A listening model, into the folder layout the app reads it from.
 *
 * These files used to be fetched by asking the library for the model, on the
 * grounds that only the library knows the layout it expects. They are fetched by
 * hand now — that is what makes an interrupted download resumable — and the
 * guarantee moves to the end instead, where it is stronger: opening the folder
 * with that same library and no network says more than where the files came
 * from. It says they load.
 */
async function fetchWhisper(name) {
  const chosen = models.model(name)
  const parts = await partsOf(name)

  let fetched = 0
  for (const part of parts) fetched += await fetchPart(chosen.id, part)

  await proveItLoads(name)
  console.log(
    fetched === 0
      ? `  ${chosen.id} — already here`
      : `  ${chosen.id} — ${megabytes(fetched)} downloaded`,
  )
}

function totalSize(where) {
  let bytes = 0
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else bytes += fs.statSync(full).size
    }
  }
  try {
    walk(where)
  } catch {
    return 0
  }
  return bytes
}

async function main() {
  console.log('Voices:')
  for (const voice of natural.VOICES) await fetchVoice(voice)

  console.log('Listening models:')
  for (const name of models.travelling()) await fetchWhisper(name)

  fs.rmSync(STAGING, { recursive: true, force: true })

  const voices = totalSize(VOICES)
  const whisper = totalSize(WHISPER)
  console.log(
    `\nShipping ${megabytes(voices + whisper)} of models ` +
      `(${megabytes(voices)} of voices, ${megabytes(whisper)} of listening).`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
