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
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')
const { createConfigurator, localizedStyle, UnreadableSettingsError } = require('../core/claude-config')
const platform = require('../core/platform')
const languages = require('../core/language')
const planTool = require('../core/plan-tool')

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
 * A deliberately short list: the model and the view are behaviour, not
 * secrets. The view is `focus`, so the screen shows the conversation and not
 * the diffs and commands behind it — the Resumo leigo style keeps code out of
 * the replies, and this keeps it out of the rest of the screen. Anything
 * else in LAYOUT.json — a stray `permissions` block, an `env` with a token in
 * it — is ignored rather than trusted onto someone's machine.
 *
 * The language was carried here too, until the panel's PT/EN switch became what
 * Claude Code answers in. A carried default and a switch on screen would
 * disagree the moment the switch was pressed, and the one the user can see has
 * to win, so the language is passed in rather than read from the file.
 */
const PERSONALITY_KEYS = Object.freeze(['model', 'viewMode'])

/** The carried status line script, resolved on this disk. */
function statusLineScript() {
  return path.join(brain(), 'LAYOUT.js')
}

/** The carried plan tool, a one-tool MCP server, resolved on this disk. */
function planScript() {
  return path.join(brain(), 'PLAN.js')
}

/** The name Claude Code knows the plan server by: its tool is `mcp__jarvis__update_plan`. */
const PLAN_SERVER = planTool.SERVER

/**
 * Where Claude Code keeps the user's own MCP servers, the list `claude mcp add
 * --scope user` writes to. It is Claude Code's state file, not its settings,
 * which is why the plan server is registered there and not beside the hooks.
 */
function mcpFile() {
  return path.join(os.homedir(), '.claude.json')
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
 * Run by Node, which every machine running Claude Code has: the status line
 * belongs to the Carried personality, and that half of the folder has to behave
 * the same wherever Jarvis is plugged in.
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
 * Everything Jarvis wants Claude Code to be, for the language the panel is
 * showing. Resolved once per language and remembered: the app path, the carried
 * personality and the style name do not change while the app runs, and this is
 * read on every settings-sheet poll, so re-reading LAYOUT.json each time is
 * avoidable blocking I/O on the main process.
 */
const desiredMemo = new Map()
function desired(language) {
  if (!desiredMemo.has(language)) {
    desiredMemo.set(language, {
      outputStyle: OUTPUT_STYLE,
      statusLine: statusLineCommand(),
      language: languages.claudeName(language),
      ...carriedPersonality(),
    })
  }
  return desiredMemo.get(language)
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

/** @param language the panel's chosen language, which Claude Code answers in. */
function configurator(language) {
  return createConfigurator({
    settingsFile: hooks.settingsFile(),
    memoryFile: memoryFile(),
    desired: desired(language),
    placements: [
      {
        source: styleSource(),
        destination: styleDestination(),
        legacy: true,
        adopt: true,
        render: (text) => localizedStyle(text, language === languages.PORTUGUESE),
      },
      ...maestro.placements(),
    ],
    // Jarvis's plan tool, which the Deck's Plan block draws. Its path is
    // recomputed on every Connect, like the status line's.
    mcp: { file: mcpFile(), servers: { [PLAN_SERVER]: platform.planServer(planScript()) } },
  })
}

/**
 * At start: the style file on the host is brought up to what Brain carries,
 * so an edit to BEHAVIOUR.md reaches Claude Code without a second Connect.
 * Silent, like the hooks' upgrade; a machine never connected is left alone.
 */
function refreshPlacedFiles(language) {
  try {
    return configurator(language).refresh()
  } catch {
    return false
  }
}

module.exports = {
  configurator,
  refreshPlacedFiles,
  OUTPUT_STYLE,
  PERSONALITY_KEYS,
  statusLineScript,
  planScript,
  PLAN_SERVER,
  personalityFile,
  UnreadableSettingsError,
}
