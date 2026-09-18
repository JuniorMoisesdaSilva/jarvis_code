'use strict'

// Where the two panes end up, as arithmetic over a window size.
//
// It lives in the core, away from the window that applies it, for the reason
// everything else here does: it is pure logic, so it can be tested rather than
// checked by dragging an edge and squinting at the result. And it is the part
// that can be wrong invisibly — a terminal one row short still reads as a
// terminal, which is exactly how `Docs/history/the-cut-off-terminal` happened.
//
// One vocabulary throughout: the panel is on a **side** (left or right), where
// it is measured by width, or along an **edge** (top or bottom), where it is a
// band measured by height. Everything that differs between the two differs only
// because of which axis is the scarce one.

/** The cycle the mover button walks, in the order the arrow reads. */
const POSITIONS = Object.freeze(['left', 'top', 'right', 'bottom'])

/** The rail's width, and where it starts. The footer's controls were measured
 * for exactly this much, so it is also the narrowest the rail goes; dragging
 * its edge only ever buys room for longer command labels. */
const RAIL = 316
const RAIL_MAX = 520

/** A band's height. 148 is what the three rows of buttons, the dock and a
 * two-line footer come to; below it a row would be cut rather than dropped. */
const BAND = 148
const BAND_MAX = 300

/** Retracted: the icons and nothing else, on whichever axis is the smaller. */
const COLLAPSED = 52

/** Below this the terminal stops being usable, so the panel gives way first. */
const TERMINAL_FLOOR = 260

/** The Settings sheet, when it is open. Wide enough for its text fields. */
const SETTINGS = 396

function isPosition(value) {
  return POSITIONS.includes(value)
}

function isSide(position) {
  return position === 'left' || position === 'right'
}

/** Anything that is not one of the four lays out where the panel has always
 * been. A stored position is checked in preferences; this is for the callers
 * that have not been through it. */
function settle(position) {
  return isPosition(position) ? position : 'right'
}

/** The measure a panel opens at on this axis. */
function defaultMeasure(position) {
  return isSide(settle(position)) ? RAIL : BAND
}

/**
 * The measure held inside what that axis allows.
 *
 * Rounded, because a pane cannot be laid out on half a point, and defaulted
 * rather than passed through when the number is not one: a drag that reports
 * NaN would otherwise collapse the panel to nothing on the next frame.
 */
function clampMeasure(position, value) {
  const settled = settle(position)
  if (!Number.isFinite(value)) return defaultMeasure(settled)
  const [least, most] = isSide(settled) ? [RAIL, RAIL_MAX] : [BAND, BAND_MAX]
  return Math.max(least, Math.min(most, Math.round(value)))
}

function nextPosition(position) {
  const at = POSITIONS.indexOf(settle(position))
  return POSITIONS[(at + 1) % POSITIONS.length]
}

/**
 * Where the terminal, the panel and the Settings sheet go.
 *
 * `wanted` is the measure the user asked for and is never written back: what a
 * narrow window grants is a smaller panel, not a smaller request, so widening
 * the window later hands the panel back what it had. That is 0018's rule, kept
 * as the panel learned to move.
 */
function layOut({
  width,
  height,
  position,
  wanted,
  collapsed = false,
  settingsOpen = false,
} = {}) {
  const settled = settle(position)
  const side = isSide(settled)

  // The axis the panel is measured on, and the room there is along it.
  const along = side ? width : height
  const asked = collapsed ? COLLAPSED : clampMeasure(settled, wanted)
  // The floor belongs to the terminal, so the panel is what is cut short.
  const measure = Math.max(0, Math.min(asked, along - TERMINAL_FLOOR))
  const rest = along - measure

  const terminal = { x: 0, y: 0, width, height }
  const panel = { x: 0, y: 0, width, height }

  if (side) {
    terminal.width = rest
    panel.width = measure
    if (settled === 'right') panel.x = rest
    else terminal.x = measure
  } else {
    terminal.height = rest
    panel.height = measure
    if (settled === 'bottom') panel.y = rest
    else terminal.y = measure
  }

  // The sheet keeps its own shape whatever the panel is doing: 396 points wide
  // and the full height is what buys its text fields their width, and a band
  // has nothing that shape to cover. It anchors to the edge the panel is on so
  // it lands over the rail rather than across the window from it.
  const sheet = settingsOpen ? Math.min(SETTINGS, width) : 0
  const settings = {
    x: settled === 'left' ? 0 : width - sheet,
    y: 0,
    width: sheet,
    height,
  }

  return { terminal, panel, settings }
}

module.exports = {
  POSITIONS,
  RAIL,
  RAIL_MAX,
  BAND,
  BAND_MAX,
  COLLAPSED,
  TERMINAL_FLOOR,
  SETTINGS,
  isPosition,
  isSide,
  defaultMeasure,
  clampMeasure,
  nextPosition,
  layOut,
}
