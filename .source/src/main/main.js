'use strict'

const { app, dialog, Menu, Tray, ipcMain } = require('electron')

const hooks = require('./hooks')
const { createHandover } = require('../core/second-launch')

// Helper mode has to be decided before anything else starts. Claude Code runs
// this on every event it reports, and it must not open a window, take a
// single-instance lock, or keep the agent waiting.
if (hooks.isHelperLaunch()) {
  hooks.runAsHelper()
} else {
  main()
}

function main() {
  const preferences = require('./preferences')
  const dictation = require('./dictation')
  const sessions = require('./sessions')
  const { trayIcon } = require('./icon')

  let tray = null

  // One process holds the single hook channel and brokers the shared microphone
  // and voice. A second launch does not start its own copy — it asks the running
  // one to open another window. It says what code it carries, because the
  // running one may be older: closing the window leaves Jarvis in the tray, and
  // a launch of code that has moved on since must not be answered by the code
  // it replaced. Then the running one makes way and quits, and this launch —
  // still waiting — takes the lock and starts as itself, with its own
  // environment, folder and console (src/core/second-launch.js, ADR 0013).
  const build = require('./build')
  const handover = createHandover({ build: build.current() })
  const { takeLock, writeAnswer } = require('./handover')

  app.on('second-instance', (_event, _argv, _directory, arriving) => onSecondLaunch(arriving))
  takeLock(build.current()).then((held) => {
    if (held) app.whenReady().then(start)
    else app.exit(process.exitCode ?? 0)
  })

  function onSecondLaunch(arriving) {
    carryOut(handover.arrive({ arriving, windowsOpen: sessions.count() }))
  }

  function carryOut({ act, tell }) {
    for (const { to, answer } of tell) writeAnswer(to, answer)
    if (act === 'open') sessions.openWindow()
    else if (act === 'keep') sessions.showOrOpen()
    else if (act === 'ask') ask()
    else if (act === 'make-way') {
      console.log('Jarvis: a launch of newer code arrived; this Jarvis is making way for it.')
      // Not from inside the handler: the launch is still waiting to hear that
      // its message was received, and a Jarvis that quits before answering
      // leaves it hanging.
      setTimeout(() => app.quit(), 500)
    }
  }

  /**
   * Asks whether to restart, over the window the user was last in, brought to
   * the front — a question that appears behind everything is a launch that
   * seems to have done nothing.
   */
  function ask() {
    const session = sessions.focused()
    const parent = session?.handle.window()
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      session.handle.show()
      parent.focus()
    }
    const question = {
      type: 'question',
      buttons: ['Restart Jarvis', 'Keep this one'],
      defaultId: 0,
      cancelId: 1,
      title: 'Jarvis',
      message: 'Jarvis was started again, and its code has changed since this one began.',
      detail:
        'Restarting runs the new code. It closes these windows and the terminals in them, ' +
        'and anything running in those terminals with them.',
    }
    const shown = parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, question) : dialog.showMessageBox(question)
    shown
      .then(({ response }) => carryOut(handover.answer(response === 0)))
      .catch(() => carryOut(handover.answer(false)))
  }

  function start() {
    app.setAppUserModelId('com.jarvis.app')
    // Before anything listens: a settings file still naming an older Jarvis has
    // Claude Code starting the whole app on every event, which is slow enough
    // that the end of a session is cancelled mid-flight and the terminal prints
    // a hook failure instead of a goodbye. Nothing is installed here — only a
    // hook already there is brought up to date.
    //
    // Assembled only. Run from source the launcher names an Electron inside
    // node_modules, and quietly pointing the machine's hooks at a checkout
    // would take the real Jarvis's events away for as long as it lives. A
    // developer who wants that can press Connect.
    if (app.isPackaged) hooks.upgradeInstalledHooks()
    // The style file follows Brain the same way, on every start: a copy left
    // behind by an older Jarvis, or one the host had before Connect, is how the
    // Plan went silent.
    require('./claude-config').refreshPlacedFiles(preferences.read().language)
    registerChannels()
    sessions.start()
    createTray()

    // Clicking the dock/taskbar with no window open opens a fresh one.
    app.on('activate', () => {
      if (sessions.count() === 0) sessions.openWindow()
      else sessions.showOrOpen()
    })
  }

  function createTray() {
    tray = new Tray(trayIcon())
    tray.setToolTip('Jarvis')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Jarvis', click: () => sessions.showOrOpen() },
        { label: 'New window', click: () => sessions.openWindow() },
        { type: 'separator' },
        { label: 'Quit Jarvis', click: () => quit() },
      ]),
    )
    tray.on('click', () => sessions.showOrOpen())
  }

  /** The Session that sent an IPC message, by its pane; the focused one if the
   * sender is not a Session pane (the shared microphone window). */
  function senderSession(event) {
    return sessions.sessionForContents(event.sender) ?? sessions.focused()
  }

  function actOn(event, name, argument) {
    const session = senderSession(event)
    const action = session?.actions?.[name]
    if (typeof action === 'function') action(argument)
    // A page asking for an action this process does not have is a page newer
    // than the process — the one way the two can disagree. Said, not swallowed.
    else if (session) console.warn(`Jarvis: the page asked for "${name}", which this Jarvis does not have.`)
  }

  /**
   * The same, for what a terminal pane sends — and only ever into that pane's
   * own Session. A pane outlives its window's closing by a moment, and a paste
   * sent in that moment would otherwise land in whichever window took focus,
   * still carrying the closed pane's word on bracketed paste.
   */
  function actOnPane(event, name, argument) {
    const action = sessions.sessionForContents(event.sender)?.actions?.[name]
    if (typeof action === 'function') action(argument)
  }

  function registerChannels() {
    // From the Jarvis pane — routed to the Session that owns it.
    ipcMain.on('panel:open-settings', (event) => actOn(event, 'toggleSettings'))
    ipcMain.on('settings:close', (event) => actOn(event, 'closeSettings'))
    ipcMain.on('panel:action', (event, name, argument) => actOn(event, name, argument))
    ipcMain.on('panel:release-focus', (event) => actOn(event, 'releaseFocus'))
    ipcMain.on('voice:at', (event, where) => actOn(event, 'voiceAt', where))
    ipcMain.on('voice:ended', (event) => actOn(event, 'voiceEnded'))

    // From the terminal pane.
    ipcMain.on('terminal:ready', (event) => actOnPane(event, 'terminalReady'))
    ipcMain.on('terminal:input', (event, data) => actOnPane(event, 'terminalInput', data))
    ipcMain.on('terminal:resize', (event, size) => actOnPane(event, 'terminalResize', size))
    ipcMain.on('terminal:copy', (event, text) => actOnPane(event, 'copySelection', text))
    ipcMain.on('terminal:paste', (event, paste) => actOnPane(event, 'pasteFromTerminal', paste))

    // From the shared microphone window. Ready and audio drive the one shared
    // engine; a denial is reported into whichever Session is listening.
    ipcMain.on('microphone:ready', () => dictation.markReady())
    ipcMain.on('microphone:audio', (_event, buffer) => dictation.collect(buffer))
    ipcMain.on('microphone:denied', () => sessions.micOwner()?.actions.microphoneDenied())

    // Questions a pane can ask. State is the sender's own; the lists and voices
    // are the same for every window.
    ipcMain.handle('preferences:read', () => preferences.read())
    ipcMain.handle('preferences:write', (_event, patch) => {
      const written = preferences.write(patch)
      sessions.reloadAll()
      return written
    })
    ipcMain.handle('state:read', (event) => senderSession(event)?.actions.state() ?? {})
    ipcMain.handle('voices:read', (event) => senderSession(event)?.actions.voicesWhenKnown() ?? [])
    ipcMain.handle('models:read', () => require('./models').MODELS)
    ipcMain.handle('shortcuts:read', () => preferences.store().shortcuts())
    ipcMain.handle('shortcuts:write', (_event, list) => {
      preferences.store().setShortcuts(list)
      sessions.reloadAll()
      return preferences.store().shortcuts()
    })
    ipcMain.handle('skills:read', () => preferences.store().skills())
    ipcMain.handle('skills:write', (_event, list) => {
      preferences.store().setSkills(list)
      sessions.reloadAll()
      return preferences.store().skills()
    })

    // Connect has two halves — reporting (hooks) and personality (config). It
    // shows "connected" only when both are in place, but offers Disconnect
    // whenever either is, so a half-done Connect can be undone. The change is
    // global, so every open window is refreshed.
    const connectionState = (event) => {
      const state = senderSession(event)?.actions.state() ?? {}
      return {
        hooks: Boolean(state.hooksInstalled),
        config: Boolean(state.claudeApplied),
        stale: Boolean(state.hooksStale),
        elsewhere: typeof state.hooksElsewhere === 'string' ? state.hooksElsewhere : null,
        problem: typeof state.connectionProblem === 'string' ? state.connectionProblem : null,
      }
    }
    ipcMain.handle('hooks:state', (event) => {
      actOn(event, 'refreshHookState')
      return connectionState(event)
    })
    ipcMain.handle('hooks:install', (event) => {
      actOn(event, 'installHooks')
      return connectionState(event)
    })
    ipcMain.handle('hooks:remove', (event) => {
      actOn(event, 'removeHooks')
      return connectionState(event)
    })
  }

  function quit() {
    app.quit()
  }

  // Closing every window does not quit Jarvis. It stays up to receive the events
  // Claude Code sends, and the tray icon opens a window again.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => sessions.shutdown())
}
