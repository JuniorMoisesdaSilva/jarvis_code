import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer } from '../src/main/coalesce.js'

// A busy Claude Code reports several tool calls a second, and each one changes
// the Deck. Publishing the whole state for each would redraw the Panel for
// every one of them, so Deck changes wait for one another: at most one Deck
// publish every 250 ms. Everything else still publishes at once, and carries
// the Deck with it.

let published

beforeEach(() => {
  vi.useFakeTimers()
  published = 0
})

afterEach(() => {
  vi.useRealTimers()
})

function subject() {
  const coalescer = createCoalescer({
    wait: 250,
    send: () => {
      published += 1
      coalescer.sent()
    },
  })
  return coalescer
}

describe('Deck changes', () => {
  it('are published once for a burst, not once each', () => {
    const deck = subject()
    for (let each = 0; each < 20; each += 1) deck.soon()

    vi.advanceTimersByTime(250)
    expect(published).toBe(1)
  })

  it('are published at most once every 250 ms however long the burst lasts', () => {
    const deck = subject()
    for (let ms = 0; ms < 1000; ms += 10) {
      deck.soon()
      vi.advanceTimersByTime(10)
    }
    vi.advanceTimersByTime(250)
    expect(published).toBeGreaterThanOrEqual(4)
    expect(published).toBeLessThanOrEqual(5)
  })

  it('go out at once when nothing has been published for a while', () => {
    const deck = subject()
    vi.advanceTimersByTime(1000)
    deck.soon()
    vi.advanceTimersByTime(0)
    expect(published).toBe(1)
  })

  it('ride along with a publish that happened anyway', () => {
    const deck = subject()
    deck.soon()
    // Something else changed and was published at once, Deck included.
    deck.sent()
    vi.advanceTimersByTime(1000)
    expect(published).toBe(0)
  })

  it('send nothing after the Session is gone', () => {
    const deck = subject()
    deck.soon()
    deck.stop()
    vi.advanceTimersByTime(1000)
    expect(published).toBe(0)
  })
})
