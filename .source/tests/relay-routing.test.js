import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { user } from '../src/core/events.js'
import { createDeckFeed, hearAgentEvent, hearStatus } from '../src/main/deck-feed.js'
import { deliver } from '../src/main/hook-routing.js'
import { fixture } from './helpers.js'

// The status line knocks on the same pipe as the hooks. What the listener
// hears goes through one door: decoded as a status reading, routed to the
// Session that owns its terminal or its conversation, and handed to that
// Session's Deck — never to its core, so never to the voice or the Transcript.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'
const PROJECT = 'C:\\Jarvis'

/** A Session as the registry sees it, with a real core and a real Deck behind it. */
function session(terminal) {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT, terminal))
  core.dispatch(user.autoReadSet(true))
  const said = []
  const deck = createDeckFeed({ publish: () => deck.sent(), measure: async () => null })
  const ports = { core, deck, remember: () => {}, run: (effects) => said.push(...effects) }
  return {
    core,
    deck,
    said,
    heardByCore: 0,
    ownsTerminal: (id) => id !== null && core.state.terminal === id,
    ownsClaudeSession: (id) => core.state.activeSessionId === id,
    matchesProject: (cwd) => cwd === PROJECT,
    hasActiveSession: () => core.state.activeSessionId !== null,
    receive(incoming) {
      this.heardByCore += 1
      hearAgentEvent(incoming, ports)
    },
    receiveStatus: (reading) => hearStatus(reading, { core, deck }),
  }
}

function payload(name, changes = {}) {
  return JSON.stringify({ ...JSON.parse(fixture(name)), session_id: SESSION, cwd: PROJECT, ...changes })
}

describe('a status reading heard on the pipe', () => {
  it('reaches the Deck of the Session that owns its terminal, and nothing else of it', () => {
    const mine = session('term-mine')
    const other = session('term-other')
    const sessions = [other, mine]

    deliver(payload('user-prompt-submit', { jarvis_terminal: 'term-mine' }), sessions)
    const heard = mine.heardByCore
    const said = mine.said.length

    deliver(payload('status-line', { jarvis_reading: 'status', jarvis_terminal: 'term-mine' }), sessions)

    expect(mine.deck.view().gauge.reported).toBe(true)
    expect(other.deck.view().gauge.reported).toBe(false)
    expect(mine.heardByCore).toBe(heard)
    expect(mine.said).toHaveLength(said)
    expect(mine.said.some((effect) => effect.type === 'speak' && /status/i.test(effect.text))).toBe(false)
  })

  it('is never taken for a hook, even one that would be spoken', () => {
    const mine = session('term-mine')
    deliver(payload('user-prompt-submit', { jarvis_terminal: 'term-mine' }), [mine])
    const heard = mine.heardByCore

    // A reading carries no hook name; even dressed as a Stop it is still a reading.
    deliver(
      payload('stop-interactive', { jarvis_reading: 'status', jarvis_terminal: 'term-mine' }),
      [mine],
    )
    expect(mine.heardByCore).toBe(heard)
    expect(mine.core.state.lastAssistantText).not.toBe('ação, coração, não, você')
  })

  it('goes nowhere when no Session holds its conversation', () => {
    const stranger = session('term-other')
    deliver(payload('status-line', { jarvis_reading: 'status', session_id: 'someone-else' }), [stranger])
    expect(stranger.deck.view().gauge.reported).toBe(false)
  })
})
