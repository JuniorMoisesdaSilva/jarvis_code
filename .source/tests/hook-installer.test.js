import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createInstaller,
  helperCommandLine,
  launcherName,
  UnreadableSettingsError,
  EVENTS,
  MARKER,
  APPROVE_FLAG,
  PLAN_TOOL,
} from '../src/core/hook-installer.js'

// This is the only place in Jarvis that writes to a file the user owns, so it is
// the one that most needs a safety net.

const HELPER = '"C:\\Apps\\Jarvis\\Jarvis.exe" --jarvis-hook'

let directory
let settingsFile

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hooks-'))
  settingsFile = path.join(directory, 'settings.json')
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function installer(command = HELPER) {
  return createInstaller({ command, file: settingsFile })
}

function writeSettings(raw) {
  fs.writeFileSync(settingsFile, raw, 'utf8')
}

function readSettings() {
  return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
}

/** The listening hooks on an event: every group but the plan tool's matched approval. */
function listenersFor(event) {
  return readSettings().hooks[event].filter((group) => !('matcher' in group))
}

function commandsFor(event) {
  return listenersFor(event).flatMap((group) => group.hooks.map((each) => each.command))
}

describe('preserving what belongs to the user', () => {
  it('keeps everything already in the configuration', () => {
    writeSettings('{"model": "opus", "permissions": {"allow": ["Bash(git *)"]}, "env": {"FOO": "bar"}}')

    installer().install()

    const settings = readSettings()
    expect(settings.model).toBe('opus')
    expect(settings.permissions).toEqual({ allow: ['Bash(git *)'] })
    expect(settings.env).toEqual({ FOO: 'bar' })
    expect(settings.hooks).toBeDefined()
  })

  it("keeps another program's hooks", () => {
    writeSettings(
      '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "C:\\\\other\\\\program.exe"}]}]}}',
    )

    installer().install()

    expect(commandsFor('Stop')).toContain('C:\\other\\program.exe')
    expect(commandsFor('Stop')).toContain(HELPER)
  })
})

describe('refusing rather than wrecking', () => {
  it('refuses an unreadable configuration and leaves the file untouched', () => {
    const original = '{ this is not valid json'
    writeSettings(original)

    expect(() => installer().install()).toThrow(UnreadableSettingsError)
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(original)
  })

  it('refuses a configuration that is not an object', () => {
    writeSettings('[1, 2, 3]')
    expect(() => installer().install()).toThrow(UnreadableSettingsError)
  })

  it('names the file in the message, so the person can go fix it', () => {
    writeSettings('nope')
    expect(() => installer().install()).toThrow(settingsFile)
  })

  it('treats a missing file as a legitimate starting point', () => {
    expect(fs.existsSync(settingsFile)).toBe(false)
    expect(() => installer().install()).not.toThrow()
    expect(readSettings().hooks).toBeDefined()
  })

  it('treats an empty file as a legitimate starting point', () => {
    writeSettings('')
    expect(() => installer().install()).not.toThrow()
    expect(readSettings().hooks).toBeDefined()
  })

  it('leaves a safety copy before writing', () => {
    writeSettings('{"model": "opus"}')
    installer().install()

    const backup = `${settingsFile}.jarvis-bak`
    expect(fs.existsSync(backup)).toBe(true)
    expect(JSON.parse(fs.readFileSync(backup, 'utf8')).model).toBe('opus')
  })

  it('keeps the safety copy pointing at the original, not at its own work', () => {
    // Refreshing the copy on every write would replace the user's original with
    // a Jarvis-modified one, destroying the only thing it exists for.
    writeSettings('{"model": "opus"}')
    const subject = installer()

    subject.install()
    subject.uninstall()
    subject.install()

    const backup = JSON.parse(fs.readFileSync(`${settingsFile}.jarvis-bak`, 'utf8'))
    expect(backup).toEqual({ model: 'opus' })
  })

  it('leaves no half-written file behind', () => {
    installer().install()
    const alongside = fs.readdirSync(directory)

    expect(alongside.some((name) => name.endsWith('.jarvis-writing'))).toBe(false)
  })
})

describe('installing and removing', () => {
  it('registers every event Jarvis listens for', () => {
    installer().install()
    for (const event of EVENTS) {
      expect(commandsFor(event)).toContain(HELPER)
    }
  })

  it('does not duplicate the hooks when run twice', () => {
    installer().install()
    installer().install()

    for (const event of EVENTS) {
      expect(listenersFor(event)).toHaveLength(1)
    }
    expect(readSettings().hooks.PreToolUse).toHaveLength(2)
  })

  it('replaces the old hook when the app moves', () => {
    createInstaller({ command: '"C:\\Old\\Jarvis.exe" --jarvis-hook', file: settingsFile }).install()
    createInstaller({ command: '"C:\\New\\Jarvis.exe" --jarvis-hook', file: settingsFile }).install()

    expect(commandsFor('Stop')).toEqual(['"C:\\New\\Jarvis.exe" --jarvis-hook'])
  })

  it('leaves the configuration as it was before', () => {
    writeSettings('{"model": "opus"}')
    const subject = installer()

    subject.install()
    expect(subject.isInstalled()).toBe(true)

    subject.uninstall()
    expect(subject.isInstalled()).toBe(false)

    const settings = readSettings()
    expect(settings.model).toBe('opus')
    expect(settings.hooks).toBeUndefined()
  })

  it("does not touch another program's hooks when removing", () => {
    writeSettings(
      '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "C:\\\\other\\\\program.exe"}]}]}}',
    )
    const subject = installer()
    subject.install()
    subject.uninstall()

    expect(commandsFor('Stop')).toEqual(['C:\\other\\program.exe'])
  })

  it('reports installed only once every event is registered', () => {
    writeSettings(
      `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ${JSON.stringify(HELPER)}}]}]}}`,
    )
    expect(installer().isInstalled()).toBe(false)

    installer().install()
    expect(installer().isInstalled()).toBe(true)
  })

  it('reports not installed rather than throwing on an unreadable file', () => {
    // The Panel asks this question on every launch; it must not blow up.
    writeSettings('{ broken')
    expect(installer().isInstalled()).toBe(false)
  })

  it('removing from a configuration with no hooks at all is harmless', () => {
    writeSettings('{"model": "opus"}')
    expect(() => installer().uninstall()).not.toThrow()
    expect(readSettings().model).toBe('opus')
  })

  it('does not rewrite a file that held nothing of ours', () => {
    // Reformatting and re-sorting a file that is not ours, for no reason, is not
    // something a cautious module should do.
    const original = '{\n    "model":   "opus"\n}'
    writeSettings(original)

    installer().uninstall()

    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(original)
    expect(fs.existsSync(`${settingsFile}.jarvis-bak`)).toBe(false)
  })
})

describe('the command Claude Code is told to run', () => {
  it('is the launcher and the marker, and nothing else', () => {
    // Nothing else on purpose. The command goes to a shell whose identity is not
    // knowable from here, and a quoted path followed by arguments is the one
    // shape cmd, sh and PowerShell all read the same way. Everything that needs
    // shell syntax — the environment variable that turns Electron's binary into
    // Node — lives inside the launcher instead. See src/main/hooks.js.
    const command = helperCommandLine({
      launcher: String.raw`C:\Users\me\Jarvis\.jarvis-data\hook-relay.cmd`,
    })

    expect(command).toBe(
      String.raw`"C:\Users\me\Jarvis\.jarvis-data\hook-relay.cmd" --jarvis-hook`,
    )
  })

  it('quotes the path, because it will contain a space', () => {
    const command = helperCommandLine({
      launcher: '/Users/me/Library/Mobile Documents/Jarvis/.jarvis-data/hook-relay.sh',
    })

    expect(command).toContain('"/Users/me/Library/Mobile Documents/Jarvis/.jarvis-data/hook-relay.sh"')
  })

  it('carries the marker, so the installer recognises its own work', () => {
    // The launcher never reads it. The installer does: it is the only thing
    // telling a Jarvis hook from somebody else's, and without it an install
    // would stack a second copy on top of the first instead of replacing it.
    expect(helperCommandLine({ launcher: 'hook-relay.cmd' })).toContain(MARKER)
  })
})

// The launcher is written into the folder Jarvis is carried in, and that folder
// is usually inside OneDrive. Two machines writing one name there is
// two machines overwriting each other: the second to sync wins, and the first is
// left running an executable under a user folder it does not have — so every
// event Claude Code reports fails, with nothing on screen to say why.
describe('what the launcher is called', () => {
  it('carries the machine, so two of them never share a file', () => {
    expect(launcherName({ machine: 'WORK-L07' })).toBe('hook-relay-WORK-L07.cmd')
    expect(launcherName({ machine: 'HOME-PC' })).toBe('hook-relay-HOME-PC.cmd')
  })

  it('keeps the name to what a file name can hold', () => {
    expect(launcherName({ machine: "Alex's PC (work)" })).toBe('hook-relay-Alex-s-PC-work.cmd')
    expect(launcherName({ machine: 'desk.corp.example' })).toBe('hook-relay-desk-corp-example.cmd')
  })

  it('falls back to the plain name when the machine will not say', () => {
    expect(launcherName({ machine: '' })).toBe('hook-relay.cmd')
    expect(launcherName({ machine: null })).toBe('hook-relay.cmd')
  })
})

// The command a hook names has changed once already — from the app itself to a
// small launcher — and the settings file keeps whatever it was told first. Left
// there, the old command starts the whole of Electron on every event, slowly
// enough that Claude Code stops waiting at the end of a session and prints
// "SessionEnd hook failed: Hook cancelled" in place of a goodbye.
describe('bringing an out-of-date hook up to date', () => {
  const OLD = '"C:\\Apps\\Jarvis\\Jarvis.exe" "C:\\Apps\\Jarvis\\resources\\app" --jarvis-hook'

  function installOld() {
    createInstaller({ command: OLD, file: settingsFile }).install()
  }

  it('sees a hook naming an older command as out of date', () => {
    installOld()
    expect(installer().isStale()).toBe(true)
  })

  it('replaces it with the current command', () => {
    installOld()

    expect(installer().upgrade()).toBe(true)

    for (const event of EVENTS) expect(commandsFor(event)).toEqual([HELPER])
  })

  it('leaves a machine with no hook of ours alone', () => {
    // Not connected is not out of date: connecting is the user's to press, and
    // a Jarvis that installed itself on every launch would be undoable.
    writeSettings('{"model": "opus"}')

    expect(installer().isStale()).toBe(false)
    expect(installer().upgrade()).toBe(false)
    expect(readSettings().hooks).toBeUndefined()
  })

  it('leaves an up-to-date hook alone, and writes nothing', () => {
    installer().install()
    const before = fs.readFileSync(settingsFile, 'utf8')

    expect(installer().isStale()).toBe(false)
    expect(installer().upgrade()).toBe(false)
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(before)
  })

  it('sees ours on some events and missing from others as out of date', () => {
    writeSettings(
      `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ${JSON.stringify(HELPER)}}]}]}}`,
    )
    expect(installer().isStale()).toBe(true)

    installer().upgrade()
    for (const event of EVENTS) expect(commandsFor(event)).toEqual([HELPER])
  })

  it('takes ours off an event Jarvis no longer asks for', () => {
    // An older version registered Notification. Left there, Claude Code goes on
    // running our command for an event nothing handles.
    writeSettings(
      `{"hooks": {"Notification": [{"hooks": [{"type": "command", "command": ${JSON.stringify(OLD)}}]}]}}`,
    )

    expect(installer().isStale()).toBe(true)
    installer().upgrade()

    expect(readSettings().hooks.Notification).toBeUndefined()
    for (const event of EVENTS) expect(commandsFor(event)).toEqual([HELPER])
  })

  it("keeps another program's hook on an event Jarvis no longer asks for", () => {
    const OTHER = '/usr/local/bin/other-program'
    writeSettings(
      `{"hooks": {"Notification": [{"hooks": [{"type": "command", "command": ${JSON.stringify(OTHER)}}]}],` +
        `"Stop": [{"hooks": [{"type": "command", "command": ${JSON.stringify(OLD)}}]}]}}`,
    )

    installer().upgrade()

    expect(commandsFor('Notification')).toEqual([OTHER])
  })

  it('reports not out of date rather than throwing on an unreadable file', () => {
    // Asked on every launch, before anything is on screen to report it.
    writeSettings('{ broken')
    expect(installer().isStale()).toBe(false)
  })

  it('leaves a hook setting that is not a list exactly as it is', () => {
    // Not something Jarvis wrote. Guessing at it would mean editing a file that
    // is not ours in a shape nobody here understands.
    writeSettings(
      `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ${JSON.stringify(OLD)}}]}], "Notification": "surprise"}}`,
    )

    installer().upgrade()

    expect(readSettings().hooks.Notification).toBe('surprise')
  })
})

// The Deck hears every tool call, and a tool call is the one thing Claude Code
// does most often. So the nine events it listens to are registered as
// asynchronous: Claude Code starts the relay and goes on without waiting for it.
// Four of the five Jarvis had before keep their shape exactly — Stop and
// PermissionRequest carry what is read aloud, and nothing about them changes.
// The fifth, SessionEnd, is asynchronous too: waited for, it was cancelled by a
// Claude Code on its way out. ADR 0033.
describe('listening to every tool call without making Claude Code wait', () => {
  const FIVE = ['SessionStart', 'Stop', 'PermissionRequest', 'UserPromptSubmit', 'SessionEnd']
  const NINE = [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionDenied',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PostCompact',
    'StopFailure',
  ]

  function hooksFor(event) {
    return listenersFor(event).flatMap((group) => group.hooks)
  }

  it('listens for the five it had and the nine the Deck reads', () => {
    expect([...EVENTS].sort()).toEqual([...FIVE, ...NINE].sort())
  })

  it('registers the nine as asynchronous', () => {
    installer().install()
    for (const event of NINE) {
      expect(hooksFor(event)).toEqual([{ type: 'command', command: HELPER, async: true }])
    }
  })

  const WAITED = FIVE.filter((event) => event !== 'SessionEnd')

  it('leaves the four that are waited for exactly as they were', () => {
    installer().install()
    for (const event of WAITED) {
      expect(hooksFor(event)).toEqual([{ type: 'command', command: HELPER }])
    }
  })

  it('registers SessionEnd as asynchronous, so a Claude Code leaving cannot cancel it', () => {
    installer().install()
    expect(hooksFor('SessionEnd')).toEqual([{ type: 'command', command: HELPER, async: true }])
  })

  it('sees a SessionEnd that is still waited for as out of date, and brings it up', () => {
    installer().install()
    const settings = readSettings()
    settings.hooks.SessionEnd = [{ hooks: [{ type: 'command', command: HELPER }] }]
    writeSettings(JSON.stringify(settings))

    expect(installer().isStale()).toBe(true)
    installer().upgrade()
    expect(hooksFor('SessionEnd')).toEqual([{ type: 'command', command: HELPER, async: true }])
  })

  function installTheFiveOnly() {
    const hooks = Object.fromEntries(
      FIVE.map((event) => [event, [{ hooks: [{ type: 'command', command: HELPER }] }]]),
    )
    writeSettings(JSON.stringify({ hooks }))
  }

  it('sees an install made before the Deck as out of date, and brings it up', () => {
    installTheFiveOnly()
    expect(installer().isInstalled()).toBe(false)
    expect(installer().isStale()).toBe(true)

    expect(installer().upgrade()).toBe(true)

    expect(installer().isInstalled()).toBe(true)
    for (const event of NINE) expect(hooksFor(event)[0].async).toBe(true)
  })

  it('sees one of the nine registered without the flag as out of date', () => {
    installer().install()
    const settings = readSettings()
    settings.hooks.PreToolUse = [{ hooks: [{ type: 'command', command: HELPER }] }]
    writeSettings(JSON.stringify(settings))

    expect(installer().isInstalled()).toBe(false)
    expect(installer().isStale()).toBe(true)
    installer().upgrade()
    expect(hooksFor('PreToolUse')).toEqual([{ type: 'command', command: HELPER, async: true }])
  })

  it('sees one of the four made asynchronous as out of date', () => {
    // An answer read aloud must arrive in order.
    installer().install()
    const settings = readSettings()
    settings.hooks.Stop = [{ hooks: [{ type: 'command', command: HELPER, async: true }] }]
    writeSettings(JSON.stringify(settings))

    expect(installer().isStale()).toBe(true)
  })

  it('takes all fourteen away on Disconnect', () => {
    writeSettings('{"model": "opus"}')
    installer().install()
    installer().uninstall()
    expect(readSettings()).toEqual({ model: 'opus' })
  })
})

// Jarvis's own plan tool is approved by Jarvis: one PreToolUse group, matched
// to that tool and nothing else, waited for, answering "allow". It is one of
// ours like the rest — installed, kept current and taken away with them.
// ADR 0034.
describe('approving the plan tool, and nothing else', () => {
  const APPROVAL = `${HELPER} ${APPROVE_FLAG}`

  function approvals() {
    return (readSettings().hooks?.PreToolUse ?? []).filter((group) => 'matcher' in group)
  }

  it('is matched to the plan tool alone', () => {
    installer().install()
    expect(PLAN_TOOL).toBe('mcp__jarvis__update_plan')
    expect(approvals()).toEqual([
      { matcher: '^mcp__jarvis__update_plan$', hooks: [{ type: 'command', command: APPROVAL }] },
    ])
    expect(new RegExp(approvals()[0].matcher).test('mcp__jarvis__update_plan')).toBe(true)
    expect(new RegExp(approvals()[0].matcher).test('mcp__jarvis__update_plan_x')).toBe(false)
    expect(new RegExp(approvals()[0].matcher).test('Bash')).toBe(false)
  })

  it('is waited for, since its answer is the approval', () => {
    installer().install()
    expect(approvals()[0].hooks[0].async).toBeUndefined()
  })

  it('carries the marker, so it is recognised as ours', () => {
    expect(APPROVAL).toContain(MARKER)
  })

  it('is part of being installed, and current once there', () => {
    installer().install()
    expect(installer().isInstalled()).toBe(true)
    expect(installer().isStale()).toBe(false)
  })

  it('sees an install made before the plan tool as out of date, and brings it up', () => {
    installer().install()
    const settings = readSettings()
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((group) => !('matcher' in group))
    writeSettings(JSON.stringify(settings))

    expect(installer().isInstalled()).toBe(false)
    expect(installer().isStale()).toBe(true)
    expect(installer().upgrade()).toBe(true)
    expect(approvals()).toHaveLength(1)
    expect(installer().isInstalled()).toBe(true)
  })

  it('upgrades an approval naming an older command, keeping one', () => {
    createInstaller({ command: '"C:\\Old\\hook.cmd" --jarvis-hook', file: settingsFile }).install()
    expect(installer().upgrade()).toBe(true)
    expect(approvals()).toEqual([
      { matcher: '^mcp__jarvis__update_plan$', hooks: [{ type: 'command', command: APPROVAL }] },
    ])
  })

  it('sees an approval matched more widely as out of date', () => {
    installer().install()
    const settings = readSettings()
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.map((group) =>
      'matcher' in group ? { ...group, matcher: '.*' } : group,
    )
    writeSettings(JSON.stringify(settings))
    expect(installer().isStale()).toBe(true)
    installer().upgrade()
    expect(approvals()[0].matcher).toBe('^mcp__jarvis__update_plan$')
  })

  it("keeps another program's matched hook on the same event", () => {
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'C:\\other\\guard.exe' }] }
    writeSettings(JSON.stringify({ hooks: { PreToolUse: [theirs] } }))
    installer().install()
    expect(approvals()).toContainEqual(theirs)
    installer().uninstall()
    expect(readSettings().hooks.PreToolUse).toEqual([theirs])
  })

  it('is taken away on Disconnect with the rest', () => {
    writeSettings('{"model": "opus"}')
    installer().install()
    installer().uninstall()
    expect(readSettings()).toEqual({ model: 'opus' })
  })
})

// Two Jarvis folders on one machine — the one the user runs and a checkout, say
// — each write the same hooks naming their own launcher. Hooks the other one
// wrote, current in every way but the folder they name, are not "out of date":
// that Jarvis is connected and working, and nothing here should take it over
// without being asked. Connect still can, when pressed. Hooks of an older shape
// are out of date wherever they point, and so are hooks naming a launcher that
// is no longer there — the folder they name has moved or gone.
describe('hooks another Jarvis folder wrote', () => {
  let otherFolder
  let otherLauncher
  let otherCommand

  beforeEach(() => {
    otherFolder = path.join(directory, 'Other Jarvis')
    otherLauncher = path.join(otherFolder, '.jarvis-data', 'hook-relay-M.cmd')
    fs.mkdirSync(path.dirname(otherLauncher), { recursive: true })
    fs.writeFileSync(otherLauncher, '@echo off\r\n')
    otherCommand = helperCommandLine({ launcher: otherLauncher })
  })

  it('are not out of date when they are current: they name the Jarvis they belong to', () => {
    installer(otherCommand).install()
    const before = fs.readFileSync(settingsFile, 'utf8')

    expect(installer().isInstalled()).toBe(false)
    expect(installer().isStale()).toBe(false)
    expect(installer().elsewhere()).toBe(otherFolder)
    expect(installer().upgrade()).toBe(false)
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(before)
  })

  it('give way to this one when Connect is pressed', () => {
    installer(otherCommand).install()

    installer().install()

    expect(installer().isInstalled()).toBe(true)
    expect(installer().elsewhere()).toBeNull()
    for (const event of EVENTS) expect(commandsFor(event)).toEqual([HELPER])
  })

  it('are out of date when they are of an older shape, wherever they point', () => {
    const hooks = { Stop: [{ hooks: [{ type: 'command', command: otherCommand }] }] }
    writeSettings(JSON.stringify({ hooks }))

    expect(installer().elsewhere()).toBeNull()
    expect(installer().isStale()).toBe(true)
  })

  it('are out of date when the launcher they name is gone', () => {
    installer(otherCommand).install()
    fs.rmSync(otherLauncher)

    expect(installer().elsewhere()).toBeNull()
    expect(installer().isStale()).toBe(true)
  })

  it('name the folder itself, not its data folder, nor a data folder kept elsewhere', () => {
    installer(otherCommand).install()
    expect(installer().elsewhere()).toBe(otherFolder)

    const kept = path.join(directory, 'kept', 'hook-relay-M.cmd')
    fs.mkdirSync(path.dirname(kept), { recursive: true })
    fs.writeFileSync(kept, '')
    installer(helperCommandLine({ launcher: kept })).install()
    expect(installer().elsewhere()).toBe(path.dirname(kept))
  })

  it('are not somewhere else when they are this Jarvis’s own', () => {
    installer().install()
    expect(installer().elsewhere()).toBeNull()
    writeSettings('{"model": "opus"}')
    expect(installer().elsewhere()).toBeNull()
  })
})
