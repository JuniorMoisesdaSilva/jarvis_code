'use strict'

// Registers (and removes) Jarvis's hooks in Claude Code's configuration.
//
// The hooks are global, so they work in any project. Since this is the only
// place in Jarvis that writes to a file the user owns, it is conservative: it
// only writes once it has understood what was already there, and it keeps a copy
// first.

const fs = require('node:fs')
const path = require('node:path')
const { readSettings, writeSettings, UnreadableSettingsError } = require('./settings-file')
const planTool = require('./plan-tool')

/**
 * The events Jarvis cares about and Claude Code waits for. The generic
 * notification is left out: it does not carry the request's content and would
 * duplicate the permission event.
 *
 * `SessionStart` earns its place by being the only announcement that Claude
 * Code is up and listening — everything else arrives once the conversation is
 * already under way, which is too late to greet it with anything.
 */
const WAITED_FOR = Object.freeze([
  'SessionStart',
  'Stop',
  'PermissionRequest',
  'UserPromptSubmit',
])

/**
 * The goodbye, registered as asynchronous although only the panel reads it.
 *
 * Claude Code fires it on its way out, and a command that exits at once —
 * `claude update` is the one that showed it — stops waiting almost
 * immediately. A relay starting cold was cancelled there and the terminal
 * printed "SessionEnd hook failed: Hook cancelled". Claude Code does not cancel
 * an asynchronous hook, and still lets it finish: a relay that took a second to
 * deliver was measured arriving after the process had gone. Nothing comes after
 * a goodbye, so there is no order for it to break.
 */
const FAREWELL = 'SessionEnd'

/**
 * The events only the Deck reads: every tool call, every subagent, every
 * compaction and every failed turn. A tool call is the thing Claude Code does
 * most often, so these are registered as asynchronous — Claude Code starts the
 * relay and carries on without waiting for it. The five above keep their shape:
 * an answer read aloud has to arrive in order, and nothing about them changes.
 * ADR 0033.
 */
const ASYNC_EVENTS = Object.freeze([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'StopFailure',
])

const EVENTS = Object.freeze([...WAITED_FOR, FAREWELL, ...ASYNC_EVENTS])

/** The events Claude Code is told not to wait for. */
const NOT_WAITED_FOR = Object.freeze([FAREWELL, ...ASYNC_EVENTS])

/**
 * Jarvis's own plan tool, as Claude Code names it: the `update_plan` tool of
 * the MCP server Connect registers as `jarvis` (Brain/PLAN.js).
 */
const PLAN_TOOL = planTool.FULL_NAME

/** The flag that turns a run of the relay into the plan tool's approval. */
const APPROVE_FLAG = '--approve-plan'

/**
 * The hooks Jarvis registers to answer rather than to listen — one, today: a
 * PreToolUse matched to its own plan tool and nothing else, waited for, whose
 * command prints "allow". The tool only draws a progress bar, and Claude Code
 * would otherwise stop the work to ask about it in every project. The one
 * permission Jarvis grants (ADR 0034).
 */
const APPROVALS = Object.freeze([
  Object.freeze({ event: 'PreToolUse', matcher: `^${PLAN_TOOL}$`, flag: APPROVE_FLAG }),
])

function approvalCommand(command, approval) {
  return `${command} ${approval.flag}`
}

/** An approval's group, exactly as it is written. */
function approvalGroup(command, approval) {
  return { matcher: approval.matcher, hooks: [{ type: 'command', command: approvalCommand(command, approval) }] }
}

/** Whether a group already in the file is an approval exactly as `approvalGroup` would write it. */
function isCurrentApproval(event, group, command) {
  return APPROVALS.some(
    (approval) =>
      approval.event === event &&
      group.matcher === approval.matcher &&
      group.hooks.length === 1 &&
      group.hooks[0]?.type === 'command' &&
      group.hooks[0].command === approvalCommand(command, approval) &&
      group.hooks[0].async === undefined,
  )
}

/** The one hook Jarvis registers on an event, exactly as it is written. */
function hookFor(event, command) {
  return NOT_WAITED_FOR.includes(event)
    ? { type: 'command', command, async: true }
    : { type: 'command', command }
}

/** Whether a hook already in the file is the one `hookFor` would write. */
function isCurrentHook(event, hook, command) {
  return (
    hook?.command === command && (hook.async === true) === NOT_WAITED_FOR.includes(event)
  )
}

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
 * is written into is very often inside OneDrive. Two machines writing
 * one name there is two machines overwriting each other: the last to sync wins,
 * and the other is left with a hook command pointing at an executable under a
 * user folder it does not have. Every event Claude Code reports then fails,
 * silently, until Jarvis is started again. Claude Code's settings are this
 * machine's own, so a file only this machine writes is what keeps the two
 * agreeing.
 *
 * Anything in the machine's name a file name would not welcome is replaced.
 */
function launcherName({ machine }) {
  const named = String(machine ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return named === '' ? 'hook-relay.cmd' : `hook-relay-${named}.cmd`
}

/**
 * The launcher a hook command line names, when it has the shape
 * `helperCommandLine` writes; null for any other shape.
 */
function launcherIn(command) {
  const match = /^"([^"]+)" (\S+)$/.exec(command ?? '')
  return match && match[2] === HELPER_FLAG ? match[1] : null
}

/**
 * The Jarvis folder a launcher belongs to: the launcher is written into the
 * folder's `.jarvis-data`, unless the data folder was kept somewhere else, in
 * which case that folder is the best name there is.
 */
function folderOfLauncher(launcher) {
  const data = path.dirname(launcher)
  return path.basename(data) === '.jarvis-data' ? path.dirname(data) : data
}

function isJarvisGroup(group) {
  if (typeof group !== 'object' || group === null) return false
  if (!Array.isArray(group.hooks)) return false
  return group.hooks.some((each) => typeof each?.command === 'string' && each.command.includes(MARKER))
}

function asGroups(value) {
  return Array.isArray(value) ? value.filter((each) => typeof each === 'object' && each !== null) : []
}

/** Whether one of our groups is exactly as an install for `command` writes it. */
function isCurrentGroup(event, group, command) {
  const listening =
    EVENTS.includes(event) &&
    !('matcher' in group) &&
    group.hooks.length === 1 &&
    isCurrentHook(event, group.hooks[0], command)
  return listening || isCurrentApproval(event, group, command)
}

/** Whether `hooks` carries every hook and approval an install for `command` writes. */
function installedFor(hooks, command) {
  const listening = EVENTS.every((event) =>
    asGroups(hooks[event]).some(
      (group) =>
        !('matcher' in group) &&
        Array.isArray(group.hooks) &&
        group.hooks.some((each) => isCurrentHook(event, each, command)),
    ),
  )
  const approving = APPROVALS.every((approval) =>
    asGroups(hooks[approval.event]).some(
      (group) => Array.isArray(group.hooks) && isCurrentApproval(approval.event, group, command),
    ),
  )
  return listening && approving
}

/**
 * @param command the hook command line to register — must carry the marker.
 * @param file    Claude Code's settings file.
 */
function createInstaller({ command, file, exists = fs.existsSync }) {
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

  /** The hooks in the settings file, or null when there are none or it cannot be read. */
  function currentHooks() {
    let settings
    try {
      settings = loadSettings()
    } catch {
      return null
    }
    const hooks = settings.hooks
    return typeof hooks === 'object' && hooks !== null ? hooks : null
  }

  function isInstalled() {
    const hooks = currentHooks()
    return hooks !== null && installedFor(hooks, command)
  }

  /**
   * The folder of another Jarvis whose hooks these are, or null.
   *
   * Two Jarvis folders on one machine — the one the user runs and a checkout,
   * say — write the same hooks, each naming its own launcher. Hooks current in
   * every way but the launcher they name belong to a Jarvis that is connected
   * and working: they are not out of date, and nothing here takes them over
   * unasked. Only when that launcher is still there, though — one that is gone
   * is a folder that moved or was deleted, and its hooks run nothing.
   */
  function elsewhere() {
    const hooks = currentHooks()
    if (hooks === null) return null
    const ours = Object.keys(hooks).flatMap((event) =>
      asGroups(hooks[event])
        .filter(isJarvisGroup)
        .map((group) => ({ event, group })),
    )
    if (ours.length === 0) return null
    const first = ours[0].group.hooks.find((each) => typeof each?.command === 'string' && each.command.includes(MARKER))
    const theirs = first.command.endsWith(` ${APPROVE_FLAG}`) ? first.command.slice(0, -(APPROVE_FLAG.length + 1)) : first.command
    if (theirs === command) return null
    const launcher = launcherIn(theirs)
    if (launcher === null) return null
    const exact = ours.every(({ event, group }) => isCurrentGroup(event, group, theirs))
    if (!exact || !installedFor(hooks, theirs) || !exists(launcher)) return null
    return folderOfLauncher(launcher)
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
      groups.push({ hooks: [hookFor(event, command)] })
      hooks[event] = groups
    }
    for (const approval of APPROVALS) {
      hooks[approval.event] = [...asGroups(hooks[approval.event]), approvalGroup(command, approval)]
    }

    write({ ...settings, hooks })
  }

  /**
   * Whether Claude Code is carrying a hook of ours that no longer says what it
   * should — an older command line, an event Jarvis has stopped asking for, a
   * hook waited for that should not be or the other way round, or ours on some
   * events and missing from others. An install made before the Deck is the
   * last of these: the five without the nine. So is one made before the plan
   * tool, without its approval.
   *
   * The distinction from `isInstalled` is the whole point. A settings file with
   * no hook of ours in it is not stale, it is simply not connected, and
   * connecting is the user's to press. Only a hook already there is ours to keep
   * current. Nor is one another Jarvis folder wrote, current but for the
   * launcher it names (`elsewhere`): that Jarvis is connected, and taking it
   * over is the user's to press as well.
   */
  function isStale() {
    const hooks = currentHooks()
    if (hooks === null) return false

    let found = false
    let current = true
    for (const event of Object.keys(hooks)) {
      for (const group of asGroups(hooks[event])) {
        if (!isJarvisGroup(group)) continue
        found = true
        if (!isCurrentGroup(event, group, command)) current = false
      }
    }
    if (!found) return false
    if (current && installedFor(hooks, command)) return false
    // Another Jarvis's own, and working: not ours to call old.
    return elsewhere() === null
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

  return { install, uninstall, upgrade, isInstalled, isStale, elsewhere, command, file }
}

module.exports = {
  createInstaller,
  helperCommandLine,
  launcherName,
  UnreadableSettingsError,
  EVENTS,
  ASYNC_EVENTS,
  NOT_WAITED_FOR,
  MARKER,
  HELPER_FLAG,
  PLAN_TOOL,
  APPROVE_FLAG,
  APPROVALS,
}
