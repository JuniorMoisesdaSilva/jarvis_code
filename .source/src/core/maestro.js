'use strict'

// The Maestro: what Jarvis has to know about it that does not depend on this
// machine.
//
// The Maestro is one behaviour — an experienced developer that takes a request
// in plain language and runs the work from request to delivery — and it leans on
// eight skills written by Matt Pocock and shipped as a Claude Code plugin. Jarvis
// carries its own copies of those eight, but they are the fallback: an installed
// package may be newer, so the Maestro prefers it and Jarvis leaves the copies at
// home. See Docs/decisions/0014-the-maestro-conducts-rather-than-replaces.md.
//
// Two questions live here, both answered from plain files and neither allowed to
// throw, because both are asked inside Connect: is the package installed, and has
// this machine already been offered it.

const fs = require('node:fs')
const path = require('node:path')

/**
 * The folder Claude Code finds the skill by. It has to match the `name` in the
 * skill's own frontmatter, and a test holds the two together.
 */
const MAESTRO = 'maestro'

/** The package the Maestro's embedded copies stand in for. */
const PACKAGE = 'mattpocock-skills'

/** What the user runs to install it. Shown, never run behind their back. */
const INSTALL_COMMAND = `claude plugin install ${PACKAGE}@claude-plugins-official`

/**
 * Whether this machine has the skills package.
 *
 * Claude Code keys its record of installed plugins by `name@marketplace`, so the
 * name is a prefix rather than the whole key. Version 2 of that file holds those
 * keys under `plugins`, beside a `version` number; earlier ones held them at the
 * top level. Both are read, because reading only the newer shape on an older
 * machine would silently answer "not installed" — which is the same wrong answer
 * as reading only the older shape on this one.
 *
 * A missing file, an unreadable one, broken JSON, a value that is not an object
 * — all of them mean "not installed", and none of them is worth failing Connect
 * over. The answer is never remembered between runs: a user who installs the
 * package later gets the installed copy without being told anything.
 */
function hasSkillsPackage(pluginsFile) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(pluginsFile, 'utf8'))
  } catch {
    return false
  }
  const named = (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key.startsWith(`${PACKAGE}@`))
  return named(parsed?.plugins) || named(parsed)
}

/**
 * Where Jarvis records that this machine said no to the package.
 *
 * Only the refusal is written down. A yes needs no record: the offer is gated on
 * the package being absent, so the moment an install succeeds the question stops
 * being asked on its own — and an install that did not succeed should be asked
 * about again, which writing down an "accepted" would prevent forever.
 *
 * It sits beside the host's own Claude Code settings, the one place that is
 * always local to the machine being asked. Not in preferences, which travel
 * inside the Portable folder and would carry one machine's answer to every other
 * one. Not in the Connect memory either, which Disconnect deletes — "you already
 * said no" has to outlive unplugging Jarvis and plugging it back in.
 */
function refusalFileIn(claudeFolder) {
  return path.join(claudeFolder, '.jarvis-maestro-offer.json')
}

/**
 * Whether this machine has already said no. The file existing is the whole
 * answer: a record that will not parse still means the question was put and
 * turned down, and asking again because Jarvis cannot read its own note is
 * exactly the nagging the once-only promise rules out.
 */
function wasRefused(refusalFile) {
  return fs.existsSync(refusalFile)
}

/**
 * Writes the refusal down. A failure is swallowed: the worst it costs is being
 * asked once more, and nothing here is worth interrupting the user over.
 */
function rememberRefusal(refusalFile) {
  try {
    const answer = { answered: 'declined', at: new Date().toISOString() }
    fs.writeFileSync(refusalFile, `${JSON.stringify(answer, null, 2)}\n`, 'utf8')
  } catch {
    // Asked again next time, then. Nothing is lost but a card.
  }
}

/** Where Claude Code records the plugins a machine has installed. */
function pluginsFileIn(claudeFolder) {
  return path.join(claudeFolder, 'plugins', 'installed_plugins.json')
}

/**
 * What Jarvis copies onto a host so the Maestro is there.
 *
 * The instruction always travels; the embedded copies of Matt Pocock's skills
 * travel only while the machine has no package of its own, because with the
 * package present the Maestro reads that instead and the copies are dead weight.
 *
 * Every one of them is optional: a Jarvis that could not place the Maestro is
 * still a Jarvis that hears Claude Code and reads its answers aloud, and
 * Connect must not fail over it.
 *
 * @param carried          the carried maestro folder, resolved on this disk
 * @param claudeFolder     the host's Claude Code folder — the one its settings
 *                         file sits in
 * @param packageInstalled whether this machine already has the skills package
 */
function maestroPlacements({ carried, claudeFolder, packageInstalled }) {
  const into = path.join(claudeFolder, 'skills', MAESTRO)
  const placements = [
    {
      // Named MAESTRO.md where a person reads it and SKILL.md where Claude
      // Code does: that second name is not ours to choose.
      source: path.join(carried, 'MAESTRO.md'),
      destination: path.join(into, 'SKILL.md'),
      optional: true,
    },
  ]
  if (!packageInstalled) {
    placements.push({
      source: path.join(carried, 'matt'),
      destination: path.join(into, 'matt'),
      optional: true,
    })
  }
  return placements
}

module.exports = {
  MAESTRO,
  PACKAGE,
  INSTALL_COMMAND,
  hasSkillsPackage,
  pluginsFileIn,
  maestroPlacements,
  refusalFileIn,
  wasRefused,
  rememberRefusal,
}
