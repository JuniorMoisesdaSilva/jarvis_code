'use strict'

// Holds back a stream of small changes so they are sent at most once per
// `wait` milliseconds.
//
// The Deck is why it exists: a busy Claude Code reports several tool calls a
// second, each one changes the Deck, and publishing the Session's whole state
// for each would redraw the Panel for every one. A change that is not the
// Deck's still publishes at once, and since every publish carries the Deck,
// `sent` is told about it and a Deck publish already waiting is dropped.

/**
 * @param wait how long, at least, between two sends it is responsible for.
 * @param send what sending is — the Session's publish. It must call `sent`.
 */
function createCoalescer({ wait = 250, send }) {
  let last = -Infinity
  let timer = null

  function fire() {
    timer = null
    send()
  }

  return {
    /** Something changed that should go out, but need not go out now. */
    soon() {
      if (timer !== null) return
      timer = setTimeout(fire, Math.max(0, last + wait - Date.now()))
    },

    /** It has just gone out, with everything else — nothing is left waiting. */
    sent() {
      last = Date.now()
      if (timer !== null) clearTimeout(timer)
      timer = null
    },

    /** The Session is closing; nothing more goes out. */
    stop() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

module.exports = { createCoalescer }
