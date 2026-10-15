import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The app model's actions for the Spine and the Commands' and Skills' order,
// taken straight: two Sessions — two windows — on one preferences file, the
// way sessions.js holds them. A choice made in one is stored, and every window
// is sent a fresh state carrying it (the broadcast reaching each Session's
// reload), not only the window it was made in.
//
// Electron and the pseudo-terminal are stood in for — nothing here opens a
// window or a shell — and the data folder is a temporary one of the test's own.

const require = createRequire(import.meta.url)
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** A module answered by `exports` wherever it is required from now on. */
function standIn(name, exports) {
  const file = require.resolve(name, { paths: [SOURCE] })
  const module = new Module(file)
  module.exports = exports
  module.loaded = true
  require.cache[file] = module
}

let directory
let createSession
let preferences

/** A window as the app model sees it: what its Panel was sent, and nothing it can show. */
function aWindow() {
  const sent = []
  const contents = { send: (channel, state) => channel === 'state' && sent.push(state), isDestroyed: () => false }
  return {
    sent,
    last: () => sent.at(-1),
    panelContents: () => contents,
    terminalContents: () => null,
    settingsContents: () => null,
    panelShape: () => ({ position: 'right', collapsed: false }),
    paintGround() {},
    ownsContents: () => false,
  }
}

/** Two Sessions wired the way sessions.js wires them: a broadcast reaches each one's reload. */
function twoWindows() {
  const all = []
  const deps = {
    acquireVoice() {},
    acquireMic() {},
    broadcastHookState() {},
    isVoiceBusy: () => false,
    broadcastSpine: () => all.forEach((session) => session.actions.reloadSpine()),
    broadcastShortcuts: () => all.forEach((session) => session.actions.reloadShortcuts()),
  }
  const windows = [aWindow(), aWindow()]
  for (const win of windows) all.push(createSession({ win, deps }))
  return { windows, sessions: all }
}

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-model-'))
  process.env.JARVIS_DATA_DIR = directory
  standIn('electron', {
    app: { getAppPath: () => SOURCE, getPath: () => directory, isPackaged: false },
    clipboard: { writeText: async () => {} },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  })
  standIn('node-pty', {
    spawn() {
      throw new Error('no shell in this test')
    },
  })
  ;({ createSession } = require(path.join(SOURCE, 'src', 'main', 'app-model.js')))
  preferences = require(path.join(SOURCE, 'src', 'main', 'preferences.js'))
})

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('a choice on the Spine, made in one window', () => {
  it('turns a Part on: stored, and every window sent it', () => {
    const { windows, sessions } = twoWindows()
    sessions[0].actions.setPart({ part: 'plan', on: true })

    expect(preferences.read().deckPlan).toBe(true)
    for (const win of windows) expect(win.last().deckBlocks.plan).toBe(true)

    sessions[1].actions.setPart({ part: 'commands', on: false })
    expect(preferences.read().partCommands).toBe(false)
    for (const win of windows) expect(win.last().parts.commands).toBe(false)
  })

  it('reorders the Spine: stored whole, and every window sent it', () => {
    const { windows, sessions } = twoWindows()
    sessions[1].actions.setSpineOrder(['session', 'gauge'])

    const whole = ['session', 'gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings']
    expect(preferences.read().spineOrder).toEqual(whole)
    for (const win of windows) expect(win.last().spineOrder).toEqual(whole)
  })
})

describe('a drop among the Commands or the Skills, made in one window', () => {
  it('stores the Commands in their new order, and every window redraws them', () => {
    const { windows, sessions } = twoWindows()
    const ids = preferences.store().shortcuts().map((each) => each.id)
    const reversed = [...ids].reverse()
    sessions[0].actions.setShortcutOrder(reversed)

    expect(preferences.store().shortcuts().map((each) => each.id)).toEqual(reversed)
    for (const win of windows) expect(win.last().shortcuts.map((each) => each.id)).toEqual(reversed)
  })

  it('stores the Skills in their new order, and every window redraws them', () => {
    preferences.store().setSkills([
      { id: 's1', label: 'tdd', command: '/tdd', submits: false },
      { id: 's2', label: 'grill-me', command: '/grill-me', submits: false },
    ])
    const { windows, sessions } = twoWindows()
    sessions[1].actions.setSkillOrder(['s2', 's1'])

    expect(preferences.store().skills().map((each) => each.id)).toEqual(['s2', 's1'])
    for (const win of windows) expect(win.last().skills.map((each) => each.id)).toEqual(['s2', 's1'])
  })

  it('takes nothing that is not a list', () => {
    const { windows, sessions } = twoWindows()
    const before = windows.map((win) => win.sent.length)
    sessions[0].actions.setShortcutOrder('nonsense')
    sessions[0].actions.setSkillOrder(null)
    expect(windows.map((win) => win.sent.length)).toEqual(before)
  })
})
