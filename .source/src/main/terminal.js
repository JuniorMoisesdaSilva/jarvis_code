'use strict'

// The Terminal channel: Jarvis starts the shell itself and renders it in the
// left-hand pane of a window. See Docs/decisions/0002-jarvis-hosts-the-terminal.md —
// this is what lets dictated text and Command shortcuts reach the input line
// without simulating a single keystroke.
//
// One channel per Session. Each window has its own, so several projects can run
// at once without their shells crossing wires. The pane outlives any one project
// and is reset between them.

const pty = require('node-pty')
const { argumentsFor } = require('./shell-arguments')
const { forShell } = require('./shell-environment')
const { typeable } = require('../core/typed-text')

/**
 * A Terminal channel bound to one window's terminal pane.
 *
 * @param getContents a function returning that pane's webContents, or null when
 *                    the pane is gone. Passed rather than captured so the channel
 *                    follows the pane across reloads.
 */
function createTerminal(getContents) {
  let shellProcess = null
  let exitHandler = null

  /**
   * The shell starts talking before the pane can listen. Everything it says in
   * that first moment — the prompt, the encoding preamble — is held here, or the
   * Session opens on a blank screen until the user presses a key.
   */
  let pending = []
  let rendererReady = false

  /**
   * The pane's measurement of itself, kept whether or not there is a shell to
   * hand it to.
   *
   * The pane measures as soon as its page is up, which is long before a project
   * is chosen, and it only measures again when something changes its shape. A
   * measurement that arrived with no shell used to be dropped, so every first
   * shell of a Session started at this guess and stayed there — Claude Code
   * drawing a screen of a different size to the one on display, its status line
   * and prompt falling off the bottom edge, until the window was resized by
   * hand. The guess is only ever used before the pane has said anything.
   */
  let shape = { cols: 120, rows: 30 }

  function deliver(chunk) {
    const contents = getContents()
    if (!contents) return
    contents.send('terminal:data', chunk)
  }

  /** Called when the terminal pane says its renderer is up. Happens once. */
  function markReady() {
    rendererReady = true
    for (const chunk of pending) deliver(chunk)
    pending = []
  }

  function clearPane() {
    const contents = getContents()
    if (contents) contents.send('terminal:reset')
  }

  /**
   * Starts a shell in the project folder.
   *
   * `onExit` is for the shell dying on its own — a surprise worth announcing. The
   * window closing is handled by the window, not here.
   */
  function open({ projectPath, shell, onExit }) {
    close()
    exitHandler = onExit ?? null
    pending = []

    const started = pty.spawn(shell, argumentsFor(shell), {
      name: 'xterm-256color',
      cols: shape.cols,
      rows: shape.rows,
      cwd: projectPath,
      env: { ...forShell(process.env), TERM: 'xterm-256color' },
      useConpty: true,
      // Not cosmetic: the other path forks a helper with our own executable to
      // enumerate console processes, and under Electron that helper starts as a
      // second copy of the app and dies with "AttachConsole failed" every time a
      // Session ends. The bundled library closes the pseudoconsole directly.
      useConptyDll: true,
    })

    shellProcess = started

    started.onData((chunk) => {
      if (rendererReady) deliver(chunk)
      else pending.push(chunk)
    })

    started.onExit(() => {
      // A shell killed to make room for the next one still reports its exit, and
      // it reports it late — by which time `shellProcess` is the next one. Without
      // this guard, opening a second project tore down the session that had just
      // replaced it.
      if (shellProcess !== started) return

      shellProcess = null
      const notify = exitHandler
      exitHandler = null
      if (notify) notify()
    })

    return { projectPath, shell }
  }

  function isAlive() {
    return shellProcess !== null
  }

  /**
   * Types text into the input line and leaves it there.
   *
   * The text is rarely the user's own — the clipboard holds whatever the last
   * page they read put there, a file name in the project is whoever wrote the
   * repository, and a dictation is a recogniser's guess. A carriage return in
   * any of it is the Enter key, so it is taken out here rather than at each of
   * the three callers: `run` is the one path that may submit, and it is the one
   * a person pressed a button for.
   */
  function insert(text) {
    if (!shellProcess) return false
    shellProcess.write(typeable(text))
    return true
  }

  /** Types a command and presses Enter. */
  function run(command) {
    if (!shellProcess) return false
    shellProcess.write(`${command}\r`)
    return true
  }

  /** What the user types in the terminal pane. */
  function typeFromUser(data) {
    if (shellProcess) shellProcess.write(data)
  }

  function resize(cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return
    if (cols < 2 || rows < 2) return
    shape = { cols, rows }
    if (!shellProcess) return
    try {
      shellProcess.resize(cols, rows)
    } catch {
      // The shell can exit between the renderer measuring and this arriving.
    }
  }

  /** Ends the Session's shell, leaving no orphan behind. */
  function close() {
    // Cleared first: closing on purpose is not a surprise to report.
    exitHandler = null
    pending = []

    if (shellProcess) {
      const closing = shellProcess
      shellProcess = null
      try {
        closing.kill()
      } catch {
        // Already gone.
      }
    }

    // The pane keeps the last screen otherwise, which reads as a live session.
    clearPane()
  }

  return {
    open,
    close,
    insert,
    run,
    typeFromUser,
    resize,
    isAlive,
    markReady,
  }
}

module.exports = { createTerminal }
