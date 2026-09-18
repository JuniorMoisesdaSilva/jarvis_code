'use strict'

// Where Jarvis's writable state lives on this machine, resolved once.
//
// The decision is the core's (src/core/folder.js); this only hands it the
// real app path, the real AppData folder and the real disk, and remembers the
// answer so the tree is not walked on every read.

const fs = require('node:fs')
const { app } = require('electron')
const { locate } = require('../core/folder')

let resolved = null

function where() {
  if (resolved) return resolved
  resolved = locate({
    appRoot: app.getAppPath(),
    userData: app.getPath('userData'),
    env: process.env,
    exists: (candidate) => fs.existsSync(candidate),
  })
  return resolved
}

module.exports = { where }
