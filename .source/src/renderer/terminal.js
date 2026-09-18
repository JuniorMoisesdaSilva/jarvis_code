'use strict'

/**
 * The three themes, as xterm needs them: literal colours, not custom
 * properties. xterm paints to a canvas, so it cannot read the stylesheet — and
 * a terminal left on the dark ground inside a light window is the one part of
 * the redesign anybody would notice immediately.
 *
 * Each entry is the same four roles the CSS uses: the ground, the text, the
 * accent for the cursor, and the bar track for a selection.
 */
const THEMES = {
  dark: {
    background: '#1d2d3d',
    foreground: '#f2f2f3',
    cursor: '#94bce3',
    selectionBackground: '#416180',
  },
  light: {
    background: '#f2f2f3',
    foreground: '#1d1f20',
    cursor: '#5980a6',
    selectionBackground: '#d4d4d7',
  },
  iron: {
    background: '#14090b',
    foreground: '#f4ece2',
    cursor: '#e3ae3c',
    selectionBackground: '#3a2225',
  },
}

const terminal = new window.Terminal({
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  fontSize: 13.5,
  lineHeight: 1.2,
  cursorBlink: true,
  // Claude Code redraws a lot; a deep buffer costs little and helps a lot.
  scrollback: 8000,
  theme: THEMES.dark,
})

const fit = new window.FitAddon.FitAddon()
terminal.loadAddon(fit)
terminal.open(document.getElementById('terminal'))

/**
 * Two rows the shell is never told about.
 *
 * Claude Code's status line is two lines tall and is drawn at the bottom of its
 * screen, which makes it the first thing to go when the pane and the shell
 * disagree about the shape of the pane — and they disagree for a moment every
 * time the window is resized, a font arrives, or the panel is dragged. Keeping
 * two rows back costs two rows and makes that moment invisible.
 *
 * This is the last of `Docs/history/the-cut-off-terminal`: the fit is right now,
 * so nothing is clipped, but "right now" is a promise about the instant the
 * measurement was taken.
 */
const RESERVED_ROWS = 2

/**
 * Measure the pane, and tell the shell — but only when the answer has changed.
 * Each report makes the shell redraw its whole screen, and the pane is measured
 * for several reasons that usually arrive at the same size.
 *
 * xterm is resized to the same shape the shell is told about. Letting the two
 * differ is the whole failure this guards against.
 */
let reported = { cols: 0, rows: 0 }
function fitAndReport() {
  fit.fit()
  const cols = terminal.cols
  const rows = Math.max(1, terminal.rows - RESERVED_ROWS)
  if (rows !== terminal.rows) terminal.resize(cols, rows)
  if (cols === reported.cols && rows === reported.rows) return
  reported = { cols, rows }
  window.jarvis.resize(cols, rows)
}

// Measured once it settles rather than on every pixel of a drag.
let settling = null
function fitWhenSettled() {
  clearTimeout(settling)
  settling = setTimeout(fitAndReport, 80)
}

fitAndReport()
terminal.focus()

window.jarvis.onData((chunk) => terminal.write(chunk))
terminal.onData((data) => window.jarvis.send(data))

// --- Theme -------------------------------------------------------------------

function applyTheme(name) {
  const chosen = THEMES[name] ?? THEMES.dark
  document.documentElement.dataset.theme = name in THEMES ? name : 'dark'
  terminal.options.theme = chosen
}

window.jarvis.onTheme(applyTheme)

/**
 * Text size, chosen in Settings.
 *
 * Changing it changes how many columns and rows fit, so the shell has to be
 * told the new shape — otherwise it goes on wrapping its lines for the old one
 * and the screen tears in half at the first prompt.
 */
window.jarvis.onFontSize((size) => {
  if (typeof size !== 'number' || !Number.isFinite(size)) return
  if (terminal.options.fontSize === size) return
  terminal.options.fontSize = size
  // On the next frame, not this one: the cell is measured again when the text is
  // laid out again, and fitting before that divides the pane by the old cell —
  // which is how a larger font ended up with more rows than the pane can show.
  requestAnimationFrame(fitAndReport)
})

// The Settings sheet laps over this column rather than pushing it aside, so the
// column steps back instead of being resized — nothing reflows, and it is
// obvious which of the two is being used.
window.jarvis.onDim((dimmed) => {
  document.body.classList.toggle('dimmed', dimmed)
})

// The pane outlives the Session now, so it has to be emptied between projects.
// Without this, ending one session and opening another leaves the old screen
// above the new prompt, reading as though both were still live.
window.jarvis.onReset(() => {
  terminal.reset()
  showWaiting()
})

function showWaiting() {
  terminal.writeln('')
  terminal.writeln('\x1b[90m  No session open. Choose a project in Jarvis to start one.\x1b[0m')
}

showWaiting()

// Only now: the shell starts talking before this page exists, and whatever it
// said in the meantime is waiting to be handed over.
window.jarvis.ready()

// Every reason the pane changes shape, not only the window being resized: the
// panel beside it is dragged, and the panel moves from a side to an edge, which
// changes this pane's width and height at once. A fit left over from before any
// of that leaves the shell drawing more rows than the pane can show, and the
// bottom of Claude Code's screen — its prompt, and the status line under it — is
// cut off at the edge with nothing on screen to say why.
new ResizeObserver(fitWhenSettled).observe(document.getElementById('terminal'))

// The terminal's own text is measured from a font that may still have been
// loading when the page first drew. Afterwards the cell is a different size, and
// so is the number of them that fit.
if (document.fonts) document.fonts.ready.then(fitAndReport).catch(() => {})
