import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agent, user, incoming } from '../src/core/events.js'
import { effect } from '../src/core/effects.js'
import { shortcut, skill, defaults, isShortcut, repair } from '../src/core/command-shortcut.js'
import { createPreferences } from '../src/core/preferences.js'
import { hasEffect } from './helpers.js'

// Command shortcuts are the one place where Jarvis submits text on your behalf,
// so the rules around them are worth pinning down.

const PROJECT = 'C:\\project'

function coreWithProject() {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT))
  return core
}

describe('pressing a Command shortcut', () => {
  it('runs it in the terminal', () => {
    const core = coreWithProject()
    const pressed = shortcut({ label: 'Claude', command: 'claude' })

    expect(core.dispatch(user.shortcutPressed(pressed))).toEqual([effect.runInTerminal('claude')])
  })

  it('only types the command when the shortcut does not submit', () => {
    // Useful for a command you want to complete by hand before running.
    const core = coreWithProject()
    const pressed = shortcut({ label: 'Add dir', command: 'claude --add-dir ', submits: false })

    expect(core.dispatch(user.shortcutPressed(pressed))).toEqual([
      effect.sendTextToTerminal('claude --add-dir '),
    ])
  })

  it('does nothing when the command is blank', () => {
    const core = coreWithProject()
    const pressed = shortcut({ label: 'Broken', command: '   ' })

    expect(core.dispatch(user.shortcutPressed(pressed))).toEqual([])
  })

  it('interrupts a Reading in progress', () => {
    // You reached for a command, so you are done listening.
    const core = coreWithProject()
    core.receive(incoming(agent.assistantFinished('s1', 'a long answer'), PROJECT))
    expect(core.state.isSpeaking).toBe(true)

    const effects = core.dispatch(user.shortcutPressed(shortcut({ label: 'Exit', command: 'exit' })))
    expect(effects[0]).toEqual(effect.stopSpeaking())
    expect(core.state.isSpeaking).toBe(false)
  })

  it('does not enter the written Transcript', () => {
    // What reaches Claude Code is written by the submitted-message hook; a shell
    // command is not part of the conversation.
    const core = coreWithProject()
    const effects = core.dispatch(user.shortcutPressed(shortcut({ label: 'Exit', command: 'exit' })))

    expect(hasEffect(effects, 'log')).toBe(false)
  })

  it('does not count as a Dictation for the Transcript marking', () => {
    // Running `claude` and then typing the same word by hand must not make the
    // Transcript claim you dictated it.
    const core = coreWithProject()
    core.dispatch(user.shortcutPressed(shortcut({ label: 'Claude', command: 'claude' })))

    expect(core.state.lastDictatedText).toBeNull()
  })

  it('still runs when no project is open', () => {
    // The session filter exists to route Claude Code's events, not to gate the
    // user's own button presses.
    const core = new JarvisCore()
    const pressed = shortcut({ label: 'Claude', command: 'claude' })

    expect(core.dispatch(user.shortcutPressed(pressed))).toEqual([effect.runInTerminal('claude')])
  })
})

describe('storing Command shortcuts', () => {
  let directory
  let preferences

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-shortcuts-'))
    preferences = createPreferences(path.join(directory, 'preferences.json'))
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('falls back to the defaults when none are saved', () => {
    expect(preferences.shortcuts()).toEqual(defaults())
  })

  it('survives a relaunch', () => {
    const mine = [shortcut({ label: 'Recap', command: '/recap' })]
    preferences.setShortcuts(mine)

    expect(createPreferences(preferences.file).shortcuts()).toEqual(mine)
  })

  it('brings the defaults back when the list is cleared', () => {
    // A Panel with no buttons and no way to add one would be a dead end.
    preferences.setShortcuts([shortcut({ label: 'Recap', command: '/recap' })])
    preferences.setShortcuts([])

    expect(preferences.shortcuts()).toEqual(defaults())
  })

  it('ignores a hand-edited list holding something that is not a shortcut', () => {
    fs.writeFileSync(preferences.file, '{"shortcuts": [{"label": "Half"}]}', 'utf8')
    expect(preferences.shortcuts()).toEqual(defaults())
  })

  it('keeps the order the user put them in', () => {
    const mine = [
      shortcut({ label: 'Third', command: 'c' }),
      shortcut({ label: 'First', command: 'a' }),
      shortcut({ label: 'Second', command: 'b' }),
    ]
    preferences.setShortcuts(mine)

    expect(preferences.shortcuts().map((each) => each.label)).toEqual(['Third', 'First', 'Second'])
  })
})

describe('the icon on a Command or a Skill', () => {
  it('is terminal-window on a new Command and lightning on a new Skill', () => {
    expect(shortcut({ label: 'Recap', command: '/recap' }).glyph).toBe('terminal-window')
    expect(skill({ label: 'tdd', command: '/tdd' }).glyph).toBe('lightning')
  })

  it('can be none, and a name it does not know is none', () => {
    expect(shortcut({ label: 'Recap', command: '/recap', glyph: null }).glyph).toBeNull()
    expect(skill({ label: 'tdd', command: '/tdd', glyph: 'not-an-icon' }).glyph).toBeNull()
    expect(shortcut({ label: 'Recap', command: '/recap', glyph: 'rocket' }).glyph).toBe('rocket')
  })

  it('is one of their own on each built-in', () => {
    expect(Object.fromEntries(defaults().map((each) => [each.label, each.glyph]))).toEqual({
      Claude: 'terminal-window',
      Continue: 'play',
      Resume: 'clock-counter-clockwise',
      Update: 'arrow-circle-up',
      '/usage': 'gauge',
      '/context': 'stack',
      Exit: 'sign-out',
    })
  })

  it('is kept by repair, a name it does not know turned to none', () => {
    const stored = { id: 'a', label: 'Recap', command: '/recap', submits: true }
    expect(isShortcut({ ...stored, glyph: 'rocket' })).toBe(true)
    expect(repair({ ...stored, glyph: 'rocket' }).glyph).toBe('rocket')
    expect(repair({ ...stored, glyph: null }).glyph).toBeNull()
    expect(repair({ ...stored, glyph: 'not-an-icon' }).glyph).toBeNull()
  })

  it('is given to an entry stored before there were icons: a built-in its own, else its kind', () => {
    const old = { id: 'built-in-exit', label: 'Exit', command: 'exit', submits: true }
    expect(repair(old).glyph).toBe('sign-out')
    expect(repair({ ...old, id: 'mine' }).glyph).toBe('terminal-window')
    expect(repair({ ...old, id: 'mine' }, 'lightning').glyph).toBe('lightning')
  })
})
