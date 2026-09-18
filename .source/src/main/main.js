'use strict'

const { app, Menu, Tray, ipcMain } = require('electron')

const hooks = require('./hooks')

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
  const { trayIcon, dockIcon } = require('./icon')

  let tray = null

  // One process holds the single hook channel and brokers the shared microphone
  // and voice. A second launch does not start its own copy — it asks the running
  // one to open another window.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => sessions.openWindow())
  app.whenReady().then(start)

  function start() {
    app.setAppUserModelId('com.jarvis.app')
    // Run from the source, the app on screen is Electron's own bundle, so the
    // Dock shows Electron's icon until this replaces it — the same run-time fix
    // ADR-0011 uses on Windows rather than rewriting an executable. What cannot
    // be fixed this way is the menu bar, which macOS titles from the bundle and
    // never asks again: it reads "Electron" until the app is assembled, and
    // `app.setName` does not move it. An assembled Jarvis.app has both right.
    if (process.platform === 'darwin') app.dock?.setIcon(dockIcon())
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
    ipcMain.on('terminal:ready', (event) => actOn(event, 'terminalReady'))
    ipcMain.on('terminal:input', (event, data) => actOn(event, 'terminalInput', data))
    ipcMain.on('terminal:resize', (event, size) => actOn(event, 'terminalResize', size))

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
      return { hooks: Boolean(state.hooksInstalled), config: Boolean(state.claudeApplied) }
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
