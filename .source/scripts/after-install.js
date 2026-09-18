'use strict'

// Puts back the one permission npm drops.
//
// node-pty does not open the shell itself on a Unix machine: it hands the work
// to a small companion binary, `spawn-helper`, which it finds by path rather
// than by `require`. npm unpacks it without its executable bit, and the failure
// that follows says nothing useful — `posix_spawnp failed`, from a line of C,
// with no mention of a permission or of the file. The terminal simply never
// opens, which on this app is everything.
//
// Windows has no such companion, so there is nothing to do there.

const fs = require('node:fs')
const path = require('node:path')

const MODULES = path.join(__dirname, '..', 'node_modules', 'node-pty')

/** Every `spawn-helper` under node-pty, whichever platform folder it sits in. */
function helpers(directory, found = []) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) helpers(full, found)
    else if (entry.name === 'spawn-helper') found.push(full)
  }
  return found
}

function main() {
  if (process.platform === 'win32') return

  for (const helper of helpers(MODULES)) {
    try {
      const mode = fs.statSync(helper).mode
      // Anyone who can read it can run it, which is the mode the tarball meant.
      fs.chmodSync(helper, mode | 0o111)
    } catch (error) {
      console.warn(`could not make ${path.relative(process.cwd(), helper)} executable: ${error.message}`)
    }
  }
}

main()
