'use strict'

// The Jarvis mark, for the places the system draws it: the window, the taskbar,
// the installer and the tray.
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
 * The notification area takes the 32-point mark as it is.
 */
function trayIcon() {
  if (!cachedTray) cachedTray = nativeImage.createFromPath(path.join(FOLDER, files.TRAY))
  return cachedTray
}

module.exports = { appIcon, trayIcon }
