'use strict'

// Applying Jarvis's personality to Claude Code, and taking it back off.
//
// Where the hook installer teaches Claude Code to *report* to Jarvis, this
// teaches it to *behave* like Jarvis: the Resumo leigo output style so answers
// are written to be heard, the two-line status line, the model, and the Maestro
// that runs a piece of work from request to delivery. The settings are
// single-valued keys in a file the user owns, which makes this harder than
// installing a hook — a hook is added beside whatever was there, but setting a
// style replaces one. The style and the Maestro are placements: files and
// folders copied in beside those settings, because a style name is inert without
// its file and a skill is a folder or nothing. So the one rule that matters is
// symmetry: whatever the host had before Connect is what it must have again
// after Disconnect.
//
// The way that promise is kept is a memory file, written the first time Jarvis
// applies itself, recording the host's own value for every key Jarvis touches —
// including "this key was absent", which is different from any value it could
// hold. Disconnect reads that memory back, and undoes exactly the keys the
// memory records — not whatever the current personality happens to want, which
// may have gained or lost a key since Connect. A second Connect must not
// overwrite the memory, or the host's original value would be lost behind
// Jarvis's own.
//
// The file I/O is shared with the hook installer (src/core/settings-file.js), so
// the two writers to the host's settings cannot drift and throw one another's
// error type. Pure logic over injectable file paths, tested against real
// temporary files.

const fs = require('node:fs')
const path = require('node:path')
const { readSettings, writeSettings, UnreadableSettingsError, isPlainObject } = require('./settings-file')

/** A key Jarvis did not find is remembered as this, never as a real value. */
const ABSENT = { __jarvis_absent__: true }

/**
 * The memory fields that are not settings keys.
 *
 * `PLACED` holds the destination paths Connect actually copied onto the host.
 * Paths, not one flag per known placement, because the list of placements can
 * differ between Connect and Disconnect — the Maestro's embedded copies travel
 * only while the skills package is absent, and the package can be installed in
 * between. Disconnect must undo what Connect did, not what Connect would do now.
 *
 * `CREATED` holds the topmost folder Jarvis had to make to place each of them.
 * Removing the files is not enough — an empty `skills/maestro` left behind is
 * still Jarvis on the host's disk — and walking up deleting empty parents with
 * no stated limit is how you delete somebody's home folder. Both lists are
 * written after the copies actually succeed, never before: a path Jarvis only
 * meant to place is a path Disconnect would delete out from under whoever put
 * something there afterwards.
 *
 * `STYLE_PLACED` is what `PLACED` was called back when the style file was the
 * only thing Jarvis ever placed. It is read, never written, so a machine
 * connected by that version still disconnects cleanly after an upgrade.
 */
const PLACED = '__placed__'
const CREATED = '__created__'
const STYLE_PLACED = '__styleFilePlaced__'
const RESERVED = new Set([PLACED, CREATED, STYLE_PLACED])

/**
 * The topmost folder that would have to be created to put something at this
 * path, or null if its parent is already there.
 */
function topmostMissing(destination) {
  let missing = null
  let folder = path.dirname(destination)
  while (!fs.existsSync(folder)) {
    missing = folder
    const above = path.dirname(folder)
    if (above === folder) break // the drive root; go no further
    folder = above
  }
  return missing
}

/** Whether this folder is one of the given roots, or sits inside one. */
function inside(folder, roots) {
  for (const root of roots) {
    if (folder === root || folder.startsWith(root + path.sep)) return true
  }
  return false
}

/**
 * Removes the folders Jarvis had to make in order to place something, from the
 * innermost outwards.
 *
 * Two guards, and both are needed. It climbs only inside a folder Jarvis
 * created, so a folder of the host's that happens to be empty is never touched —
 * a half-made skill of their own, say, still waiting for its file. And it uses
 * `rmdir`, which refuses a folder with anything in it, so whatever the host has
 * since put in one of ours survives, and so does every folder above it.
 */
function pruneCreated(destination, roots) {
  let folder = path.dirname(destination)
  while (inside(folder, roots)) {
    try {
      fs.rmdirSync(folder)
    } catch {
      return // not empty, or already gone; either way, stop climbing
    }
    const above = path.dirname(folder)
    if (above === folder) return
    folder = above
  }
}

function wasAbsent(value) {
  return isPlainObject(value) && value.__jarvis_absent__ === true
}

/**
 * @param settingsFile Claude Code's settings file — the one the host owns.
 * @param memoryFile   Jarvis's own record, machine-local, of what the host had
 *                     before Connect. Never inside the portable folder.
 * @param desired      the keys Jarvis wants set: any of outputStyle, statusLine,
 *                     model. Only the keys present here are ever touched.
 * @param placements   the files and folders Jarvis copies onto the host, each
 *                     { source, destination }. Some settings are inert on their
 *                     own: `outputStyle` names a file that must exist in one of
 *                     Claude Code's style folders, and a skill is a folder or
 *                     nothing at all. A placement whose destination already
 *                     exists is left completely alone — the host may have one of
 *                     its own by that name — and Disconnect then removes only
 *                     what Jarvis itself put there.
 *
 *                     `optional: true` marks a placement Jarvis can do without:
 *                     a failure to copy it is swallowed and it does not hold
 *                     `isApplied()` back, because Connect must finish either way.
 *                     `legacy: true` marks the one placement an older memory
 *                     recorded as a single boolean.
 */
function createConfigurator({ settingsFile, memoryFile, desired, placements = [] }) {
  const keys = Object.keys(desired)

  /** The destinations this memory says Connect put on the host. */
  function placedPaths(memory) {
    if (Array.isArray(memory[PLACED])) return memory[PLACED]
    if (memory[STYLE_PLACED] !== true) return []
    return placements.filter((each) => each.legacy).map((each) => each.destination)
  }

  /** What the host had for each managed key, right now. */
  function snapshot(settings) {
    const memory = {}
    for (const key of keys) memory[key] = key in settings ? settings[key] : ABSENT
    return memory
  }

  function apply() {
    const settings = readSettings(settingsFile, { onMissing: 'empty' })

    // Record the host's own values once, before Jarvis has changed anything. On
    // a second Connect the memory already exists and is left as it was, so the
    // value it holds is always the host's, never Jarvis's.
    const memory = fs.existsSync(memoryFile)
      ? readSettings(memoryFile, { onMissing: 'empty' })
      : snapshot(settings)

    // What Jarvis has already put on this host, which a second Connect adds to
    // rather than replaces. A placement can join the list after the first
    // Connect — the Maestro's embedded copies start travelling the moment the
    // skills package is uninstalled — and one that is already the host's own
    // never joins it at all.
    const placed = new Set(placedPaths(memory))
    const created = new Set(Array.isArray(memory[CREATED]) ? memory[CREATED] : [])

    try {
      for (const each of placements) {
        const ours = placed.has(each.destination)
        if (!ours && fs.existsSync(each.destination)) continue // the host's own
        const making = ours ? null : topmostMissing(each.destination)
        try {
          fs.mkdirSync(path.dirname(each.destination), { recursive: true })
          fs.cpSync(each.source, each.destination, { recursive: true })
        } catch (error) {
          // Nothing was placed, so nothing here is Jarvis's to take back later —
          // including the folders the attempt just made.
          if (making) pruneCreated(each.destination, new Set([making]))
          if (!each.optional) throw error
          continue
        }
        placed.add(each.destination)
        if (making) created.add(making)
      }
    } finally {
      // Written even when a placement Jarvis cannot do without throws, because
      // what did land before it has to be taken back all the same.
      memory[PLACED] = [...placed]
      memory[CREATED] = [...created]
      writeSettings(memoryFile, memory)
    }

    for (const key of keys) settings[key] = desired[key]
    writeSettings(settingsFile, settings)
  }

  function remove() {
    const memory = readSettings(memoryFile, { onMissing: 'null' })
    if (memory === null) return // never applied; nothing of ours to take back

    const settings = readSettings(settingsFile, { onMissing: 'empty' })
    // Undo exactly the keys the memory records, which is what Connect actually
    // wrote — not the current desired keys, which may since have changed. That
    // is what keeps a personality edited between Connect and Disconnect from
    // leaving a Jarvis value on the host or wiping a host value.
    for (const key of Object.keys(memory)) {
      if (RESERVED.has(key)) continue
      if (wasAbsent(memory[key])) delete settings[key]
      else settings[key] = memory[key]
    }
    writeSettings(settingsFile, settings)

    // Take back only what Jarvis itself put on the host, whole folders included,
    // and then, in a second pass so no chain is cut short by another still being
    // there, the folders it had to make to put them there.
    const ours = placedPaths(memory)
    for (const destination of ours) {
      try {
        fs.rmSync(destination, { recursive: true, force: true })
      } catch {
        // Already gone, or never written — either way there is nothing to undo.
      }
    }
    const roots = new Set(Array.isArray(memory[CREATED]) ? memory[CREATED] : [])
    for (const destination of ours) pruneCreated(destination, roots)

    try {
      fs.rmSync(memoryFile)
    } catch {
      // If the memory cannot be removed the restore still happened; a stale
      // memory only means the next Connect keeps an already-correct record.
    }
  }

  function isApplied() {
    let settings
    try {
      settings = readSettings(settingsFile, { onMissing: 'empty' })
    } catch {
      return false
    }
    const keysMatch = keys.every(
      (key) => JSON.stringify(settings[key]) === JSON.stringify(desired[key]),
    )
    // A style name is inert without its file, so a placement that is not on disk
    // means not applied — unless it is one Jarvis can do without.
    const placementsReady = placements.every(
      (each) => each.optional || fs.existsSync(each.destination),
    )
    return keysMatch && placementsReady
  }

  return { apply, remove, isApplied, settingsFile, memoryFile }
}

module.exports = { createConfigurator, UnreadableSettingsError, ABSENT }
