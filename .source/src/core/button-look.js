'use strict'

// How the Panel's Command and Skill buttons look: the icons a button may carry,
// how many columns they stand in, and how big their text and the Spine's are.
//
// And how a drop reorders a list, the Spine's as well as these: which half of
// the button held over a drop falls in, and the order it makes.
//
// The Panel and Settings both load this as a plain <script> — a renderer cannot
// `require`, and the preferences, the shortcuts, the Spine and Settings' icon
// picker must all read the one list. So it requires nothing, keeps its names
// inside one function and hands itself to whichever is asking.

;(function share(root) {
  /**
   * The icons a Command or a Skill may carry: Phosphor names, every one in the
   * vendored set (`renderer/assets/phosphor/phosphor.css` — a test holds this).
   * About fifty, chosen for what a button in a terminal panel tends to do:
   * start, run, look, change, ship, talk. A name not here is no icon at all.
   */
  const GLYPHS = Object.freeze([
    'terminal-window',
    'terminal',
    'command',
    'play',
    'pause',
    'stop',
    'arrow-clockwise',
    'clock-counter-clockwise',
    'arrow-circle-up',
    'sign-out',
    'gauge',
    'stack',
    'lightning',
    'sparkle',
    'robot',
    'brain',
    'lightbulb',
    'magnifying-glass',
    'eye',
    'list-checks',
    'check',
    'x',
    'git-branch',
    'git-commit',
    'git-pull-request',
    'git-merge',
    'code',
    'bug',
    'test-tube',
    'broom',
    'wrench',
    'hammer',
    'gear-six',
    'rocket',
    'package',
    'database',
    'cloud',
    'globe',
    'file-text',
    'folder-open',
    'note-pencil',
    'chat-text',
    'books',
    'translate',
    'shield-check',
    'key',
    'flag',
    'star',
    'bookmark-simple',
    'timer',
  ])

  /** What a new Command carries, and a new Skill. */
  const COMMAND_GLYPH = 'terminal-window'
  const SKILL_GLYPH = 'lightning'

  /** A glyph as stored: one of GLYPHS, or null for none. */
  function cleanGlyph(value) {
    return typeof value === 'string' && GLYPHS.includes(value) ? value : null
  }

  /**
   * The ranges of what the user sets, each a whole number: the columns the
   * Commands and the Skills stand in down a side, and the text sizes of the
   * Spine's labels and of the two kinds of button.
   */
  const COLUMNS = Object.freeze({ min: 1, max: 5, size: 3 })
  const SPINE_FONT = Object.freeze({ min: 8, max: 14, size: 9 })
  const BUTTON_FONT = Object.freeze({ min: 10, max: 16, size: 12 })

  /**
   * The terminal's text size, in points: half-points allowed, because 13.5 is
   * the size the design chose. Below 9 the glyphs stop being legible, above 24
   * too few columns fit beside the Panel.
   */
  const TERMINAL_FONT = Object.freeze({ min: 9, max: 24, step: 0.5, size: 13.5 })

  /**
   * A size typed into Settings, as it lands on leaving the box: brought back
   * inside `range` and onto its step (whole pixels unless the range says
   * otherwise). Something that is not a number is null — the box goes back to
   * what is stored rather than guessing.
   */
  function settle(range, value) {
    const number = typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value
    if (typeof number !== 'number' || !Number.isFinite(number)) return null
    const step = range.step ?? 1
    const onStep = Math.round(number / step) * step
    return Math.max(range.min, Math.min(range.max, onStep))
  }

  /** Whether `value` is a whole number inside `range`. */
  function within(range, value) {
    return Number.isInteger(value) && value >= range.min && value <= range.max
  }

  /**
   * The ids in `ids` once `id` is dropped on `target`: taken out of where it
   * was and put just before the target, or just after it. Dropped on itself,
   * or with either id not in the list, the list is as it was.
   */
  function reordered(ids, id, target, after) {
    if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids]
    const rest = ids.filter((each) => each !== id)
    rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id)
    return rest
  }

  /**
   * Whether a drop at `point` falls in the second half of the target, by the
   * way its list flows: a `'row'` reads left to right, so the second half is
   * right of the middle; a `'column'` reads top to bottom, so it is below it.
   * `box` is the target's rectangle: left, top, width, height.
   */
  function dropsAfter(flow, point, box) {
    return flow === 'row' ? point.x > box.left + box.width / 2 : point.y > box.top + box.height / 2
  }

  /**
   * A stored list put in the order `ids` gives: the items it names first, in
   * that order, then any it does not name in the order they had — so an order
   * sent from a window a step behind never loses a button.
   */
  function inOrder(list, ids) {
    const named = Array.isArray(ids) ? ids : []
    const first = named
      .filter((id, at) => named.indexOf(id) === at)
      .map((id) => list.find((each) => each.id === id))
      .filter(Boolean)
    return [...first, ...list.filter((each) => !first.includes(each))]
  }

  const api = {
    GLYPHS,
    COMMAND_GLYPH,
    SKILL_GLYPH,
    cleanGlyph,
    COLUMNS,
    SPINE_FONT,
    BUTTON_FONT,
    within,
    TERMINAL_FONT,
    settle,
    reordered,
    dropsAfter,
    inOrder,
  }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.buttonLook = Object.freeze(api)
})(globalThis)
