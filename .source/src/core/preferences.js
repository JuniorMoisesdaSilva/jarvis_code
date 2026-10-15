'use strict'

// What Jarvis remembers between launches.
//
// It lives in the core rather than next to the Panel for a practical reason: it
// is pure logic over an injectable file, so it can actually be tested instead of
// checked by hand by opening and closing the app.

const fs = require('node:fs')
const path = require('node:path')
const { isLanguage, PORTUGUESE, ALL } = require('./language')
const { isShortcut, repair, defaults: defaultShortcuts } = require('./command-shortcut')
const { SKILL_GLYPH, COLUMNS, SPINE_FONT, BUTTON_FONT, TERMINAL_FONT, within, inOrder } = require('./button-look')
const { defaultShell, isNativePath, current } = require('./platform')
const { isPosition, RAIL, RAIL_MAX, BAND, BAND_MAX } = require('./geometry')
const { BLOCKS, DECK_FONT } = require('./deck-chips')
const { PARTS, DEFAULT_ORDER, cleanOrder, cleanHidden } = require('./spine')

class UnreadablePreferencesError extends Error {
  constructor(file, cause) {
    super(`Couldn't read Jarvis's settings at ${file}: ${cause.code ?? cause.message}.`)
    this.name = 'UnreadablePreferencesError'
    this.file = file
    this.cause = cause
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every field Jarvis stores, with the value it falls back to.
 *
 * A preferences file is a file the user may hand-edit, so each field is checked
 * on its own: one bad value degrades to its own default and leaves the rest
 * standing. The collections go further and are filtered element by element,
 * because throwing away a whole list of hand-made buttons over one broken entry
 * would be the worst outcome available.
 */
const FIELDS = Object.freeze({
  /**
   * `keep` is handed the platform as well as the value, for the two fields that
   * hold a path. A path that is not shaped like a Windows one is nothing this
   * machine can open — see isNativePath in the core's platform file.
   */
  shell: {
    fallback: (platform) => defaultShell(platform),
    keep: (value, platform) => isNonEmptyString(value) && isNativePath(value, platform),
    clean: (value) => value.trim(),
  },
  language: { fallback: PORTUGUESE, keep: isLanguage },
  /**
   * How big the terminal's text is, in points.
   *
   * Bounded rather than free: below about 9 the glyphs stop being legible at
   * all, and above 24 a useful number of columns no longer fits beside the
   * rail. Half-points are allowed because 13.5 is the size the design chose,
   * and rounding it away would change the app's look to add a setting.
   */
  terminalFontSize: {
    fallback: TERMINAL_FONT.size,
    keep: (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= TERMINAL_FONT.min && value <= TERMINAL_FONT.max,
  },
  theme: { fallback: 'dark', keep: (value) => ['dark', 'light', 'iron'].includes(value) },
  /**
   * Which side the panel is on, how thick it is there, and whether it is
   * retracted.
   *
   * These name no place on the disk, so unlike the shell and the project there
   * is nothing in them that can belong to somewhere else.
   *
   * What is stored is the shape a **new** window opens at. Preferences are one
   * file for the whole app, so dragging an edge in one window writes the number
   * down without moving a window that is already up — which is the compromise
   * that lets 0018's per-window width be remembered at all.
   */
  panelPosition: { fallback: 'right', keep: isPosition },
  panelCollapsed: { fallback: false, keep: (value) => typeof value === 'boolean' },
  // Refused rather than clamped, like every other bounded field here: a number
  // outside the range is a hand-edit that did not mean what it says, and
  // silently rewriting it to the nearest legal value hides that.
  railWidth: {
    fallback: RAIL,
    keep: (value) => Number.isFinite(value) && value >= RAIL && value <= RAIL_MAX,
  },
  bandHeight: {
    fallback: BAND,
    keep: (value) => Number.isFinite(value) && value >= BAND && value <= BAND_MAX,
  },
  autoRead: { fallback: true, keep: (value) => typeof value === 'boolean' },
  // The five Deck switches, one field each — deckPlan, deckGauge and so on,
  // named in the catalogue (deck-chips.js). All off to start but the Gauge,
  // which shows what the status line under the terminal used to; one for
  // every window, like Read aloud.
  ...Object.fromEntries(
    BLOCKS.map((block) => [
      block.preference,
      { fallback: block.startsOn === true, keep: (value) => typeof value === 'boolean' },
    ]),
  ),
  // The four sections' switches on the Spine — partCommands, partSkills,
  // partReadings, partSession, named in spine.js — on to start, so the Panel
  // opens as it did before the Spine. One set for every window.
  ...Object.fromEntries(
    PARTS.filter((part) => !part.deck).map((part) => [
      part.preference,
      { fallback: true, keep: (value) => typeof value === 'boolean' },
    ]),
  ),
  // The Spine's order, which is the page's: unknown ids dropped, the missing
  // appended in the default order — so it is always all nine, once each.
  spineOrder: { fallback: [...DEFAULT_ORDER], keep: Array.isArray, clean: cleanOrder },
  // The Parts whose button is hidden from the Spine. A hidden Part is off
  // (spine.js partsOn).
  spineHidden: { fallback: [], keep: Array.isArray, clean: cleanHidden },
  // How the Commands and the Skills stand down a side: 1 to 5 columns, three
  // to start (button-look.js holds the ranges).
  commandColumns: { fallback: COLUMNS.size, keep: (value) => within(COLUMNS, value) },
  skillColumns: { fallback: COLUMNS.size, keep: (value) => within(COLUMNS, value) },
  // The text sizes of the Spine's labels and of the two kinds of button, in
  // whole pixels as drawn.
  spineFontSize: { fallback: SPINE_FONT.size, keep: (value) => within(SPINE_FONT, value) },
  commandFontSize: { fallback: BUTTON_FONT.size, keep: (value) => within(BUTTON_FONT, value) },
  skillFontSize: { fallback: BUTTON_FONT.size, keep: (value) => within(BUTTON_FONT, value) },
  // The Plan block's own mute for its two sounds. Off to start, one for every
  // window.
  deckPlanMuted: { fallback: false, keep: (value) => typeof value === 'boolean' },
  /**
   * How big the Deck's text is, in pixels as drawn — the Deck's alone, apart
   * from the terminal's. Whole pixels within DECK_FONT's range (deck-chips.js,
   * where the reasons are); it starts at 10, a pixel under the 11 the Deck was
   * drawn at before this was a setting.
   */
  deckFontSize: {
    fallback: DECK_FONT.size,
    keep: (value) => Number.isInteger(value) && value >= DECK_FONT.min && value <= DECK_FONT.max,
  },
  // One model, since 8 September 2026. A file naming `tiny` or `small` falls
  // back to it rather than being honoured, which is the whole point of removing
  // them: they are not there to be opened.
  model: { fallback: 'medium', keep: (value) => value === 'medium' },
  // The synthesis API takes a rate from -10 to 10, where zero is the voice's own
  // pace. A value outside that range is refused by Windows, not clamped.
  speechRate: {
    fallback: 0,
    keep: (value) => Number.isInteger(value) && value >= -10 && value <= 10,
  },
  projectPath: {
    fallback: null,
    keep: (value, platform) => isNonEmptyString(value) && isNativePath(value, platform),
  },
  terminalSession: { fallback: null, keep: isNonEmptyString },
  claudeSession: { fallback: null, keep: isNonEmptyString },
  welcomeSeen: { fallback: false, keep: (value) => typeof value === 'boolean' },
  shortcuts: {
    fallback: [],
    keep: Array.isArray,
    clean: (value) => value.filter(isShortcut).map((each) => repair(each)),
  },
  // Skill shortcuts are stored just like command shortcuts — same shape, same
  // element-by-element repair — but as their own list, so the rail can show
  // them in a block of their own. Empty by default: the user fills it.
  skills: {
    fallback: [],
    keep: Array.isArray,
    clean: (value) => value.filter(isShortcut).map((each) => repair(each, SKILL_GLYPH)),
  },
  voices: {
    fallback: {},
    keep: isPlainObject,
    clean: (value) =>
      Object.fromEntries(
        Object.entries(value).filter(([key, id]) => ALL.includes(key) && isNonEmptyString(id)),
      ),
  },
})

function defaults(platform = current()) {
  return Object.fromEntries(
    Object.entries(FIELDS).map(([key, field]) => [
      key,
      structuredClone(typeof field.fallback === 'function' ? field.fallback(platform) : field.fallback),
    ]),
  )
}

/** The defaults for the machine running now, for the callers that want them flat. */
const DEFAULTS = Object.freeze(defaults())

/** Keeps only the stored values that are usable, defaulting everything else. */
function sanitize(stored, platform = current()) {
  const source = isPlainObject(stored) ? stored : {}
  const clean = defaults(platform)

  for (const [key, field] of Object.entries(FIELDS)) {
    if (!(key in source)) continue
    const value = source[key]
    if (!field.keep(value, platform)) continue
    clean[key] = field.clean ? field.clean(value) : value
  }

  // The two session identifiers describe a shell and a conversation inside the
  // project, so they mean nothing without it. Dropped together rather than left
  // dangling: a stored project that is dropped takes them with it,
  // and reconnecting to a session in a folder Jarvis has no project for is not
  // a thing that can be done.
  if (clean.projectPath === null) {
    clean.terminalSession = null
    clean.claudeSession = null
  }

  // A stored voice this machine had of its own is left exactly as it is. Jarvis
  // no longer reads with those, and speech.js rescues the reading with one of
  // its own — but throwing the name away would be this file deciding, on the
  // user's behalf and silently, that a choice they made is no longer theirs.
  return clean
}

function createPreferences(file) {
  /**
   * The file's contents, or null when there is no file yet.
   *
   * A missing file is a legitimate starting point. A file that exists and cannot
   * be read is **not** — on Windows that is routinely an antivirus scan or an
   * editor holding a lock, and treating it as absent would let the next write
   * replace the user's whole configuration with defaults.
   */
  function load() {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new UnreadablePreferencesError(file, error)
    }
  }

  /**
   * The stored preferences. Invalid contents degrade to the defaults — that is
   * the recovery path from a bad hand-edit — but an unreadable file throws.
   */
  function read() {
    const raw = load()
    if (raw === null) return defaults()
    try {
      return sanitize(JSON.parse(raw))
    } catch {
      return defaults()
    }
  }

  /**
   * Merges a patch in and returns the new whole. Written to a temporary file and
   * renamed into place, so a crash mid-write cannot leave a truncated file
   * behind — and a truncated file is indistinguishable from a bad hand-edit,
   * which means it would degrade to the defaults and lose everything.
   */
  function write(patch) {
    const merged = sanitize({ ...read(), ...patch })
    fs.mkdirSync(path.dirname(file), { recursive: true })

    const temporary = `${file}.writing`
    fs.writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, file)
    return merged
  }

  return {
    file,
    read,
    write,

    // --- Session -------------------------------------------------------------

    /**
     * Remembers where a session was, so reopening Jarvis can reconnect. The
     * conversation identifier is dropped: it belonged to the previous session,
     * and carrying it over would make Jarvis answer events no longer its own.
     */
    rememberSession(projectPath, terminalSession) {
      return write({ projectPath, terminalSession, claudeSession: null })
    },

    /**
     * Claude Code's session identifier is only known once the first event
     * arrives; keeping it is what allows reconnecting without waiting for one.
     */
    rememberClaudeSession(claudeSession) {
      return write({ claudeSession })
    },

    forgetSession() {
      return write({ projectPath: null, terminalSession: null, claudeSession: null })
    },

    // --- First run -----------------------------------------------------------

    markWelcomeSeen() {
      return write({ welcomeSeen: true })
    },

    // --- Command shortcuts ---------------------------------------------------

    /**
     * An empty list falls back to the defaults: a Panel with no buttons and no
     * way to add one would be a dead end.
     */
    shortcuts() {
      const stored = read().shortcuts
      return stored.length === 0 ? defaultShortcuts() : stored
    },

    setShortcuts(shortcuts) {
      return write({ shortcuts: Array.isArray(shortcuts) ? shortcuts : [] })
    },

    /**
     * The Commands in the order a drop in the Panel gives, by id. Read through
     * `shortcuts()`, so the built-ins an empty list stands for are written
     * down in their new order rather than lost to the fallback.
     */
    setShortcutOrder(ids) {
      const stored = read().shortcuts
      return write({ shortcuts: inOrder(stored.length === 0 ? defaultShortcuts() : stored, ids) })
    },

    // --- Skill shortcuts -----------------------------------------------------

    /**
     * The skill shortcuts, as stored. Unlike commands there are no built-ins, so
     * an empty list stays empty: a Skills block with nothing in it and an add
     * button is a fine starting point, not a dead end.
     */
    skills() {
      return read().skills
    },

    setSkills(skills) {
      return write({ skills: Array.isArray(skills) ? skills : [] })
    },

    /** The Skills in the order a drop in the Panel gives, by id. */
    setSkillOrder(ids) {
      return write({ skills: inOrder(read().skills, ids) })
    },

    // --- Voice ---------------------------------------------------------------

    /**
     * The voice chosen for a language, if any. With no choice, the app decides —
     * the best quality installed.
     */
    voiceFor(language) {
      return read().voices[language] ?? null
    },

    setVoiceFor(language, identifier) {
      const voices = { ...read().voices }
      if (isNonEmptyString(identifier)) voices[language] = identifier
      else delete voices[language]
      return write({ voices })
    },
  }
}

module.exports = {
  createPreferences,
  sanitize,
  defaults,
  DEFAULTS,
  FIELDS,
  UnreadablePreferencesError,
}
