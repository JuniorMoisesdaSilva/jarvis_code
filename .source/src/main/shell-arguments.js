'use strict'

// How each shell is told to start.
//
// On Windows the whole job is UTF-8. Getting it wrong shows up as mangled
// Portuguese the first time somebody dictates a word with an accent, which is a
// poor way to find out. The preamble runs before the user sees a prompt, and
// clears itself away.
//
// On macOS the encoding is already right and the job is a different one: the
// shell has to be a login shell, or the `PATH` the user's profile builds is
// missing and Claude Code is not on it.

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

  // A Unix shell, opened the way a terminal application opens one: interactive
  // and login, so the profile that puts Claude Code on the PATH is actually
  // read. Without `-l` the Session opens to a prompt where `claude` is not a
  // command, and nothing on screen says why.
  if (name === 'zsh' || name === 'bash') return ['-l', '-i']

  // Git Bash and anything else: leave it to the shell's own configuration.
  // Guessing at flags for a shell we do not know would break the launch outright.
  return []
}

module.exports = { argumentsFor }
