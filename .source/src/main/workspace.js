'use strict'

// A Jarvis window: the terminal, the Jarvis panel on whichever side the user put
// it, and the Settings sheet over the panel. One window per Session, so several
// projects run side by side, each in its own window with its own terminal, panel
// and settings.
//
// The panes are separate WebContentsViews rather than one page, and deliberately
// so: each keeps its own preload, its own `window.jarvis`, and its own stylesheet.
// Inside one window a click moves focus, so the panel hands it straight back —
// see the window's focusTerminal and the panel renderer's mouseup.
//
// Where the panes land is not worked out here. That is arithmetic, and it lives
// in the core as `geometry.js` so it can be tested instead of dragged at; this
// file holds the live answer and hands it to setBounds.

const path = require('node:path')
const { BrowserWindow, WebContentsView } = require('electron')
const { appIcon } = require('./icon')
const geometry = require('../core/geometry')
const preferences = require('./preferences')

const WIDTH = 1240
const HEIGHT = 780

/**
 * The ground each theme paints on, in the two roles the panes use. Repeated from
 * the stylesheet on purpose: this colour is painted by the compositor before any
 * page has loaded, and a pane that flashes the wrong ground on every theme change
 * is the one thing a theme switch must not do.
 */
const GROUNDS = {
  dark: { bg: '#1d2d3d', surface: '#2c455d' },
  light: { bg: '#f2f2f3', surface: '#e9e9ea' },
  iron: { bg: '#14090b', surface: '#241114' },
}

function paneFor(preload, page) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', preload),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  view.webContents.loadFile(path.join(__dirname, '..', 'renderer', page))
  return view
}

/**
 * The shape a new window opens at.
 *
 * Read once, here, rather than threaded in: a window that cannot reach the
 * preferences file still has to open, so an unreadable one falls back to the
 * defaults rather than taking the app down with it.
 */
function storedShape() {
  let stored
  try {
    stored = preferences.read()
  } catch {
    // A window that cannot reach the file still has to open. The defaults come
    // from preferences rather than being spelt again here, so a default changed
    // there reaches the one case nobody is watching.
    stored = preferences.DEFAULTS
  }
  return {
    position: stored.panelPosition,
    collapsed: stored.panelCollapsed,
    width: stored.railWidth,
    band: stored.bandHeight,
  }
}

/**
 * Creates one window and its three panes, and returns a handle to drive it.
 *
 * @param onFocus called when the window gains focus — the registry uses it to
 *                point the shared microphone at this Session.
 */
function createWindow({ onFocus } = {}) {
  let currentTheme = 'dark'
  let ground = GROUNDS.dark
  let settingsOpen = false

  const shape = storedShape()
  let position = shape.position
  let collapsed = shape.collapsed
  /**
   * The measure the user asked for, one per axis.
   *
   * Two numbers rather than one, because a rail dragged to 480 and a band
   * dragged to 200 are different answers to different questions: sending the
   * panel round the cycle and back must return the rail to 480, not to whatever
   * the band was last set to.
   *
   * And what is kept is the measure *asked for*, not the measure granted: a
   * window too narrow to afford it gives the terminal its floor first, and
   * widening the window later hands the panel back what it had.
   */
  const wanted = { side: shape.width, band: shape.band }

  const workspace = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 720,
    minHeight: 420,
    title: 'Jarvis',
    icon: appIcon(),
    show: false,
    backgroundColor: ground.bg,
  })
  workspace.setMenuBarVisibility(false)

  const terminalView = paneFor('terminal.js', 'terminal.html')
  const settingsView = paneFor('settings.js', 'settings.html')
  const panelView = paneFor('panel.js', 'panel.html')
  workspace.contentView.addChildView(terminalView)
  workspace.contentView.addChildView(panelView)
  // Last, so it is drawn on top of the panel it covers.
  workspace.contentView.addChildView(settingsView)
  settingsView.setVisible(false)

  function paintGround(theme) {
    if (theme) currentTheme = theme
    ground = GROUNDS[currentTheme] ?? GROUNDS.dark
    if (!workspace.isDestroyed()) workspace.setBackgroundColor(ground.bg)
    terminalView.setBackgroundColor(ground.bg)
    panelView.setBackgroundColor(ground.surface)
    settingsView.setBackgroundColor(ground.surface)
  }

  /** Which of the two wanted measures is the one in play right now. */
  function axis() {
    return geometry.isSide(position) ? 'side' : 'band'
  }

  function layOut() {
    if (workspace.isDestroyed()) return
    const { width, height } = workspace.getContentBounds()

    const places = geometry.layOut({
      width,
      height,
      position,
      collapsed,
      wanted: wanted[axis()],
      settingsOpen,
    })

    terminalView.setBounds(places.terminal)
    panelView.setBounds(places.panel)
    settingsView.setBounds(places.settings)
  }

  paintGround()
  layOut()

  workspace.on('resize', layOut)
  workspace.on('maximize', layOut)
  workspace.on('unmaximize', layOut)
  if (typeof onFocus === 'function') workspace.on('focus', () => onFocus())

  // The window has no page of its own — both panes are child views — so
  // `ready-to-show` never fires. The Jarvis pane's first paint is when to show.
  panelView.webContents.once('did-finish-load', () => {
    if (!workspace.isDestroyed()) workspace.show()
  })

  // Closing a window closes its Session; the registry tears it down on 'closed'.

  function panelContents() {
    if (panelView.webContents.isDestroyed()) return null
    return panelView.webContents
  }
  function terminalContents() {
    if (terminalView.webContents.isDestroyed()) return null
    return terminalView.webContents
  }
  function settingsContents() {
    if (settingsView.webContents.isDestroyed()) return null
    return settingsView.webContents
  }

  function focusTerminal() {
    if (!terminalView.webContents.isDestroyed()) terminalView.webContents.focus()
  }

  function show() {
    if (workspace.isDestroyed()) return
    workspace.show()
    focusTerminal()
  }
  function hide() {
    if (!workspace.isDestroyed()) workspace.hide()
  }

  function dimTerminal(dimmed) {
    const contents = terminalContents()
    if (contents) contents.send('terminal:dim', dimmed)
  }

  function showSettings() {
    settingsOpen = true
    settingsView.setVisible(true)
    dimTerminal(true)
    layOut()
    if (!settingsView.webContents.isDestroyed()) settingsView.webContents.focus()
  }
  function hideSettings() {
    settingsOpen = false
    settingsView.setVisible(false)
    dimTerminal(false)
    layOut()
    focusTerminal()
  }

  /**
   * The panel, dragged from its own inner edge. The clamp is here rather than in
   * the renderer for one reason: this is the side that knows the terminal's
   * floor, and the renderer must not be the thing deciding how small the
   * terminal may get.
   */
  function resizePanel(measure) {
    if (!Number.isFinite(measure)) return
    wanted[axis()] = geometry.clampMeasure(position, measure)
    layOut()
  }

  /** Which side the panel is on, and how thick it is there — what the renderer
   * needs to draw itself, and what the app model writes down. */
  function panelShape() {
    return { position, collapsed, measure: wanted[axis()] }
  }

  function setPanelPosition(next) {
    position = geometry.isPosition(next) ? next : position
    layOut()
    return panelShape()
  }

  function setPanelCollapsed(shut) {
    collapsed = Boolean(shut)
    layOut()
    return panelShape()
  }

  function toggleSettings() {
    if (settingsOpen) hideSettings()
    else showSettings()
  }

  function nameProject(projectName) {
    if (workspace.isDestroyed()) return
    workspace.setTitle(projectName ? `Jarvis — ${projectName}` : 'Jarvis')
  }

  function ownsContents(webContents) {
    return (
      webContents === panelView.webContents ||
      webContents === terminalView.webContents ||
      webContents === settingsView.webContents
    )
  }

  return {
    window: () => workspace,
    panelContents,
    terminalContents,
    settingsContents,
    ownsContents,
    paintGround,
    layOut,
    resizePanel,
    panelShape,
    setPanelPosition,
    setPanelCollapsed,
    focusTerminal,
    show,
    hide,
    showSettings,
    hideSettings,
    toggleSettings,
    nameProject,
  }
}

module.exports = { createWindow }
