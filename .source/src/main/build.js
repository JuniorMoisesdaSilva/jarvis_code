'use strict'

// The fingerprint of the code this Jarvis was started from, taken once, at
// start: what it is running, not what the disk says later. The rule it feeds —
// what a running Jarvis does when it is launched again — is the core's
// (src/core/second-launch.js), and so is the digest.
//
// Read from the app itself: its `package.json` and everything under `src`. In
// an assembled app that is inside the archive, which Electron's `fs` reads
// like a folder.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { fingerprint } = require('../core/second-launch')

const CODE = /\.(js|html|css|json)$/

function filesUnder(root, folder, into) {
  let entries
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true })
  } catch {
    return into
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) filesUnder(root, full, into)
    else if (CODE.test(entry.name)) {
      into.push({ name: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') })
    }
  }
  return into
}

/** The digest of the code at the app's path, as it is on disk right now. */
function read() {
  const root = app.getAppPath()
  const files = filesUnder(root, path.join(root, 'src'), [])
  try {
    files.push({ name: 'package.json', text: fs.readFileSync(path.join(root, 'package.json'), 'utf8') })
  } catch {
    // An app with no package.json still has its code to tell apart.
  }
  return fingerprint(files)
}

let taken = null

/** This process's build: read the first time it is asked, which is at start. */
function current() {
  if (taken === null) taken = read()
  return taken
}

module.exports = { current }
