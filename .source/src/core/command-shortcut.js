'use strict'

// A button that types a ready-made command into the Terminal channel.
//
// The point is speed, so by default a shortcut also presses Enter for you. That
// is the opposite of what Dictation does, and deliberately so: dictated text is
// a guess by a recognition engine, while a Command shortcut is a command you
// wrote down yourself and can read on the button.

const { randomUUID } = require('node:crypto')
const { COMMAND_GLYPH, SKILL_GLYPH, cleanGlyph } = require('./button-look')

/**
 * A Command shortcut. Its `glyph` is the icon on its button: one of the names
 * in button-look.js, or null for none; a new one carries `terminal-window`.
 */
function shortcut({ id = randomUUID(), label, command, submits = true, glyph = COMMAND_GLYPH }) {
  return { id, label, command, submits, glyph: cleanGlyph(glyph) }
}

/**
 * A Skill shortcut: the same shape as a Command shortcut, but it does not submit
 * by default. A skill is invoked by a command the user wrote down (say
 * `/wayfinder`), and leaving the Enter to them is deliberate — a skill often
 * takes an argument typed after it, and pressing Enter too early would run it
 * bare. Skills ship none by default; the list starts empty and the user fills it.
 */
function skill({ id = randomUUID(), label, command, submits = false, glyph = SKILL_GLYPH }) {
  return { id, label, command, submits, glyph: cleanGlyph(glyph) }
}

/**
 * What the Panel ships with. Two kinds are mixed on purpose, because to the
 * terminal they are the same thing: shell commands that start or update Claude
 * Code, and slash commands that only mean something once it is running.
 *
 * Their identifiers are fixed rather than generated: a built-in button that
 * changed identity on every launch could not be reordered, replaced or
 * recognised as the same button across restarts.
 */
const BUILT_IN = Object.freeze([
  { id: 'built-in-claude', label: 'Claude', command: 'claude', glyph: 'terminal-window' },
  { id: 'built-in-continue', label: 'Continue', command: 'claude --continue', glyph: 'play' },
  { id: 'built-in-resume', label: 'Resume', command: 'claude --resume', glyph: 'clock-counter-clockwise' },
  { id: 'built-in-update', label: 'Update', command: 'claude update', glyph: 'arrow-circle-up' },
  { id: 'built-in-usage', label: '/usage', command: '/usage', glyph: 'gauge' },
  { id: 'built-in-context', label: '/context', command: '/context', glyph: 'stack' },
  { id: 'built-in-exit', label: 'Exit', command: 'exit', glyph: 'sign-out' },
])

function defaults() {
  return BUILT_IN.map((each) => shortcut(each))
}

/** True when the value has the three fields a shortcut cannot do without. */
function isShortcut(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.label === 'string' &&
    typeof value.command === 'string' &&
    typeof value.submits === 'boolean'
  )
}

/**
 * Puts a stored shortcut back into shape. An entry saved without an identifier
 * is given one rather than thrown away: losing a button the user wrote is worse
 * than repairing it. Its icon is kept, a name not in button-look.js dropped to
 * none; an entry stored before there were icons at all is given one — a
 * built-in its own, anything else its kind's (`fallback`: a Command's by
 * default, a Skill's when the caller says so).
 */
function repair(value, fallback = COMMAND_GLYPH) {
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : randomUUID()
  const glyph = 'glyph' in value ? value.glyph : (BUILT_IN.find((each) => each.id === id)?.glyph ?? fallback)
  return shortcut({ id, label: value.label, command: value.command, submits: value.submits, glyph })
}

module.exports = { shortcut, skill, defaults, isShortcut, repair }
