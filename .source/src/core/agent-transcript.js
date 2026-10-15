'use strict'

// What a subagent's own transcript says about it once it has stopped: the
// tokens its answers used and whether one of them ran out of output room.
//
// A pure reading of lines. Reading the file is the main process's job
// (src/main/agent-transcript.js), which hands the lines over a slice at a time
// so a long transcript never holds the main process up for long. The
// transcript is Claude Code's own JSON Lines file, one entry per line. An
// assistant message is written as one line per content block, each repeating
// the message's usage, so a message is counted once, by its id, as its last
// line says.

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * A measure fed line by line: `take` each line, then `result()`. A line that
 * cannot be read, such as one cut short, is skipped.
 */
function createTranscriptMeasure() {
  const byMessage = new Map()
  let unnamed = 0

  return {
    take(line) {
      if (!line.includes('"assistant"')) return
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        return
      }
      const message = entry?.message
      if (entry?.type !== 'assistant' || typeof message !== 'object' || message === null) return
      if (typeof message.usage !== 'object' || message.usage === null) return
      const key = typeof message.id === 'string' && message.id !== '' ? message.id : `unnamed-${(unnamed += 1)}`
      byMessage.set(key, { usage: message.usage, stopReason: message.stop_reason ?? null })
    },

    /**
     * `{ tokens: { input, output, cacheRead, cacheCreation }, outOfOutput }`,
     * or null when no assistant message with a usage was taken — blank, not zero.
     */
    result() {
      if (byMessage.size === 0) return null
      const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
      let outOfOutput = false
      for (const { usage, stopReason } of byMessage.values()) {
        tokens.input += count(usage.input_tokens)
        tokens.output += count(usage.output_tokens)
        tokens.cacheRead += count(usage.cache_read_input_tokens)
        tokens.cacheCreation += count(usage.cache_creation_input_tokens)
        if (stopReason === 'max_tokens') outOfOutput = true
      }
      return { tokens, outOfOutput }
    },
  }
}

/** The figures of a whole transcript's text at once, or null. */
function measureTranscript(text) {
  if (typeof text !== 'string' || text === '') return null
  const measure = createTranscriptMeasure()
  for (const line of text.split(/\r?\n/)) measure.take(line)
  return measure.result()
}

module.exports = { createTranscriptMeasure, measureTranscript }
