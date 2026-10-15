'use strict'

// How each shell is told to start.
//
// The whole job is UTF-8. Getting it wrong shows up as mangled Portuguese the
// first time somebody dictates a word with an accent, which is a poor way to
// find out. The preamble runs before the user sees a prompt, and clears itself
// away.

const { fileName } = require('../core/platform')

function argumentsFor(shell) {
  const name = fileName(shell).toLowerCase()

  if (name === 'powershell.exe' || name === 'pwsh.exe') {
    return [
      '-NoLogo',
      '-NoExit',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
        '$OutputEncoding = [System.Text.Encoding]::UTF8; ' +
        'Clear-Host',
    ]
  }

  if (name === 'cmd.exe') return ['/K', 'chcp 65001 > nul && cls']

  // Git Bash and anything else: leave it to the shell's own configuration.
  // Guessing at flags for a shell we do not know would break the launch outright.
  return []
}

module.exports = { argumentsFor }
