'use strict'

// Tidying a folder path, and deciding whether two of them are the same place.
//
// Pure text, no disk: resolving links and short names is the adapter's job. Two
// jobs that used to be one, and had to come apart when Jarvis reached macOS.
//
// `normalize` is what the app then goes on to use — it opens a terminal there
// and writes a Transcript into it — so it has to stay a real path, with the
// separator this machine uses and the case the user gave it. Folding the case
// there turned every project into a lower-case one, which Windows forgives and
// a Mac does not have to.
//
// `samePath` is the comparison, and there the case-folding is not optional:
// both systems hand the same folder back written differently depending on who
// was asked, and a case-sensitive comparison would make Jarvis silently ignore
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

module.exports = { samePath, normalize }
