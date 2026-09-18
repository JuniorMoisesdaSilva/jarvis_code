'use strict'

// What may be typed into a shell's input line without pressing anything.
//
// A pure function: text in, text out, no state and no side effects. It exists
// because a carriage return written to a pseudo-terminal is not a character —
// it is the Enter key. Everything the rest of the app calls "typing" goes
// through here first, so that the promise made in several places at once
// ("submitting is always the user's act") is kept in one.

/**
 * A line break is Enter. It becomes a space rather than being dropped, so two
 * lines of a pasted command stay two words and not one run-on one.
 */
const BREAKS = /\r\n|\r|\n/g

/**
 * The rest of the control characters, tab and escape among them: a tab at a
 * prompt is completion, and an escape begins a sequence the shell will act on.
 * None of them is something a person meant to type.
 */
const CONTROLS = /[\u0000-\u001f\u007f]/g

/**
 * The typeable form of some text.
 *
 * Bracketed paste is the other answer to this and it is not one here: it only
 * protects where the program in front has asked for it, and from this side of
 * the pty Jarvis cannot see whether it has.
 */
function typeable(text) {
  return String(text ?? '')
    .replace(BREAKS, ' ')
    .replace(CONTROLS, '')
}

module.exports = { typeable }
