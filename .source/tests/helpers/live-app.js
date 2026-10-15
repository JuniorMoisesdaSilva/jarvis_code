// The real Jarvis, started for a test: main.js, its windows, its preload and
// its IPC — nothing injected — on a home, a data folder and a profile of its
// own, so nothing it writes can reach the developer's Claude Code or their
// Jarvis. Driven over the DevTools protocol, the way a person drives it: by
// clicking the buttons on the page.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { electronBinary } from './electron-path.js'

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A Jarvis folder of its own: the marker, the Brain, and a `.source` with this
 * checkout's code copied in (so a test may change it under a running app) and
 * its `node_modules` linked rather than copied.
 */
export function makeFolder(root) {
  const folder = path.join(root, 'folder')
  const source = path.join(folder, '.source')
  fs.mkdirSync(source, { recursive: true })
  fs.copyFileSync(path.join(SOURCE, '..', '.jarvis-root'), path.join(folder, '.jarvis-root'))
  fs.cpSync(path.join(SOURCE, '..', 'Brain'), path.join(folder, 'Brain'), { recursive: true })
  fs.copyFileSync(path.join(SOURCE, 'package.json'), path.join(source, 'package.json'))
  fs.cpSync(path.join(SOURCE, 'src'), path.join(source, 'src'), { recursive: true })
  fs.cpSync(path.join(SOURCE, 'assets'), path.join(source, 'assets'), { recursive: true })
  fs.symlinkSync(path.join(SOURCE, 'node_modules'), path.join(source, 'node_modules'), 'junction')
  return { folder, source }
}

/** The environment that keeps a run to `root`: its own home, data folder and hook channel. */
export function isolated(root) {
  const home = path.join(root, 'home')
  const data = path.join(root, 'data')
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(data, { recursive: true })
  return {
    home,
    data,
    profile: path.join(root, 'profile'),
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      JARVIS_DATA_DIR: data,
      JARVIS_PIPE: `\\\\.\\pipe\\jarvis-hook-test-${process.pid}-${path.basename(root)}`,
    },
  }
}

/**
 * Starts Jarvis from `source` with a DevTools port; the child process is
 * returned, with what it printed to its console gathered in `output`.
 */
export function launch({ source, port, profile, env }) {
  const child = spawn(electronBinary(), [source, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.output = ''
  child.exited = false
  child.stdout.on('data', (chunk) => (child.output += chunk))
  child.stderr.on('data', (chunk) => (child.output += chunk))
  child.on('exit', () => (child.exited = true))
  return child
}

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 60_000 })
}

/** The Jarvis main processes using `profile`: Electron processes with no `--type`. */
export function mainProcesses(profile) {
  const out = powershell(
    `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' -and $_.CommandLine -notlike '*--type=*' } | ` +
      `ForEach-Object { $_.ProcessId }`,
  )
  return out
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
}

/** Whether something answers on the named pipe `address`. */
export function reaches(address) {
  return new Promise((resolve) => {
    const socket = net.connect(address)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

const UIA =
  'Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; ' +
  '$A = [System.Windows.Automation.AutomationElement]; ' +
  '$P = [System.Windows.Automation.PropertyCondition]; '

function dialogsScript(pid) {
  return (
    UIA +
    `$mine = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object $P($A::ProcessIdProperty, ${pid}))); ` +
    `$found = @(); foreach ($w in $mine) { $found += @($w.FindAll([System.Windows.Automation.TreeScope]::Subtree, (New-Object $P($A::ClassNameProperty, '#32770')))) }; `
  )
}

/**
 * The message boxes the process `pid` has up, each with the window it is
 * parented to (`parent` is the desktop's class, `#32769`, for one parented to
 * nothing).
 */
export function dialogsOf(pid) {
  const out = powershell(
    dialogsScript(pid) +
      '$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker; ' +
      '$list = @($found | ForEach-Object { $p = $walker.GetParent($_); @{ name = $_.Current.Name; parent = $p.Current.ClassName; parentName = $p.Current.Name } }); ' +
      'ConvertTo-Json -InputObject $list -Compress',
  ).trim()
  return out === '' ? [] : JSON.parse(out)
}

/** Presses a button, by its place in the order the dialog was given them, in the message box the process `pid` has up. */
export function pressInDialog(pid, buttonIndex) {
  powershell(
    dialogsScript(pid) +
      // Electron draws its buttons as a task dialog's command links, which UI
      // Automation can see but not press. The dialog itself can be told to
      // press one: TDM_CLICK_BUTTON, with the id Electron gives the button —
      // 100 for the first, and so on.
      `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'; ` +
      `[void][W.U]::PostMessage([System.IntPtr]$found[0].Current.NativeWindowHandle, 0x466, [System.IntPtr]${100 + buttonIndex}, [System.IntPtr]::Zero)`,
  )
}

export async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    return await response.json()
  } catch {
    return []
  }
}

/** Waits for a page whose address ends in `page`, and not one in `except`. */
export async function waitForPage(port, page, { except = [], timeout = 30_000 } = {}) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const found = (await targets(port)).find((t) => t.url.endsWith(page) && !except.includes(t.id))
    if (found) return found
    await sleep(250)
  }
  throw new Error(`no ${page} within ${timeout} ms`)
}

/** A DevTools connection to one page, with `evaluate` and the page's own exceptions. */
export async function attach(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const exceptions = []
  let next = 0
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    } else if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
  }
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++next
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  return {
    exceptions,
    async evaluate(expression) {
      const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'threw')
      return result?.result?.value
    },
    close: () => socket.close(),
  }
}

/** Polls `check` until it returns something truthy. */
export async function until(check, { timeout = 15_000, every = 200 } = {}) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    last = await check()
    if (last) return last
    await sleep(every)
  }
  return last
}

/** Ends every Electron process still using `profile` — a relaunched one is no child of the test. */
export function endAll(profile) {
  const script =
    `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30_000 })
  } catch {
    // Already gone.
  }
}

export const temporaryRoot = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-${name}-`))
