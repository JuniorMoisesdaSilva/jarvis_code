// The Electron binary a test may spawn.
//
// `import electronPath from 'electron'` reads node_modules/electron/path.txt,
// and that folder holds whichever platform installed last — one tree, two
// machines. On the other machine every test that spawns Electron fails with
// ENOENT on a path ending in Electron.app, which says nothing about the cause.
//
// The runtime fetched for this platform is the answer when it is there
// (scripts/platform-runtime.js); the package is the fallback, so a checkout
// outside a Jarvis folder behaves as it always did.

import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function electronBinary() {
  try {
    const { runtimeExecutable } = require('../../scripts/platform-runtime.js')
    const runtime = runtimeExecutable()
    if (fs.existsSync(runtime)) return runtime
  } catch {
    // No folder root above this checkout, or no runtime fetched into it.
  }
  return require('electron')
}
