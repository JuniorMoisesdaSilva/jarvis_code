'use strict'

// The Spine: the column of buttons on the Panel's outer edge, one per Part of
// the page. A Part is one of the five Deck blocks or one of four sections —
// Commands, Skills, Recent readings, Session. The Parts that are on stack in the
// Spine's order. See Docs/decisions/0035-the-spine-replaces-the-fixed-page.md.
//
// Like deck-chips.js and button-look.js, which it reads, the Panel loads this as
// a plain <script>:
// a renderer cannot `require`, and the preferences, the main process and the
// Panel must all read the one table. So it keeps its names inside one function
// and hands itself to whichever of the two is asking.

;(function share(root) {
  const asModule = typeof module === 'object' && module.exports
  const { BLOCKS } = asModule ? require('./deck-chips') : root.deckChips
  const { reordered } = asModule ? require('./button-look') : root.buttonLook

  /**
   * The nine Parts, in the Spine's default order: the Deck blocks first, in the
   * Deck's own order (Context at the head), then the four sections in the order
   * the page had them. `preference` is the Part's stored switch: the Deck
   * blocks keep the keys they always had, so an upgrade keeps what was on.
   */
  const SECTIONS = [
    { id: 'commands', abbreviation: 'CMD', name: 'Commands', glyph: 'command', preference: 'partCommands' },
    { id: 'skills', abbreviation: 'SKL', name: 'Skills', glyph: 'lightning', preference: 'partSkills' },
    { id: 'readings', abbreviation: 'READ', name: 'Recent readings', glyph: 'speaker-high', preference: 'partReadings' },
    { id: 'session', abbreviation: 'SESS', name: 'Session', glyph: 'chats', preference: 'partSession' },
  ]

  const PARTS = Object.freeze(
    [
      ...BLOCKS.map((block) => ({
        id: block.id,
        abbreviation: block.abbreviation,
        name: block.name,
        glyph: block.glyph,
        preference: block.preference,
        deck: true,
      })),
      ...SECTIONS.map((section) => ({ ...section, deck: false })),
    ].map(Object.freeze),
  )

  const IDS = PARTS.map((part) => part.id)

  const DEFAULT_ORDER = Object.freeze([...IDS])

  /** Known ids only, each once, in the order given. */
  function known(list) {
    if (!Array.isArray(list)) return []
    return list.filter((id, at) => IDS.includes(id) && list.indexOf(id) === at)
  }

  /**
   * A stored order made whole: an id it does not know is dropped, a repeat is
   * dropped, and a Part it does not name is appended in the default order — so
   * a Part added in a later version turns up at the end rather than nowhere.
   */
  function cleanOrder(list) {
    const kept = known(list)
    return [...kept, ...DEFAULT_ORDER.filter((id) => !kept.includes(id))]
  }

  /** The Parts whose button is hidden from the Spine: known ids, once each. */
  function cleanHidden(list) {
    return known(list)
  }

  /**
   * Which Parts are on, by id, from the stored preferences. A hidden Part is
   * off whatever its switch says: a Part with no button would be one that
   * could not be taken away again.
   */
  function partsOn(stored) {
    const hidden = cleanHidden(stored?.spineHidden)
    return Object.fromEntries(
      PARTS.map((part) => [part.id, stored?.[part.preference] === true && !hidden.includes(part.id)]),
    )
  }

  /**
   * What to store when Settings hides a Part's button, or shows it again.
   * Hidden, the button leaves the Spine and its Part is switched off, so it
   * does not come back on by surprise; shown, the button returns and the Part
   * stays off until the Spine turns it on. A Part it does not know: nothing.
   */
  function hiding(stored, id, hidden) {
    const part = PARTS.find((each) => each.id === id)
    if (!part) return {}
    const was = cleanHidden(stored?.spineHidden).filter((each) => each !== id)
    return hidden ? { spineHidden: [...was, id], [part.preference]: false } : { spineHidden: was }
  }

  /**
   * The order once the Part `id` is dropped on the Part `target`: taken out of
   * where it was and put just before the target, or just after it. Dropped on
   * itself, or with either id unknown, the order is as it was. Always whole.
   */
  function moved(order, id, target, after) {
    return reordered(cleanOrder(order), id, target, after)
  }

  const api = { PARTS, DEFAULT_ORDER, cleanOrder, cleanHidden, partsOn, hiding, moved }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.spine = Object.freeze(api)
})(globalThis)
