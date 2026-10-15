'use strict'

// Tidying a folder path, and deciding whether two of them are the same place.
//
// Pure text, no disk: resolving links and short names is the adapter's job. Two
// jobs, kept apart on purpose.
//
// `normalize` is what the app then goes on to use — it opens a terminal there
// and writes a Transcript into it — so it has to stay a real path, with the
// separator this machine uses and the case the user gave it. Folding the case
// there would turn every project into a lower-case one on screen and on disk.
//
// `samePath` is the comparison, and there the case-folding is not optional:
// Windows hands the same folder back written differently depending on who was
// asked, and a case-sensitive comparison would make Jarvis silently ignore
// every event from the project the user actually has open.

const path = require('node:path')

/** Single separator, the one this machine uses, and no trailing separator. */
function normalize(candidate) {
  if (typeof candidate !== 'string' || candidate === '') return null
  const collapsed = candidate.replace(/[\\/]+/g, path.sep)
  const trimmed = collapsed.replace(/[\\/]+$/, '')
  // A path that was nothing but separators is the root, and the root is a place.
  return trimmed === '' ? path.sep : trimmed
}

function samePath(a, b) {
  const left = normalize(a)
  const right = normalize(b)
  if (left === null || right === null) return false
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Whether a folder is the project or somewhere inside it.
 *
 * Claude Code reports the folder its shell is in now, not the one it was opened
 * in, so a single `cd` into a subfolder moves every later event there. Only the
 * project itself was accepted until 9 October 2026, and one `cd` was enough to
 * leave every answer after it unread for the rest of the session.
 *
 * Compared on whole folder names, so `/project-old` is not inside `/project`.
 */
function within(candidate, folder) {
  const inner = normalize(candidate)
  const outer = normalize(folder)
  if (inner === null || outer === null) return false
  const a = inner.toLowerCase()
  const b = outer.toLowerCase()
  if (a === b) return true
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

module.exports = { samePath, within, normalize }
