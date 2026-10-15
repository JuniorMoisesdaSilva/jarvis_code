'use strict'

// Reading and writing a JSON settings file that Jarvis does not own.
//
// Both the hook installer and the personality configurator write to Claude
// Code's settings file, and both had grown their own copy of the same careful
// dance: refuse a file that will not parse rather than clobber it, sort the keys,
// and write through a temporary file renamed into place so a crash mid-write
// cannot leave a truncated file behind. One copy of that, shared, so the two
// cannot drift and so a single UnreadableSettingsError is thrown by both — an
// `instanceof` check catches it whichever module did the writing.

const fs = require('node:fs')
const path = require('node:path')

class UnreadableSettingsError extends Error {
  constructor(file) {
    super(
      `Couldn't make sense of Claude Code's configuration file at ${file}. ` +
        'To avoid deleting anything of yours, Jarvis left it untouched. Fix the ' +
        'file, or change the settings by hand.',
    )
    this.name = 'UnreadableSettingsError'
    this.file = file
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The file's parsed object.
 *
 * A missing file is a legitimate starting point; what it becomes is the caller's
 * choice — `onMissing: 'empty'` for a file to be created, `'null'` when the
 * caller needs to tell "absent" from "empty". Anything else — a read error, a
 * parse error, a top-level value that is not an object — throws, because
 * treating it as empty would let the next write wipe out what is there.
 */
function readSettings(file, { onMissing }) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return onMissing === 'null' ? null : {}
    throw new UnreadableSettingsError(file)
  }
  if (raw.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UnreadableSettingsError(file)
  }
  if (!isPlainObject(parsed)) throw new UnreadableSettingsError(file)
  return parsed
}

let writeCounter = 0

/**
 * Writes an object as sorted, pretty JSON, atomically. The temporary file is
 * named uniquely per write — pid and a counter — so two writers to the same
 * settings file cannot rename over each other's half-written temp.
 *
 * `sorted: false` keeps the keys in the order they came: for a file that is
 * Claude Code's own state rather than settings a person reads (~/.claude.json),
 * where a reordering would be a change Jarvis had no reason to make.
 */
function writeSettings(file, value, { sorted: sorting = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const sorted = sorting ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
  const temporary = `${file}.jarvis-${process.pid}-${writeCounter++}.writing`
  fs.writeFileSync(temporary, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

module.exports = { readSettings, writeSettings, UnreadableSettingsError, isPlainObject }
