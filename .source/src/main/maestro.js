'use strict'

// Wiring the Maestro onto this machine's Claude Code.
//
// What travels and when is the core's decision (src/core/maestro.js). This
// supplies the two things it cannot know: where the carried Maestro is on this
// disk — the Brain compartment at the folder's root, not inside the app — and
// where this machine's Claude Code keeps its own things: its settings file, the
// plugins it has installed, and the skills folder beside them.
//
// It reaches the host through the same door as the output style: placements the
// configurator copies in on Connect and takes back on Disconnect. See
// Docs/decisions/0016-carrying-the-maestro-the-way-the-style-travels.md.

const path = require('node:path')
const {
  hasSkillsPackage,
  maestroPlacements,
  pluginsFileIn,
  refusalFileIn,
  rememberRefusal,
  wasRefused,
  INSTALL_COMMAND,
} = require('../core/maestro')
const hooks = require('./hooks')

/**
 * Where the carried Maestro is read from: the Brain compartment at the folder's
 * root, so the instruction a person edits is the one that travels, with no
 * second copy inside the app to fall behind it.
 */
function carried() {
  return require('./data-location').where().brainDir
}

/** The host's own Claude Code folder — where its settings file lives. */
function claudeFolder() {
  return path.dirname(hooks.settingsFile())
}

/**
 * Whether this machine has the skills package. Asked afresh every time rather
 * than remembered, so a user who installs it later is simply served the
 * installed copy, with nothing said about it.
 */
function isPackageInstalled() {
  return hasSkillsPackage(pluginsFileIn(claudeFolder()))
}

/** What Connect places on this machine so the Maestro is there. */
function placements() {
  return maestroPlacements({
    carried: carried(),
    claudeFolder: claudeFolder(),
    packageInstalled: isPackageInstalled(),
  })
}

/**
 * Whether to offer the package on this machine: only when it is not there and
 * nobody here has turned it down. Detection runs every time, so an install that
 * happens later — through the card, or by the user's own hand — simply stops the
 * question being asked, with nothing said about it.
 */
function shouldOffer() {
  return !isPackageInstalled() && !wasRefused(refusalFileIn(claudeFolder()))
}

/** Writes the no down, so the question is never put twice on this machine. */
function rememberRefusalHere() {
  rememberRefusal(refusalFileIn(claudeFolder()))
}

module.exports = {
  carried,
  claudeFolder,
  isPackageInstalled,
  placements,
  shouldOffer,
  rememberRefusalHere,
  INSTALL_COMMAND,
}
