'use strict'

// `npm start`, without the `.bin` shim.
//
// The obvious script is `electron .`, which npm resolves through
// `node_modules/.bin` to the runtime inside `node_modules`. Jarvis starts on
// its own runtime instead, kept in `Windows/electron` (scripts/platform-runtime.js
// says why), so nothing is resolved by name. The runtime is fetched if it is
// missing and started by full path, with this folder as the app it should open.

const { spawn } = require('node:child_process')
const path = require('node:path')
const { ensureRuntime } = require('./platform-runtime')

const APP = path.join(__dirname, '..')

async function main() {
  const electron = await ensureRuntime()
  const child = spawn(electron, [APP, ...process.argv.slice(2)], { stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    // A signal is not an exit code; reporting one as the other would have a
    // launcher think the app failed when the user simply closed it.
    process.exitCode = signal ? 1 : (code ?? 0)
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
