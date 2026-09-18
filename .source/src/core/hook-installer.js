'use strict'

// Registers (and removes) Jarvis's hooks in Claude Code's configuration.
//
// The hooks are global, so they work in any project. Since this is the only
// place in Jarvis that writes to a file the user owns, it is conservative: it
// only writes once it has understood what was already there, and it keeps a copy
// first.

const fs = require('node:fs')
const { readSettings, writeSettings, UnreadableSettingsError } = require('./settings-file')

/**
 * The events Jarvis cares about. The generic notification is left out: it does
 * not carry the request's content and would duplicate the permission event.
 *
 * `SessionStart` earns its place by being the only announcement that Claude
 * Code is up and listening — everything else arrives once the conversation is
 * already under way, which is too late to greet it with anything.
 */
const EVENTS = Object.freeze([
  'SessionStart',
  'Stop',
  'PermissionRequest',
  'UserPromptSubmit',
  'SessionEnd',
])

/**
 * How a hook command is recognised as ours. On Windows the helper is Jarvis's
 * own executable in helper mode, so the command is a whole command line rather
 * than a bare path — hence a substring match rather than a suffix one.
 */
const MARKER = 'jarvis-hook'

/** The flag that turns a launch of Jarvis into a launch of the helper. */
const HELPER_FLAG = `--${MARKER}`

/**
 * The command line Claude Code is told to run when one of its events fires: one
 * quoted path, then the marker, and nothing else.
 *
 * What it points at is a launcher Jarvis writes for this machine — see
 * src/main/hooks.js, which is also where the reasoning lives. The short of it is
 * that the relay needs an environment variable set, a hook command cannot set
 * one without knowing which shell Claude Code will use to run it, and a quoted
 * path followed by arguments is the one shape that is known to work in all of
 * them.
 *
 * The marker stays in the command line even though the launcher ignores it: it
 * is how a hook is recognised as Jarvis's own, and an install has to be able to
 * find the one before it and take it out.
 *
 * Quoted, because the path will contain a space sooner or later.
 */
function helperCommandLine({ launcher }) {
  return `"${launcher}" ${HELPER_FLAG}`
}

/**
 * What the launcher file is called on the machine asking.
 *
 * Named after the machine, and it has to be. The launcher names two absolute
 * paths — this machine's Electron, and this folder's relay — and the folder it
 * is written into is very often inside OneDrive or iCloud. Two machines writing
 * one name there is two machines overwriting each other: the last to sync wins,
 * and the other is left with a hook command pointing at an executable under a
 * user folder it does not have. Every event Claude Code reports then fails,
 * silently, until Jarvis is started again. Claude Code's settings are this
 * machine's own, so a file only this machine writes is what keeps the two
 * agreeing.
 *
 * The machine's name is taken as far as its first dot — a Mac calls itself
 * `Something.local` — and anything a file name would not welcome is replaced.
 */
function launcherName({ platform, machine }) {
  const extension = platform === 'win32' ? 'cmd' : 'sh'
  const named = String(machine ?? '')
    .split('.')[0]
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return named === '' ? `hook-relay.${extension}` : `hook-relay-${named}.${extension}`
}

function isJarvisGroup(group) {
  if (typeof group !== 'object' || group === null) return false
  if (!Array.isArray(group.hooks)) return false
  return group.hooks.some((each) => typeof each?.command === 'string' && each.command.includes(MARKER))
}

function asGroups(value) {
  return Array.isArray(value) ? value.filter((each) => typeof each === 'object' && each !== null) : []
}

/**
 * @param command the hook command line to register — must carry the marker.
 * @param file    Claude Code's settings file.
 */
function createInstaller({ command, file }) {
  /**
   * A missing file is a legitimate starting point. A file that exists and cannot
   * be read is **not**: treating it as empty would make the next write wipe out
   * the permissions, the environment and everything else the user configured.
   */
  function loadSettings() {
    return readSettings(file, { onMissing: 'empty' })
  }

  function write(settings) {
    // A safety copy before touching a file that is not ours — kept only the
    // first time. Refreshing it on every write would replace the user's original
    // with a Jarvis-modified one, destroying the only thing it exists for.
    const backup = `${file}.jarvis-bak`
    if (fs.existsSync(file) && !fs.existsSync(backup)) {
      fs.copyFileSync(file, backup)
    }

    writeSettings(file, settings)
  }

  function isInstalled() {
    let settings
    try {
      settings = loadSettings()
    } catch {
      return false
    }
    const hooks = settings.hooks
    if (typeof hooks !== 'object' || hooks === null) return false

    return EVENTS.every((event) =>
      asGroups(hooks[event]).some(
        (group) =>
          Array.isArray(group.hooks) && group.hooks.some((each) => each?.command === command),
      ),
    )
  }

  /**
   * Every hook of ours taken out, from **every** event — not only the ones
   * Jarvis registers today.
   *
   * An older version asked for a different set, and a hook of ours left behind
   * on an event nobody handles is a command Claude Code goes on running for
   * nothing. Anything that is not a list is left exactly as it is: it was not
   * written here, and guessing at it would mean editing a file that is not ours.
   */
  function withoutOurs(hooks) {
    const remaining = { ...hooks }
    let removed = false

    for (const event of Object.keys(remaining)) {
      if (!Array.isArray(remaining[event])) continue
      const before = remaining[event]
      const groups = before.filter((group) => !isJarvisGroup(group))
      if (groups.length === before.length) continue
      removed = true
      if (groups.length === 0) delete remaining[event]
      else remaining[event] = groups
    }

    return { hooks: remaining, removed }
  }

  function install() {
    const settings = loadSettings()
    const existing =
      typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {}
    const { hooks } = withoutOurs(existing)

    for (const event of EVENTS) {
      const groups = asGroups(hooks[event])
      groups.push({ hooks: [{ type: 'command', command }] })
      hooks[event] = groups
    }

    write({ ...settings, hooks })
  }

  /**
   * Whether Claude Code is carrying a hook of ours that no longer says what it
   * should — an older command line, an event Jarvis has stopped asking for, or
   * ours on some events and missing from others.
   *
   * The distinction from `isInstalled` is the whole point. A settings file with
   * no hook of ours in it is not stale, it is simply not connected, and
   * connecting is the user's to press. Only a hook already there is ours to keep
   * current.
   */
  function isStale() {
    let settings
    try {
      settings = loadSettings()
    } catch {
      return false
    }
    const hooks = settings.hooks
    if (typeof hooks !== 'object' || hooks === null) return false

    let found = false
    for (const event of Object.keys(hooks)) {
      for (const group of asGroups(hooks[event])) {
        if (!isJarvisGroup(group)) continue
        found = true
        const current =
          EVENTS.includes(event) &&
          group.hooks.length === 1 &&
          group.hooks[0]?.command === command
        if (!current) return true
      }
    }

    return found && !isInstalled()
  }

  /**
   * Brings a hook left by an older Jarvis up to the current command line, and
   * does nothing at all when there is nothing of ours to bring up to date.
   *
   * This exists because the command a hook names has changed once already and
   * will again, and the settings file keeps whatever it was told years ago. Left
   * alone, the old command goes on being run: slowly enough that Claude Code
   * gives up waiting at the end of a session and prints a failure in place of a
   * goodbye. Nobody would read that line as "reconnect Jarvis", so nobody does.
   *
   * @returns whether anything was written.
   */
  function upgrade() {
    if (!isStale()) return false
    install()
    return true
  }

  function uninstall() {
    const settings = loadSettings()
    if (typeof settings.hooks !== 'object' || settings.hooks === null) return
    const { hooks, removed } = withoutOurs(settings.hooks)

    // Nothing of ours was there. Rewriting the file anyway would reformat and
    // re-sort a file that is not ours, for no reason.
    if (!removed) return

    const remaining = { ...settings }
    if (Object.keys(hooks).length === 0) delete remaining.hooks
    else remaining.hooks = hooks
    write(remaining)
  }

  return { install, uninstall, upgrade, isInstalled, isStale, command, file }
}

module.exports = {
  createInstaller,
  helperCommandLine,
  launcherName,
  UnreadableSettingsError,
  EVENTS,
  MARKER,
  HELPER_FLAG,
}
