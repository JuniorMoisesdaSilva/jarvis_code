// The Electron binary a test may spawn.
//
// The runtime `npm start` uses is the answer when it is there
// (scripts/platform-runtime.js), so the tests spawn the same Electron the app
// runs on. The package is the fallback, so a checkout outside a Jarvis folder
// behaves as it always did.

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
