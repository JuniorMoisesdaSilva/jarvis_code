'use strict'

// `npm test`, without the `.bin` shim — the same way scripts/start.js starts
// Electron. Vitest's own entry point is a real file in the package, so it is
// started by path and nothing is resolved by name.

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
