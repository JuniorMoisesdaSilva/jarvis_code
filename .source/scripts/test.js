'use strict'

// `npm test`, without the `.bin` shim — the same reason as scripts/start.js.
//
// The shims in a tree two machines share belong to whichever machine installed,
// so `vitest` as a name is not there on the other one. Vitest's own entry point
// is a real file in the package and works either way, so it is started by path.

const { spawn } = require('node:child_process')
const path = require('node:path')

const VITEST = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs')

const passed = process.argv.slice(2)
const watching = passed.includes('--watch')
const args = [VITEST, watching ? 'watch' : 'run', ...passed.filter((each) => each !== '--watch')]

const child = spawn(process.execPath, args, { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 0)
})
