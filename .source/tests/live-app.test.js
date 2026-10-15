import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attach,
  dialogsOf,
  endAll,
  isolated,
  launch,
  mainProcesses,
  makeFolder,
  pressInDialog,
  reaches,
  sleep,
  temporaryRoot,
  until,
  waitForPage,
} from './helpers/live-app.js'
import { launcherName } from '../src/core/hook-installer.js'

// The real app, end to end, on copies of the files a machine that was already
// connected carries: Claude Code's settings with the old five hooks of ours
// beside someone else's, its ~/.claude.json, the memory file an old Connect
// left, and a preferences file with no Deck in it.
//
// It retells the bug in `Docs/history/the-deck-plan/diario.md` (13 out). A
// Jarvis left in the tray since the morning took the afternoon's launch, so the
// window that opened drew the new page over the old main process: a Mods click
// went to an action that process did not have, nothing was written and nothing
// lit, and Connect put the old five hooks back and called that connected. Here
// the code under a running Jarvis changes, Jarvis is launched again, and what
// answers has to be the new code — then a Mods switch is clicked and Connect is
// pressed through the page, and the disk is read for what they wrote.
//
// The launch that replaces the old Jarvis must run as itself: its own
// environment, folder and console, not the old process's. Each launch here
// gets a hook channel of its own (JARVIS_PIPE, which only the environment
// carries), so the channel that answers says whose environment Jarvis is
// running in. And two launches arriving together must leave one Jarvis, after
// at most one question.

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'connect-old-five')
const PORT = 9400 + (process.pid % 300) * 4
// Each launch has a DevTools port of its own: a launch opens its port as it
// starts, while the Jarvis it is waiting on still holds the other.
const AFTERNOON_PORT = PORT + 1
const EVENING_PORTS = [PORT + 2, PORT + 3]

const root = temporaryRoot('live')
const { source, folder } = makeFolder(root)
const run = isolated(root)
const launcherFile = path.join(run.data, launcherName({ machine: os.hostname() }))
const settingsFile = path.join(run.home, '.claude', 'settings.json')
const hostFile = path.join(run.home, '.claude.json')

/** A fixture with this run's paths in it. */
function fixture(name, to) {
  const text = fs
    .readFileSync(path.join(FIXTURES, name), 'utf8')
    .replaceAll('{{RELAY}}', launcherFile.replaceAll('\\', '\\\\'))
    .replaceAll('{{FOLDER}}', folder.replaceAll('\\', '/'))
    .replaceAll('{{HOME}}', run.home.replaceAll('\\', '/'))
  fs.writeFileSync(to, text)
}

/** Claude Code's own file is large on a machine that has used it for months. */
function bigHost() {
  const host = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'claude.json'), 'utf8'))
  for (let i = 0; i < 400; i++) host.projects[`C:/Projects/Padding ${i}`] = { history: [], lastCost: i }
  fs.writeFileSync(hostFile, JSON.stringify(host, null, 2))
}

fixture('settings.json', settingsFile)
fixture('jarvis-config-memory.json', path.join(run.home, '.claude', '.jarvis-config-memory.json'))
fs.copyFileSync(path.join(FIXTURES, 'preferences.json'), path.join(run.data, 'preferences.json'))
bigHost()

function ourCommands() {
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''))
  return Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      (group.hooks ?? []).filter((hook) => hook.command.includes('jarvis-hook')).map((hook) => ({ event, command: hook.command })),
    ),
  )
}

function preferences() {
  return JSON.parse(fs.readFileSync(path.join(run.data, 'preferences.json'), 'utf8'))
}

/** Sends the window of the process `pid` a close, as the title bar's cross does. */
function closeWindowOf(pid) {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CloseMainWindow() | Out-Null`], {
    stdio: 'ignore',
    timeout: 30_000,
  })
}

/** A launch's environment: the run's, with a hook channel only this launch names. */
const environment = (name) => ({ ...run.env, JARVIS_PIPE: `${run.env.JARVIS_PIPE}-${name}` })

let morning
let afternoon
let morningExited = false
let panel
let settings

beforeAll(async () => {
  morning = launch({ source, port: PORT, profile: run.profile, env: environment('morning') })
  morning.on('exit', () => (morningExited = true))
  await waitForPage(PORT, 'panel.html', { timeout: 60_000 })
  // The user closes the window. Jarvis stays in the tray.
  await until(async () => {
    closeWindowOf(morning.pid)
    await sleep(500)
    const left = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
    return !left.some((t) => t.url.endsWith('panel.html'))
  })
  // The afternoon's checkout lands under it.
  const main = path.join(source, 'src', 'main', 'main.js')
  fs.appendFileSync(main, '\n// The afternoon.\n')
  // And the user starts Jarvis again.
  afternoon = launch({ source, port: AFTERNOON_PORT, profile: run.profile, env: environment('afternoon') })
  await until(() => morningExited, { timeout: 20_000 })
  panel = await attach(await waitForPage(AFTERNOON_PORT, 'panel.html', { timeout: 60_000 }))
  await until(() => panel.evaluate(`document.querySelectorAll('#spine [data-part]').length === 9`))
}, 180_000)

afterAll(() => {
  panel?.close()
  settings?.close()
  endAll(run.profile)
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
})

describe('Jarvis launched again after its code changed', () => {
  it('is answered by the new code: the Jarvis in the tray makes way', () => {
    expect(morningExited).toBe(true)
  })

  it('runs as the new launch itself, in its own environment and with its own console', async () => {
    // Not a process the old one started: the launch, still running, is Jarvis.
    expect(afternoon.exited).toBe(false)
    expect(mainProcesses(run.profile)).toEqual([afternoon.pid])
    // Its environment named the channel; the old one's is gone.
    expect(await reaches(environment('afternoon').JARVIS_PIPE)).toBe(true)
    expect(await reaches(environment('morning').JARVIS_PIPE)).toBe(false)
    // And it says so on its own console.
    expect(afternoon.output).toContain('this one is starting')
  })
})

describe('a Spine button, clicked', () => {
  it('lights, puts its Part in the page, and is written down', { timeout: 60_000 }, async () => {
    const pressed = () => panel.evaluate(`document.querySelector('#spine [data-part="plan"]').getAttribute('aria-pressed')`)
    const lineShown = () => panel.evaluate(`document.querySelector('.deck-block[data-block="plan"]').getClientRects().length > 0`)
    expect(await pressed()).toBe('false')
    expect(await lineShown()).toBe(false)
    expect(preferences().deckPlan).toBeUndefined()

    await panel.evaluate(`document.querySelector('#spine [data-part="plan"]').click()`)

    expect(await until(async () => (await pressed()) === 'true')).toBe(true)
    expect(await until(lineShown)).toBe(true)
    expect(await until(() => preferences().deckPlan === true)).toBe(true)
    expect(panel.exceptions).toEqual([])
  })

  it('takes a section off and back, written down as its own switch', { timeout: 60_000 }, async () => {
    const shown = () => panel.evaluate(`document.getElementById('commands-section').getClientRects().length > 0`)
    expect(await shown()).toBe(true)

    await panel.evaluate(`document.querySelector('#spine [data-part="commands"]').click()`)
    expect(await until(async () => !(await shown()))).toBe(true)
    expect(await until(() => preferences().partCommands === false)).toBe(true)

    await panel.evaluate(`document.querySelector('#spine [data-part="commands"]').click()`)
    expect(await until(shown)).toBe(true)
    expect(await until(() => preferences().partCommands === true)).toBe(true)
    expect(panel.exceptions).toEqual([])
  })
})

describe('a Spine button, dragged', () => {
  it('reorders the Spine and the page, and the order is written down', { timeout: 60_000 }, async () => {
    const order = () => panel.evaluate(`[...document.querySelectorAll('#spine [data-part]')].map((node) => node.dataset.part)`)
    const stack = () =>
      panel.evaluate(
        `[...document.getElementById('body').children].filter((node) => node.getClientRects().length > 0 && node.dataset.part).map((node) => node.dataset.part)`,
      )
    expect((await order()).slice(0, 2)).toEqual(['gauge', 'events'])

    // Session picked up and dropped on Context's upper half.
    await panel.evaluate(`(() => {
      const button = (id) => document.querySelector('#spine [data-part="' + id + '"]')
      const from = button('session')
      const to = button('gauge')
      const box = to.getBoundingClientRect()
      const dataTransfer = new DataTransfer()
      const at = { clientX: box.left + box.width / 2, clientY: box.top + 4 }
      const fire = (node, type) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...at }))
      fire(from, 'dragstart')
      fire(to, 'dragover')
      fire(to, 'drop')
      fire(from, 'dragend')
    })()`)

    expect(await until(async () => (await order())[0] === 'session')).toBe(true)
    expect(await until(() => preferences().spineOrder?.[0] === 'session')).toBe(true)
    expect(preferences().spineOrder).toEqual(await order())
    // Session was below Commands in the page; now it leads it.
    expect(await until(async () => (await stack())[0] === 'session')).toBe(true)
    expect(panel.exceptions).toEqual([])
  })
})

describe('Connect, on a machine connected with the old five hooks', () => {
  const sheetText = () => settings.evaluate(`document.getElementById('hooks-text').textContent`)
  const buttons = () =>
    settings.evaluate(
      `({ connect: !document.getElementById('install-hooks').disabled, disconnect: !document.getElementById('remove-hooks').disabled })`,
    )

  it('says the connection is out of date, and offers both buttons', { timeout: 60_000 }, async () => {
    await panel.evaluate(`document.getElementById('settings').click()`)
    // The sheet is made with the window and shown by the gear.
    settings = await attach(await waitForPage(AFTERNOON_PORT, 'settings.html'))
    expect(await until(async () => /out of date/i.test(await sheetText()))).toBe(true)
    expect(await buttons()).toEqual({ connect: true, disconnect: true })
  })

  it('puts in every hook, the plan approval and the plan server', { timeout: 60_000 }, async () => {
    await settings.evaluate(`document.getElementById('install-hooks').click()`)
    expect(await until(async () => /^Connected/.test(await sheetText()))).toBe(true)

    const commands = ourCommands()
    expect(new Set(commands.map((each) => each.event)).size).toBe(14)
    expect(commands.filter((each) => each.command.includes('--approve-plan'))).toHaveLength(1)
    expect(commands.every((each) => each.command.includes(launcherFile))).toBe(true)

    const host = JSON.parse(fs.readFileSync(hostFile, 'utf8'))
    expect(host.mcpServers?.jarvis?.args?.[0]).toMatch(/Brain\/PLAN\.js$/)
    expect(Object.keys(host.projects).length).toBeGreaterThan(400)

    // Someone else's hooks are still there.
    expect(fs.readFileSync(settingsFile, 'utf8')).toContain('logi-claude-desktop')
    expect(settings.exceptions).toEqual([])
  })

  it('shows on the sheet why, when Connect cannot write', { timeout: 60_000 }, async () => {
    await settings.evaluate(`document.getElementById('remove-hooks').click()`)
    await until(async () => /^Not connected/.test(await sheetText()))
    // A ~/.claude.json Claude Code left half written.
    fs.writeFileSync(hostFile, '{ "numStartups": 3,')

    await settings.evaluate(`document.getElementById('install-hooks').click()`)
    expect(await until(async () => /couldn.t|could not/i.test(await sheetText()))).toBeTruthy()
    expect(await sheetText()).toContain('.claude.json')
  })
})

describe('two launches of newer code at once, with a window open', () => {
  let evenings = []

  it('ask once, and leave exactly one Jarvis — one of the new launches', { timeout: 120_000 }, async () => {
    fs.appendFileSync(path.join(source, 'src', 'main', 'main.js'), '\n// The evening.\n')
    evenings = EVENING_PORTS.map((port, i) =>
      launch({ source, port, profile: run.profile, env: environment(`evening-${i}`) }),
    )

    // A window is open, so the afternoon's Jarvis asks — over that window.
    const asked = await until(() => (dialogsOf(afternoon.pid).length > 0 ? dialogsOf(afternoon.pid) : null), {
      timeout: 60_000,
      every: 500,
    })
    expect(asked).toHaveLength(1)
    expect(asked[0].parent).not.toBe('#32769')
    expect(asked[0].parentName).toMatch(/^Jarvis/)
    // The second launch waits on the same question; it does not get one of its own.
    await sleep(2_000)
    expect(dialogsOf(afternoon.pid)).toHaveLength(1)
    expect(evenings.every((each) => !each.exited)).toBe(true)

    // 'Restart Jarvis', the first of its buttons.
    pressInDialog(afternoon.pid, 0)

    expect(await until(() => afternoon.exited, { timeout: 20_000 })).toBe(true)
    // One evening launch takes the lock and is Jarvis; the other is answered
    // by it with a window, and leaves.
    expect(await until(() => evenings.filter((each) => each.exited).length === 1, { timeout: 30_000 })).toBe(true)
    const [winner] = evenings.filter((each) => !each.exited)
    const loser = evenings.find((each) => each.exited)
    expect(loser.exitCode).toBe(0)
    expect(await until(() => mainProcesses(run.profile).length === 1, { timeout: 15_000 })).toBe(true)
    expect(mainProcesses(run.profile)).toEqual([winner.pid])
    expect(winner.output).toContain('this one is starting')
    expect(await reaches(environment(`evening-${evenings.indexOf(winner)}`).JARVIS_PIPE)).toBe(true)
    expect(dialogsOf(winner.pid)).toEqual([])
  })
})
