'use strict'

// Wiring Jarvis's personality onto this machine's Claude Code.
//
// The decision of what to write and how to take it back is the core's
// (src/core/claude-config.js). This supplies the machine-specific things it
// cannot know: the absolute path to the carried status line on this disk, the
// path to the file that remembers what the host had, and the personality the
// user is carrying — read from a plain file in the folder, never from anything
// that could hold a credential. The Maestro's own placements come from
// ./maestro, which asks the same machine the same kind of question.

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { createConfigurator, UnreadableSettingsError } = require('../core/claude-config')
const platform = require('../core/platform')

/**
 * The Brain compartment, at the folder's root rather than inside the app.
 *
 * Everything Jarvis carries into a machine's Claude Code is read from here and
 * nowhere else, so the file a person edits is the file that travels. It also
 * means none of it has to be unpacked out of the app's archive to be opened by
 * something that has never heard of one — which is what the status line is,
 * handed to Node by path.
 */
function brain() {
  return require('./data-location').where().brainDir
}
const hooks = require('./hooks')
const maestro = require('./maestro')

/** The output style Jarvis applies. Must match the name in the style file. */
const OUTPUT_STYLE = 'Resumo leigo'

/**
 * The only Claude Code settings the carried personality is allowed to set.
 * A deliberately short list: model and language are behaviour, not secrets.
 * Anything else in personality.json — a stray `permissions` block, an `env`
 * with a token in it — is ignored rather than trusted onto someone's machine.
 */
const PERSONALITY_KEYS = Object.freeze(['model', 'language'])

/** The carried status line script, resolved on this disk. */
function statusLineScript() {
  return path.join(brain(), 'LAYOUT.js')
}

/** The carried style file, resolved on this disk. */
function styleSource() {
  return path.join(brain(), 'BEHAVIOUR.md')
}

/**
 * Where the style file has to land for Claude Code to find it by name — beside
 * its settings file, under output-styles. The file's own frontmatter name is
 * what `outputStyle` points at, so the two are kept identical by test.
 */
function styleDestination() {
  return path.join(path.dirname(hooks.settingsFile()), 'output-styles', 'resumo-leigo.md')
}

/** The carried personality file, resolved on this disk. */
function personalityFile() {
  return path.join(brain(), 'LAYOUT.json')
}

/**
 * The status line command Claude Code is told to run. The script is named by an
 * absolute path, recomputed here on every Connect, so a folder that moved — to
 * another machine, or to a drive that came back under a different letter —
 * always points the status line at where the script actually is now.
 *
 * Run by Node, which both platforms have: the status line belongs to the
 * Carried personality, and that half of the folder has to behave the same
 * wherever Jarvis is plugged in. It used to be PowerShell, which meant Connect
 * on a Mac wrote a command that machine could not run.
 */
function statusLineCommand() {
  return {
    type: 'command',
    command: platform.statusLineCommand(statusLineScript()),
    padding: 1,
  }
}

/** The whitelisted personality, or an empty object if the file is unusable. */
function carriedPersonality() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(personalityFile(), 'utf8'))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const kept = {}
  for (const key of PERSONALITY_KEYS) {
    if (key in parsed) kept[key] = parsed[key]
  }
  return kept
}

/**
 * Everything Jarvis wants Claude Code to be. Resolved once and remembered: the
 * app path, the carried personality and the style name do not change while the
 * app runs, and this is read on every settings-sheet poll, so re-reading
 * personality.json each time is avoidable blocking I/O on the main process.
 */
let desiredMemo = null
function desired() {
  if (!desiredMemo) {
    desiredMemo = {
      outputStyle: OUTPUT_STYLE,
      statusLine: statusLineCommand(),
      ...carriedPersonality(),
    }
  }
  return desiredMemo
}

/**
 * Where Jarvis records what THIS machine had before Connect. It must be
 * machine-local, never inside the portable folder: carried along, one machine's
 * record would tell Disconnect on another machine to restore the first machine's
 * settings. So it lives beside the host's own Claude Code settings, the one
 * place that is always local to the machine being changed.
 */
function memoryFile() {
  return path.join(path.dirname(hooks.settingsFile()), '.jarvis-config-memory.json')
}

function configurator() {
  return createConfigurator({
    settingsFile: hooks.settingsFile(),
    memoryFile: memoryFile(),
    desired: desired(),
    placements: [
      { source: styleSource(), destination: styleDestination(), legacy: true },
      ...maestro.placements(),
    ],
  })
}

module.exports = {
  configurator,
  OUTPUT_STYLE,
  PERSONALITY_KEYS,
  statusLineScript,
  personalityFile,
  UnreadableSettingsError,
}
