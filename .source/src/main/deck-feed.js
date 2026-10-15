'use strict'

// The Deck's side of a Session: its one state, what feeds it, and how often
// the Panel hears of it.
//
// A busy Claude Code reports several tool calls a second. None of them is
// anything the core says or does, so none of them publishes at once or writes
// to the preferences file: they change the Deck, and the Deck goes out at most
// once every 250 ms. Only what the core itself hears — the five events it had
// before the Deck — and a conversation newly adopted publish at once and are
// remembered, as they always were.

const deckCore = require('../core/deck')
const { measured } = require('../core/events')
const { createCoalescer } = require('./coalesce')
const { readAgentFigures } = require('./agent-transcript')

/** Deck changes go out at most this often; everything else goes out at once. */
const DECK_PUBLISH_WAIT = 250

/** What the core hears. Every other Agent event is the Deck's alone. */
const CORE_EVENTS = new Set([
  'assistantFinished',
  'permissionRequested',
  'userPromptSubmitted',
  'sessionStarted',
  'sessionEnded',
])

/**
 * @param publish the Session's publish. It must call `sent`.
 * @param holds whether the Session still holds a conversation, by its id — a
 *   transcript read late reaches the Deck only if it does.
 * @param measure reads a stopped subagent's figures (main/agent-transcript.js).
 * @param chime plays a plan's sound — 'step' or 'done' — in the Session's own
 *   window, as the change is heard rather than when the Deck next goes out.
 * @param muted whether the plan's sounds are silenced now.
 */
function createDeckFeed({
  publish,
  holds = () => true,
  measure = readAgentFigures,
  chime = () => {},
  muted = () => false,
  wait = DECK_PUBLISH_WAIT,
  now = Date.now,
}) {
  /**
   * What the Claude Code in this Session is doing. Kept whether or not any
   * block is on, so switching one on shows what has already happened; it starts
   * afresh with each project and each new Claude Code conversation.
   */
  let deck = deckCore.initialDeck()
  /** Set once the Session is torn down, so a transcript read late changes nothing. */
  let closed = false
  const coalescer = createCoalescer({ wait, send: publish })

  /** One input through the Deck; published soon if a block would show it. */
  function feed(event) {
    const next = deckCore.reduce(deck, event, now())
    if (next === deck) return
    // A call merely starting is remembered, but shows nothing yet.
    const shows = !deckCore.sameView(deck, next)
    const sound = next.plans === deck.plans ? 'none' : deckCore.planSound(deck.plans, next.plans, muted())
    deck = next
    if (shows) coalescer.soon()
    if (sound !== 'none') {
      try {
        chime(sound)
      } catch {
        // A sound that cannot be played is not worth losing the Deck over.
      }
    }
  }

  /**
   * A subagent stopped: its tokens, and whether it ran out of output room, are
   * read once from its transcript, in the background. They reach the Deck only
   * if it still holds that conversation; a transcript that cannot be read leaves
   * them blank.
   */
  async function measureSubagent(event) {
    const figures = await measure(event.transcriptPath)
    if (closed) return
    if (deck.sessionId !== event.sessionId || !holds(event.sessionId)) return
    feed(measured.subagent(event.sessionId, event.agentId, figures))
  }

  return {
    feed,
    measureSubagent,
    view: () => deckCore.view(deck),
    clear() {
      deck = deckCore.initialDeck()
    },
    /** Whatever was published carried the Deck: nothing is left waiting. */
    sent: () => coalescer.sent(),
    stop() {
      closed = true
      coalescer.stop()
    },
  }
}

/**
 * One Agent event the registry routed to a Session: through its core, then —
 * when it is the conversation the Session holds — through its Deck.
 *
 * `remember` keeps the conversation for reconnecting (a preferences write);
 * `run` carries out the core's effects and publishes. Neither is reached by an
 * event only the Deck hears, unless it is the one that made the Session adopt
 * a conversation.
 */
function hearAgentEvent(incoming, { core, deck, remember, run }) {
  if (!incoming) return
  const { event } = incoming
  const before = core.state.activeSessionId
  const effects = core.receive(incoming)
  const after = core.state.activeSessionId
  const adopted = after !== before

  // Only the conversation this Session holds reaches its Deck — and the end of
  // the one it held, which lets go of whatever was still running in it.
  const ours = after === event.sessionId || (event.type === 'sessionEnded' && before === event.sessionId)
  if (ours) deck.feed(event)
  if (ours && event.type === 'subagentStopped') deck.measureSubagent(event)

  const heardByCore = CORE_EVENTS.has(event.type)
  if (after === event.sessionId && event.type !== 'sessionEnded' && (heardByCore || adopted)) {
    try {
      remember(event.sessionId)
    } catch {
      // Not worth reporting: it only costs a slower reconnection.
    }
  }

  if (heardByCore || adopted || effects.length > 0) run(effects)
}

/**
 * A status-line reading the registry routed here. Only the conversation this
 * Session holds reaches its Deck; nothing else hears of it — not the core, not
 * the voice, not the Transcript.
 */
function hearStatus(reading, { core, deck }) {
  if (!reading) return
  if (core.state.activeSessionId !== reading.event.sessionId) return
  deck.feed(reading.event)
}

module.exports = { createDeckFeed, hearAgentEvent, hearStatus, CORE_EVENTS, DECK_PUBLISH_WAIT }
