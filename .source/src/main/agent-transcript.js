'use strict'

// Reads a subagent's transcript once, when it stops, for the Agents block.
//
// The file is Claude Code's, named by the SubagentStop hook. It is read in the
// background and never more than once; anything wrong with it — missing, not a
// transcript, too big, unreadable — leaves the figures blank and raises
// nothing. What the lines mean is decided in the core (core/agent-transcript.js).
//
// The usage sums need every line, so a transcript is read whole or not at all:
// past READ_LIMIT the figures are left blank. What is read is measured a slice
// of lines at a time, yielding to the event loop between slices, so the main
// process — which also carries the voice and every window — never stalls on it.

const fs = require('node:fs/promises')
const path = require('node:path')

const { createTranscriptMeasure } = require('../core/agent-transcript')

/** Past this a transcript is not read: a subagent that long is better blank than slow. */
const READ_LIMIT = 8 * 1024 * 1024

/** How many lines are measured between two breaths. */
const CHUNK_LINES = 2000

/** One turn of the event loop. */
function breathe() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** The figures a transcript holds, or null. Never throws. */
async function readAgentFigures(file, { limit = READ_LIMIT, chunkLines = CHUNK_LINES, pause = breathe } = {}) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.jsonl') return null
  try {
    const { size } = await fs.stat(file)
    if (size > limit) return null
    const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/)
    const measure = createTranscriptMeasure()
    for (let start = 0; start < lines.length; start += chunkLines) {
      if (start > 0) await pause()
      for (const line of lines.slice(start, start + chunkLines)) measure.take(line)
    }
    return measure.result()
  } catch {
    return null
  }
}

module.exports = { readAgentFigures, READ_LIMIT }
