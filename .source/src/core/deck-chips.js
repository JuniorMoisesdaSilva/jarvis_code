'use strict'

// What each Deck block says on one line — its line down a side, its chip in a
// Band — made from that block's view; and what the Deck's other files share:
// the catalogue of the five blocks, sentence case, and the rules by which
// time alone settles something left running.
//
// A line is an abbreviation and the block's key figures, the whole story in
// its `title`, and whether the block needs you. It is worked out here, with no
// DOM and no clock of its own — the time is handed in — so what a line says
// can be tested without a window. `chipFor` is the same summary as plain text,
// and the source of the attention, the clock and the title the line carries.
//
// The one core file the Panel also loads, as a plain <script> before panel.js:
// the lines have to tick some figures every second, and that happens in the renderer,
// which cannot `require`. So it requires nothing, keeps its names inside one
// function, and hands itself to whichever of the two is asking. That is also
// why the block catalogue lives here: the reducer (deck.js), the preferences
// and the Panel all read this one list.

;(function share(root) {
  /** Past this much of the context, the Gauge's chip asks to be looked at. */
  const CONTEXT_ATTENTION = 80

  /** The latest event on the Events chip is cut at this many characters. */
  const EVENT_CLIP = 28

  /**
   * The Deck's own type size, in pixels as drawn (the CSS `--deck-font`): 10
   * to start, whole pixels from 9 to 14. Below 9 its figures stop being
   * legible; above 14 a Rail of 316 no longer holds a Plan row or three agent
   * cards side by side. The one definition the preferences, the main process,
   * the Panel and the Settings sheet all read.
   */
  const DECK_FONT = Object.freeze({ size: 10, min: 9, max: 14 })

  /** The step under way on the Plan chip is cut at this many characters. */
  const STEP_CLIP = 24

  /**
   * The five Deck blocks, in the order the Spine shows their buttons.
   * `abbreviation` is the switch's face and, in a Band, the chip's;
   * `preference` is the stored switch; `glyph` (a Phosphor icon) and `about`
   * are what the Panel draws and says of it. The Gauge (named Context on screen) comes first: it is what
   * the status line under the terminal used to show, and that line now prints
   * nothing — and so it is also the one block on before the user chooses
   * (`startsOn`): what was on screen stays on screen at no cost of a click.
   */
  const BLOCKS = Object.freeze(
    [
      { id: 'gauge', abbreviation: 'CTX', name: 'Context', preference: 'deckGauge', glyph: 'gauge', about: 'folder, model, context and plan limits', startsOn: true },
      { id: 'events', abbreviation: 'EVT', name: 'Events', preference: 'deckEvents', glyph: 'list-bullets', about: 'what happened, newest first' },
      { id: 'plan', abbreviation: 'PLN', name: 'Plan', preference: 'deckPlan', glyph: 'list-checks', about: 'the steps of the work under way' },
      { id: 'agents', abbreviation: 'AGT', name: 'Agents', preference: 'deckAgents', glyph: 'robot', about: 'the subagents at work' },
      { id: 'loops', abbreviation: 'LPS', name: 'Loops', preference: 'deckLoops', glyph: 'arrows-clockwise', about: 'model work no agent card owns' },
    ].map(Object.freeze),
  )

  const ABBREVIATION = Object.fromEntries(BLOCKS.map((block) => [block.id, block.abbreviation]))

  // --- What time alone settles ------------------------------------------------
  //
  // Hooks say when something starts and, usually, when it ends. An end that
  // never arrives would leave a clock running for good, so past a limit a thing
  // left running stops counting as running. The reducer applies these rules at
  // its next input; the Panel, between inputs, by its own clock — the same rule
  // in both, and the limit comes in the view.

  /** A subagent still marked running that has taken no step for `limit` ms. */
  function agentQuiet(agent, limit, now) {
    if (agent.status !== 'running' || !Number.isFinite(limit)) return false
    const seen = agent.lastSeen ?? agent.startedAt
    return seen !== null && seen !== undefined && now - seen >= limit
  }

  /** A compaction still marked running that began `limit` ms ago or more. */
  function compactionOverdue(compaction, limit, now) {
    if (!compaction.running || !Number.isFinite(limit)) return false
    return compaction.startedAt !== null && compaction.startedAt !== undefined && now - compaction.startedAt >= limit
  }

  /** A quiet agent, as it is taken to have ended: done, when it was last seen. */
  function quietened(agent) {
    return { ...agent, status: 'done', endedAt: agent.lastSeen ?? agent.startedAt }
  }

  function tallied(agents, status) {
    return agents.filter((agent) => agent.status === status).length
  }

  /**
   * A block's view as it stands at `now`: whatever its limits say has gone
   * quiet no longer counts as running. The same view comes back when nothing
   * has.
   */
  function settled(blockId, view, now) {
    if (!view) return view
    if (blockId === 'agents' && Array.isArray(view.agents)) {
      if (!view.agents.some((agent) => agentQuiet(agent, view.quietForMs, now))) return view
      const agents = view.agents.map((agent) => (agentQuiet(agent, view.quietForMs, now) ? quietened(agent) : agent))
      return { ...view, agents, running: tallied(agents, 'running'), done: tallied(agents, 'done'), failed: tallied(agents, 'failed') }
    }
    if (blockId === 'loops' && Array.isArray(view.compactions)) {
      if (!view.compactions.some((each) => compactionOverdue(each, view.compactionLimitMs, now))) return view
      const compactions = view.compactions.map((each) =>
        compactionOverdue(each, view.compactionLimitMs, now) ? { ...each, running: false } : each,
      )
      return { ...view, compactions }
    }
    return view
  }

  /** A span of time as a clock reads it: 0:42, 12:05, 1:02:09. */
  function elapsedText(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = String(seconds % 60).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }

  /** A percentage as the status line writes it: whole, or with one decimal. */
  function percentText(percent) {
    return Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, '')
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`
  }

  function clip(text, limit) {
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
  }

  function lines(...parts) {
    return parts.filter(Boolean).join('\n')
  }

  function gauge(view) {
    if (!view || !view.reported) {
      return {
        figures: '—',
        attention: null,
        live: false,
        title: 'Context · no figures yet. They arrive with Claude Code’s next answer.',
      }
    }
    const percent = view.context?.percent ?? null
    const fiveHour = view.limits?.fiveHour ?? null
    const sevenDay = view.limits?.sevenDay ?? null
    const compactions = view.context?.compactions?.length ?? 0
    const figures = [
      percent === null ? '—' : `${percentText(percent)}%`,
      fiveHour ? `5H ${percentText(fiveHour.percent)}%` : null,
    ].filter(Boolean)
    const setting = [view.model, view.effort, view.permissionMode].filter(Boolean).join(' · ')
    return {
      figures: figures.join(' · '),
      attention: percent !== null && percent > CONTEXT_ATTENTION ? 'warning' : null,
      live: false,
      title: lines(
        `Context · ${percent === null ? 'not reported' : `${percentText(percent)}% full`}`,
        view.folder ? `${view.folder}${view.branch ? ` (${view.branch})` : ''}` : null,
        compactions > 0 ? `${plural(compactions, 'compaction')} this session` : null,
        fiveHour ? `Five-hour limit ${percentText(fiveHour.percent)}%` : null,
        sevenDay ? `Seven-day limit ${percentText(sevenDay.percent)}%` : null,
        setting || null,
      ),
    }
  }

  function agents(view) {
    if (!view) return { figures: '0✓', attention: null, live: false, title: 'Agents · none yet' }
    const cutShort = view.agents.filter((agent) => agent.outOfOutput).length
    const figures = [view.running > 0 ? `${view.running}▶` : null, `${view.done}✓`, view.failed > 0 ? `${view.failed}✗` : null]
    return {
      figures: figures.filter(Boolean).join(' '),
      attention: view.failed > 0 || cutShort > 0 ? 'alarm' : null,
      // Time alone may settle one that went quiet.
      live: view.running > 0,
      title: lines(
        `Agents · ${view.running} running, ${view.done} done, ${view.failed} failed`,
        cutShort > 0 ? `${cutShort} ran out of output room` : null,
      ),
    }
  }

  /**
   * Running compactions and strays at work, counted the way the Loops block
   * draws them: a stray counts once its grace has passed and while it was seen
   * lately. Time alone changes that count, so the chip is live while either is.
   */
  function loops(view, now) {
    if (!view) return { figures: '0', attention: null, live: false, title: 'Loops · nothing loose' }
    const compacting = view.compactions.filter((compaction) => compaction.running).length
    const atWork = view.strays.filter((stray) => now - stray.lastSeen < view.liveForMs)
    const shown = atWork.filter((stray) => now - stray.firstSeen >= (view.graceMs ?? 0)).length
    return {
      figures: String(compacting + shown),
      attention: null,
      live: compacting > 0 || atWork.length > 0,
      title: lines(
        `Loops · ${compacting + shown} at work`,
        compacting > 0 ? `${plural(compacting, 'compaction')} running` : null,
        shown > 0 ? `${plural(shown, 'agent')} no card owns` : null,
        `${plural(view.compactions.length, 'compaction')} this session`,
      ),
    }
  }

  function events(view) {
    const entries = Array.isArray(view) ? view : []
    if (entries.length === 0) return { figures: '—', attention: null, live: false, title: 'Events · nothing yet' }
    const said = (entry) => [entry.label, entry.detail].filter(Boolean).join(' ')
    return {
      figures: clip(said(entries[0]), EVENT_CLIP),
      attention: null,
      live: false,
      title: lines(
        `Events · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first`,
        ...entries.slice(0, 5).map((entry) => [said(entry), entry.note].filter(Boolean).join(' — ')),
      ),
    }
  }

  /** A plan's row as one line: done of total, and the step under way or that it is done. */
  function planLine(row) {
    const doing = row.finished ? 'Done' : row.current
    return [`${row.done}/${row.total}`, doing].filter(Boolean).join(' · ')
  }

  /** The main plan's figures, or the first subagent's when the main conversation has none. */
  function plan(view) {
    const rows = Array.isArray(view?.rows) ? view.rows : []
    if (rows.length === 0) return { figures: '—', attention: null, live: false, title: 'Plan · no plan yet' }
    const first = rows[0]
    const doing = first.finished ? 'Done' : first.current
    return {
      figures: [`${first.done}/${first.total}`, doing && clip(doing, STEP_CLIP)].filter(Boolean).join(' · '),
      attention: null,
      live: false,
      title: lines(`Plan · ${plural(rows.length, 'plan')}`, ...rows.map((row) => `${row.title} · ${planLine(row)}`)),
    }
  }

  const CHIPS = { plan, gauge, agents, loops, events }

  /**
   * One block's chip: its abbreviation, its figures, the two as `text`, the
   * whole detail as `title`; `attention` is null, 'warning' or 'alarm'; `live`
   * says the text changes with time alone, so the chip wants a clock.
   */
  function chipFor(blockId, view, now) {
    const make = CHIPS[blockId]
    if (!make) return null
    const chip = make(settled(blockId, view ?? null, now), now)
    const abbreviation = ABBREVIATION[blockId]
    return { abbreviation, ...chip, text: `${abbreviation} ${chip.figures}` }
  }

  // --- The Deck as lines ------------------------------------------------------
  //
  // Down a side every block that is on is one dense line — a mark in its
  // colour, its abbreviation, its key figures — and a click opens its detail
  // under it. In a Band the same figures make its chip. A line is a list of
  // parts the Panel draws in order: words and figures, a tiny bar, one segment
  // per step, a glyph. Whether it needs you, whether
  // time alone moves it and its tooltip are the chip's, so the two never
  // disagree.

  /** Up to this many steps, the Plan's line draws one segment per step; past it, a plain bar. */
  const STEP_SEGMENTS = 16

  /**
   * The Deck's words are in sentence case: the first letter a capital, the
   * rest exactly as written. Nothing is ever lowered, because most of what the
   * Deck shows Claude Code wrote — a plan's steps, a subagent's task — and
   * "MCP API" or "ADR 0034" there are acronyms, not shouting. Acronyms of the
   * Deck's own (the abbreviations, 5H, 7D) are never handed to it.
   */
  function sentenceCase(text) {
    if (typeof text !== 'string' || text === '') return text
    return text[0].toUpperCase() + text.slice(1)
  }

  /**
   * Sentence case for a type name — an agent's type, a
   * compaction's trigger — which is an identifier rather than words anybody
   * wrote. One sent all in capitals ("EXPLORE") is a name, not an acronym, so
   * it is brought down ("Explore"); any other is only given its capital.
   */
  function typeCase(text) {
    if (typeof text !== 'string' || text === '') return text
    const shouting = /[A-Z]{2}/.test(text) && !/[a-z]/.test(text)
    return sentenceCase(shouting ? text[0] + text.slice(1).toLowerCase() : text)
  }

  /** A token count, short: 812, 48.2k, 1.3M. */
  function tokensText(count) {
    if (count < 1000) return String(count)
    if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  /** The hour and minute of a moment, as a wall clock shows them. */
  function hourText(at) {
    const when = new Date(at)
    return [when.getHours(), when.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
  }

  /** How long something has run, or ran; a dash when its start was never heard. */
  function tookText(item, now) {
    return item.startedAt === null || item.startedAt === undefined
      ? '—'
      : elapsedText((item.endedAt ?? now) - item.startedAt)
  }

  // A part of a line: `text` (words), with `figure` when it is a number to be
  // set in figures, `tone` ('quiet', 'live', 'warning' or
  // 'alarm'), `fill` for the one part that gives way when the line is short of
  // room, `verbatim` for what is shown exactly as Claude Code said it (a tool's
  // name, a path, a command), `written` for words Claude Code wrote that are
  // shown in sentence case (a plan's step) — capitals in them may be acronyms. Or a drawing: `bar` (a percentage), `steps` (a
  // status per step), `glyph`.
  const words = (text, more = {}) => ({ text, ...more })
  const figure = (text, more = {}) => ({ text, figure: true, ...more })
  const quiet = (text) => ({ text, tone: 'quiet' })

  function planParts(view) {
    const rows = Array.isArray(view?.rows) ? view.rows : []
    if (rows.length === 0) return [quiet('No plan yet')]
    const first = rows[0]
    const steps = !first.inAgent && Array.isArray(view.steps) ? view.steps : []
    const drawing =
      steps.length > 0 && steps.length <= STEP_SEGMENTS
        ? { steps: steps.map((step) => step.status) }
        : { bar: first.total === 0 ? 0 : Math.round((first.done / first.total) * 100) }
    const doing = first.finished ? 'Done' : sentenceCase(first.current ?? 'Waiting')
    return [
      drawing,
      figure(`${first.done}/${first.total}`),
      words(doing, { fill: true, written: Boolean(first.current) && !first.finished }),
      rows.length > 1 ? figure(`+${rows.length - 1}`, { tone: 'quiet' }) : null,
    ]
  }

  function gaugeParts(view) {
    if (!view || !view.reported) return [quiet('No figures yet')]
    const percent = view.context?.percent ?? null
    const fiveHour = view.limits?.fiveHour ?? null
    const sevenDay = view.limits?.sevenDay ?? null
    return [
      percent === null ? null : { bar: Math.min(100, Math.max(0, percent)) },
      figure(percent === null ? '—' : `${percentText(percent)}%`),
      fiveHour ? figure(`5H ${percentText(fiveHour.percent)}%`, { tone: 'quiet' }) : null,
      sevenDay ? figure(`7D ${percentText(sevenDay.percent)}%`, { tone: 'quiet' }) : null,
    ]
  }

  function agentsParts(view) {
    const list = Array.isArray(view?.agents) ? view.agents : []
    if (list.length === 0) return [quiet('No subagents yet')]
    const tokens = list.reduce((sum, agent) => sum + (agent.tokens?.total ?? 0), 0)
    return [
      view.running > 0 ? figure(`${view.running}▶`, { tone: 'live' }) : null,
      figure(`${view.done}✓`),
      view.failed > 0 ? figure(`${view.failed}✗`, { tone: 'alarm' }) : null,
      list.some((agent) => agent.outOfOutput) ? { glyph: 'flag', tone: 'alarm' } : null,
      tokens > 0 ? figure(`${tokensText(tokens)} tok`, { tone: 'quiet' }) : null,
    ]
  }

  function loopsParts(view, now) {
    if (!view) return [quiet('Nothing loose')]
    const compacting = view.compactions.find((compaction) => compaction.running)
    const strays = view.strays.filter((stray) => now - stray.firstSeen >= (view.graceMs ?? 0))
    const atWork = strays.filter((stray) => now - stray.lastSeen < view.liveForMs).length
    if (!compacting && atWork === 0) {
      if (view.compactions.length === 0 && strays.length === 0) return [quiet('Nothing loose')]
      return [
        quiet('Nothing at work'),
        view.compactions.length > 0 ? figure(plural(view.compactions.length, 'compaction'), { tone: 'quiet' }) : null,
      ]
    }
    return [
      compacting ? figure(`▶ ${tookText(compacting, now)}`, { tone: 'live' }) : null,
      compacting ? words('Compacting') : null,
      atWork > 0 ? figure(plural(atWork, 'stray'), { tone: compacting ? 'quiet' : 'live' }) : null,
    ]
  }

  /** The kinds of entry whose label is a subagent's type — a word — rather than a tool's name. */
  const TYPED = new Set(['spawn', 'done'])

  function eventsParts(view) {
    const entries = Array.isArray(view) ? view : []
    if (entries.length === 0) return [quiet('Nothing yet')]
    const latest = entries[0]
    const typed = TYPED.has(latest.kind) || latest.label === 'Prompt' || latest.label === 'Turn'
    const detail = latest.kind === 'edit' && latest.detail ? latest.detail.split(/[\\/]/).pop() : latest.detail
    return [
      figure(hourText(latest.at), { tone: 'quiet' }),
      typed ? words(typeCase(latest.label)) : words(latest.label, { verbatim: true }),
      detail ? words(detail, { tone: 'quiet', fill: true, verbatim: true }) : null,
    ]
  }

  const LINES = {
    plan: planParts,
    gauge: gaugeParts,
    agents: agentsParts,
    loops: loopsParts,
    events: eventsParts,
  }

  /**
   * One block's line: its abbreviation and its `parts`, the words of the two
   * as `text`, and the chip's `attention`, `live` and `title`. Down a side it
   * is the block's line; in a Band, its chip.
   */
  function lineFor(blockId, view, now) {
    const make = LINES[blockId]
    if (!make) return null
    const chip = chipFor(blockId, view, now)
    const parts = make(settled(blockId, view ?? null, now), now).filter(Boolean)
    const said = parts.filter((part) => typeof part.text === 'string').map((part) => part.text)
    return {
      abbreviation: chip.abbreviation,
      parts,
      text: [chip.abbreviation, ...said].join(' '),
      attention: chip.attention,
      live: chip.live,
      title: chip.title,
    }
  }

  // --- The figure on a block's Spine button ---------------------------------
  //
  // While a block is on, its button on the Spine carries one figure under its
  // abbreviation — the one a glance is for. Four characters at most: the
  // button is 44 points wide. A figure that will not fit is said another way —
  // a count past 999 as "999+", a Plan's done of total as how far along it is
  // — and never cut, since a cut figure reads as a different one ("10/100" cut
  // to "10/10" would look finished).

  const FIGURE_WIDTH = 4

  /** A count as it fits: past 999 it is "999+". */
  function countText(count) {
    return count > 999 ? '999+' : String(count)
  }

  function figureOrDash(count) {
    return count > 0 ? countText(count) : '—'
  }

  /**
   * A Plan's progress: done of total while that fits, else the share done,
   * rounded down so a Plan short of its end never reads 100%.
   */
  function progressText(done, total) {
    const fraction = `${done}/${total}`
    if (fraction.length <= FIGURE_WIDTH) return fraction
    return `${Math.min(100, Math.floor((done / total) * 100))}%`
  }

  /** A count of agents and the mark after it: "2▶", "99+▶" past 99. */
  function agentsText(count, mark) {
    return `${count > 99 ? '99+' : count}${mark}`
  }

  const FIGURES = {
    gauge: (view) => {
      const percent = view?.reported ? view.context?.percent ?? null : null
      return percent === null ? '—' : `${Math.round(percent)}%`
    },
    plan: (view) => {
      const first = Array.isArray(view?.rows) ? view.rows[0] : null
      return first ? progressText(first.done, first.total) : '—'
    },
    agents: (view) => {
      if (!view) return '0✓'
      const running = view.running ?? 0
      return running > 0 ? agentsText(running, '▶') : agentsText(view.done ?? 0, '✓')
    },
    loops: (view, now) => countText(Number(chipFor('loops', view, now).figures)),
    events: (view) => figureOrDash(Array.isArray(view) ? view.length : 0),
  }

  /** A block's one figure for its Spine button; null for an id that is not a block. */
  function spineFigure(blockId, view, now) {
    const make = FIGURES[blockId]
    if (!make) return null
    return make(settled(blockId, view ?? null, now), now)
  }

  const api = {
    BLOCKS,
    spineFigure,
    DECK_FONT,
    chipFor,
    lineFor,
    sentenceCase,
    typeCase,
    tokensText,
    CONTEXT_ATTENTION,
    elapsedText,
    percentText,
    agentQuiet,
    compactionOverdue,
    settled,
  }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.deckChips = Object.freeze(api)
})(globalThis)
