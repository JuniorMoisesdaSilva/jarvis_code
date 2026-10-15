'use strict'

// What may be typed into a shell's input line without pressing anything.
//
// A pure function: text in, text out, no state and no side effects. It exists
// because a carriage return written to a pseudo-terminal is not a character —
// it is the Enter key. Everything the rest of the app calls "typing" goes
// through here first, so that the promise made in several places at once
// ("submitting is always the user's act") is kept in one.

/**
 * Every character that ends a line, not only the three a keyboard makes: a
 * PowerPoint soft return is a vertical tab, a form feed is a page break, and
 * U+0085, U+2028 and U+2029 are line and paragraph separators. Each is read as
 * a line break, so none of them glues two words into one.
 */
const BREAKS = /\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029]/g

/** The breaks the text ends on, which nobody meant as anything. */
const TRAILING_BREAKS = /(?:\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029])+$/

/**
 * The rest of the control characters, escape among them, and the 8-bit ones
 * too: some programs read U+009B as escape and open a sequence with it, and on
 * Windows ConPTY turns it into one that can press Enter.
 */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * The typeable form of some text.
 *
 * A line break in the middle becomes a space, so two lines of a pasted command
 * stay two words and not one run-on one. The breaks at the end are dropped: a
 * password copied with its line ending would otherwise gain a space nobody can
 * see, and the prompt would refuse it. A tab is completion at a prompt, so it
 * becomes a space too.
 *
 * Bracketed paste is the other answer to this and it is not one here: it only
 * protects where the program in front has asked for it, and from this side of
 * the pty Jarvis cannot see whether it has. The terminal pane can — see
 * `pasted` below — which is why a paste made there keeps its lines.
 */
function typeable(text) {
  return String(text ?? '')
    .replace(TRAILING_BREAKS, '')
    .replace(BREAKS, ' ')
    .replace(/\t/g, ' ')
    .replace(CONTROLS, '')
}

/**
 * Everything but tab and line feed that is not a letter. Escape is the one that
 * matters: without it the text cannot contain the sequence that ends a paste.
 * The 8-bit controls go too, since some programs read U+009B as escape and
 * bracket together.
 */
const PASTE_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

const OPEN = '\u001b[200~'
const CLOSE = '\u001b[201~'

/**
 * What a paste made in the terminal pane sends to the shell.
 *
 * `bracketed` is whether the program in front asked for bracketed paste, which
 * only xterm, having read everything the program wrote, can say. When it did,
 * the text arrives marked as pasted and the program takes it as text — Claude
 * Code keeps the lines and the tabs, and a line break in it is not Enter. When
 * it did not, a line break is Enter, and the text is flattened as anything else
 * typed is.
 *
 * Inside the markers the text loses every control but tab and line break,
 * escape above all, or a clipboard holding the closing marker would end the
 * paste early and have everything after it typed as keys — Enter included.
 * Every kind of line break becomes a carriage return, as every terminal sends
 * them.
 *
 * An empty paste is still a paste where the program asked for them: Claude
 * Code reads the bare pair of markers as "take the image on the clipboard".
 * Text that was all controls is nothing, and sends nothing.
 */
function pasted(text, bracketed) {
  if (!bracketed) return typeable(text)
  const raw = String(text ?? '')
  if (raw === '') return OPEN + CLOSE
  const inner = raw.replace(BREAKS, '\n').replace(PASTE_CONTROLS, '').replace(/\n/g, '\r')
  return inner === '' ? '' : OPEN + inner + CLOSE
}

module.exports = { typeable, pasted }
