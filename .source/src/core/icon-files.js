'use strict'

// Which icon file goes where.
//
// It lives in the core, away from Electron, so that the three places which have
// to agree — the app, the packaging script and the test — can read the same
// answer instead of each spelling the filename out again. A filename that is
// right in two of them and wrong in the third does not fail: Windows shows a
// blank square, or nothing at all in the notification area, and says nothing
// about why. That is a bad thing to leave to three separate string literals.

const path = require('node:path')

/** Where the icon files live, from the repository root. */
const FOLDER = path.join('assets', 'icons')

/**
 * The one theme the operating system draws.
 *
 * It cannot follow the theme chosen inside the app — Windows knows nothing
 * about that, and the taskbar entry has to look the same before Jarvis has
 * started as after. Iron, chosen on 2 September 2026: gold on near-black, which
 * carries against a light and a dark taskbar as well as the purple did, and is
 * the one the user wanted to be greeted by.
 */
const THEME = 'iron'

/**
 * The window, the taskbar, the shortcut and the installer. Seven sizes inside
 * one file, so Windows picks its own rather than scaling a single image; and
 * the mark sits on a plate here, because every one of those places wants a
 * filled square rather than a shape floating in nothing.
 */
const APP = `jarvis-${THEME}.ico`

/**
 * The notification area, which will not take an SVG and wants a small raster.
 * 32 rather than 16: Windows scales that down cleanly, where it makes a mess of
 * scaling 256 down. The bare mark, not the plate — the tray is the one place a
 * plate would look like a button.
 */
const TRAY = path.join('png', `jarvis-${THEME}-32.png`)

module.exports = { FOLDER, THEME, APP, TRAY }
