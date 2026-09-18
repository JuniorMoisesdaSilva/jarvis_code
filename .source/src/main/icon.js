'use strict'

// The Jarvis mark, for the places the system draws it: the window, the taskbar,
// the installer and the tray on Windows, and the Dock on macOS.
//
// It used to be drawn pixel by pixel in JavaScript — a placeholder microphone,
// encoded to a PNG at run time — so that the repository carried no opaque
// binary. That bought one real thing: nothing was ever read from disk, so the
// packaged archive never came into it. Real icon files cost that back, and the
// answer is the same one the speech host and the Whisper worker already use:
// the folder is unpacked beside the archive, and `onDisk` points at it.
//
// It has to be, too. Windows opens these files itself — the taskbar, the shell
// drawing a shortcut — and none of that knows what an archive is. Left packed,
// the icon is simply absent in a built app, with nothing said anywhere about
// why. `**/assets/icons/**` in `MUST_BE_ON_DISK` is what keeps it out.

const path = require('node:path')
const { nativeImage } = require('electron')
const { onDisk } = require('./unpacked')
const files = require('../core/icon-files')

const FOLDER = onDisk(path.join(__dirname, '..', '..', files.FOLDER))

let cachedTray = null
let cachedDock = null

/**
 * The window, taskbar and installer icon, as a path rather than an image.
 *
 * Handing Electron the path to the `.ico` is what lets Windows pick its own
 * size from the seven inside — the taskbar wants one, the alt-tab list another,
 * a shortcut a third. Loading it into a single `nativeImage` first would flatten
 * all seven into whichever one that call happened to choose.
 */
function appIcon() {
  return path.join(FOLDER, files.APP)
}

/**
 * The tray icon, which unlike the window's is an image and not a path.
 *
 * Windows' notification area takes the 32-point mark as it is. The macOS menu
 * bar is 22 points tall and does not scale to fit: handed a 32, it draws a 32
 * and the row grows around it. So it is resized here, to 18, which is the height
 * the system's own icons use.
 */
function trayIcon() {
  if (!cachedTray) {
    const mark = nativeImage.createFromPath(path.join(FOLDER, files.TRAY))
    cachedTray = process.platform === 'darwin' ? mark.resize({ height: 18 }) : mark
  }
  return cachedTray
}

/**
 * The Dock icon, applied at run time.
 *
 * An assembled `Jarvis.app` carries its own `.icns` and needs none of this. Run
 * from the source it is Electron's own bundle on screen, named and drawn as
 * Electron — so the mark is set here instead, the same way ADR-0011 has the
 * Windows icon applied at run time rather than written into the executable.
 */
function dockIcon() {
  if (!cachedDock) cachedDock = nativeImage.createFromPath(path.join(FOLDER, files.DOCK))
  return cachedDock
}

module.exports = { appIcon, trayIcon, dockIcon }
