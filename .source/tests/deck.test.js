import { describe, expect, it } from 'vitest'
import { BLOCKS, initialDeck, reduce, view } from '../src/core/deck.js'
import { agentEvent, decodeStatus } from '../src/core/hook-payload.js'
import { agent } from '../src/core/events.js'
import { HIDDEN } from '../src/core/mask.js'
import { fixture } from './helpers.js'

// The Deck is one reducer over what Claude Code reports, and every block is a
// view of its state. These tests feed it the decoded payloads Claude Code really
// sends and check what a block would show — never the reducer's private shape.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'

/** Each event in turn, one second apart, from an empty Deck. */
function feed(events, deck = initialDeck()) {
  let at = 1_000_000
  for (const event of events) {
    at += 1000
    deck = reduce(deck, event, at)
  }
  return deck
}

const decoded = (name) => agentEvent(fixture(name))
const events = (deck) => view(deck).events

describe('the five blocks', () => {
  it('are named, abbreviated and stored, in the order the Session card shows them', () => {
    expect(BLOCKS.map((block) => [block.id, block.abbreviation, block.preference])).toEqual([
      ['gauge', 'CTX', 'deckGauge'],
      ['events', 'EVT', 'deckEvents'],
      ['plan', 'PLN', 'deckPlan'],
      ['agents', 'AGT', 'deckAgents'],
      ['loops', 'LPS', 'deckLoops'],
    ])
  })

  it('start off, all but the Gauge', () => {
    expect(BLOCKS.filter((block) => block.startsOn).map((block) => block.id)).toEqual(['gauge'])
  })
})

describe('the Events block', () => {
  it('is empty before Claude Code has said anything', () => {
    expect(events(initialDeck())).toEqual([])
  })

  it('lists prompts, spawns, completions, edits, errors and denials, newest first', () => {
    const deck = feed([
      agent.userPromptSubmitted(SESSION, 'diga apenas: ok'),
      decoded('subagent-start'),
      decoded('subagent-stop'),
      decoded('post-tool-use'),
      decoded('post-tool-use-failure'),
      decoded('permission-denied'),
    ])

    expect(events(deck).map((entry) => [entry.kind, entry.label])).toEqual([
      ['denied', 'Bash'],
      ['error', 'Bash'],
      ['edit', 'Edit'],
      ['done', 'Explore'],
      ['spawn', 'Explore'],
      ['prompt', 'Prompt'],
    ])
  })

  it('says what each one was about', () => {
    const deck = feed([
      agent.userPromptSubmitted(SESSION, 'diga apenas: ok'),
      decoded('post-tool-use'),
      decoded('post-tool-use-failure'),
      decoded('permission-denied'),
      decoded('subagent-stop'),
    ])
    const [done, denied, error, edit, prompt] = events(deck)

    expect(prompt.detail).toBe('diga apenas: ok')
    expect(edit.detail).toBe('C:\\Jarvis\\.source\\src\\core\\deck.js')
    expect(error).toMatchObject({ detail: 'npm test', note: 'Exit code 1' })
    expect(denied).toMatchObject({
      detail: 'rm -rf C:\\Jarvis\\Resources',
      note: 'Deleting a folder outside the working tree is not allowed in auto mode',
    })
    expect(done.detail).toBe('The installer lives in src/core/hook-installer.js.')
  })

  it('stamps each entry with the time it happened', () => {
    const deck = reduce(initialDeck(), decoded('post-tool-use'), 1234)
    expect(events(deck)[0].at).toBe(1234)
  })

  it('counts an advisor or an architect as a subagent like any other', () => {
    const deck = feed([
      agent.subagentStarted(SESSION, { agentId: 'a1', agentType: 'Advisor' }),
      agent.subagentStarted(SESSION, { agentId: 'a2', agentType: 'software-architect' }),
    ])
    expect(events(deck).map((entry) => entry.kind)).toEqual(['spawn', 'spawn'])
  })

  it('counts only the tools that change a file as edits', () => {
    const finished = (toolName) =>
      agent.toolFinished(SESSION, { toolName, toolUseId: toolName, detail: 'C:\\a.txt' })
    const deck = feed(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Bash', 'Grep'].map(finished))
    expect(events(deck).map((entry) => entry.label)).toEqual(['NotebookEdit', 'MultiEdit', 'Write', 'Edit'])
  })

  it('lists a turn that ended on an error', () => {
    const deck = feed([decoded('stop-failure')])
    expect(events(deck)[0]).toMatchObject({
      kind: 'error',
      label: 'Turn',
      detail: 'rate_limit',
      note: '429 Too Many Requests: rate limit reached for the five-hour window',
    })
  })

  it('says when a failed call was stopped by the user rather than failing', () => {
    const deck = feed([
      agent.toolFailed(SESSION, { toolName: 'Bash', toolUseId: 't', detail: 'sleep 99', interrupted: true }),
    ])
    expect(events(deck)[0]).toMatchObject({ kind: 'error', note: 'Interrupted' })
  })

  it('marks what happened inside a subagent', () => {
    const inside = agent.toolFinished(SESSION, {
      toolName: 'Edit',
      toolUseId: 't',
      detail: 'C:\\a.txt',
      agentId: 'a3f9c2e1b7d04e58',
      agentType: 'Explore',
    })
    const deck = feed([decoded('post-tool-use'), inside])
    expect(events(deck).map((entry) => entry.inAgent)).toEqual([true, false])
  })

  it('leaves out what it does not list: calls starting, compactions, sessions', () => {
    const deck = feed([
      decoded('pre-tool-use'),
      decoded('pre-compact'),
      decoded('post-compact'),
      agent.sessionStarted(SESSION, 'startup'),
      agent.assistantFinished(SESSION, 'Done.'),
    ])
    expect(events(deck)).toEqual([])
  })

  it('keeps the last hundred', () => {
    const prompts = Array.from({ length: 130 }, (_, index) =>
      agent.userPromptSubmitted(SESSION, `prompt ${index}`),
    )
    const listed = events(feed(prompts))

    expect(listed).toHaveLength(100)
    expect(listed[0].detail).toBe('prompt 129')
    expect(listed[99].detail).toBe('prompt 30')
  })

  it('gives every entry its own id, so a list can be redrawn by key', () => {
    const listed = events(feed([decoded('post-tool-use'), decoded('post-tool-use')]))
    expect(new Set(listed.map((entry) => entry.id)).size).toBe(2)
  })
})

describe('what the Deck will not hold', () => {
  it('masks a secret in a detail before keeping it', () => {
    const deck = feed([
      agent.toolFailed(SESSION, {
        toolName: 'Bash',
        toolUseId: 't',
        detail: 'curl -H "Authorization: Bearer abc.def" https://x.example',
        error: 'export API_KEY=abc123 failed',
      }),
      agent.userPromptSubmitted(SESSION, 'use password: hunter2 for the database'),
    ])
    const [prompt, error] = events(deck)

    expect(error.detail).toBe(`curl -H "Authorization: Bearer ${HIDDEN}" https://x.example`)
    expect(error.note).toBe(`export API_KEY=${HIDDEN} failed`)
    expect(prompt.detail).toBe(`use password: ${HIDDEN} for the database`)
    expect(JSON.stringify(deck)).not.toContain('hunter2')
    expect(JSON.stringify(deck)).not.toContain('abc123')
  })

  it('keeps a long detail to a line, not a page', () => {
    const deck = feed([agent.userPromptSubmitted(SESSION, 'x'.repeat(5000))])
    expect(events(deck)[0].detail.length).toBeLessThanOrEqual(240)
  })
})

describe('one Claude Code conversation at a time', () => {
  it('clears itself when a new conversation is adopted', () => {
    let deck = feed([decoded('post-tool-use'), decoded('permission-denied')])
    expect(events(deck)).toHaveLength(2)

    deck = reduce(deck, agent.sessionStarted('another-conversation', 'clear'), 5)
    expect(events(deck)).toEqual([])

    deck = reduce(deck, agent.userPromptSubmitted('another-conversation', 'olá'), 6)
    expect(events(deck).map((entry) => entry.detail)).toEqual(['olá'])
  })

  it('keeps what it has when the conversation ends', () => {
    let deck = feed([decoded('post-tool-use')])
    deck = reduce(deck, agent.sessionEnded(SESSION), 9)
    expect(events(deck)).toHaveLength(1)
  })
})

describe('telling the Session whether anything changed', () => {
  it('hands back the same state when an event changes nothing it shows', () => {
    const deck = feed([decoded('post-tool-use')])
    expect(reduce(deck, agent.sessionEnded(SESSION), 7)).toBe(deck)
  })

  it('never changes the state it was given', () => {
    const deck = feed([decoded('post-tool-use')])
    const before = JSON.stringify(deck)
    reduce(deck, decoded('permission-denied'), 8)
    expect(JSON.stringify(deck)).toBe(before)
  })
})

describe('the Gauge', () => {
  const read = (name, extra = {}) =>
    decodeStatus({ ...JSON.parse(fixture(name)), ...extra, jarvis_reading: 'status' }).event
  const gauge = (deck) => view(deck).gauge

  it('has no figures before the status line has reported', () => {
    expect(gauge(initialDeck())).toEqual({
      reported: false,
      folder: null,
      branch: null,
      context: { percent: null, compactions: [] },
      limits: { fiveHour: null, sevenDay: null },
      model: null,
      effort: null,
      permissionMode: null,
    })
  })

  it('shows the context, the plan limits and the model from a reading', () => {
    expect(gauge(feed([read('status-line')]))).toEqual({
      reported: true,
      folder: 'C:\\nowhere-jarvis',
      branch: null,
      context: { percent: 62, compactions: [] },
      limits: {
        fiveHour: { percent: 40.49999, resetsAt: 1760340000000 },
        sevenDay: { percent: 12, resetsAt: 1760900000000 },
      },
      model: 'Opus 4.7',
      effort: 'high',
      permissionMode: null,
    })
  })

  it('leaves the limits absent, not zero, when the plan does not report them', () => {
    const shown = gauge(feed([read('status-line-early')]))
    expect(shown.reported).toBe(true)
    expect(shown.limits).toEqual({ fiveHour: null, sevenDay: null })
    expect(shown.context.percent).toBeNull()
  })

  it('shows the latest reading', () => {
    const later = read('status-line', {
      model: { display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 71 },
    })
    const shown = gauge(feed([read('status-line'), later]))
    expect(shown.model).toBe('Sonnet 4.6')
    expect(shown.context.percent).toBe(71)
  })

  it('takes the permission mode and the effort from the hooks that carry them', () => {
    const shown = gauge(feed([read('status-line'), decoded('pre-tool-use')]))
    expect(shown.permissionMode).toBe('default')
    // The hook came after the reading, so its effort is the current one.
    expect(shown.effort).toBe('xhigh')

    const prompt = agentEvent(fixture('user-prompt-submit'))
    expect(gauge(feed([prompt])).permissionMode).toBe('auto')
  })

  it('marks each compaction on the bar where the context stood when it began', () => {
    const deck = feed([read('status-line'), decoded('pre-compact')])
    expect(gauge(deck).context.compactions).toEqual([{ percent: 62, trigger: 'auto', running: true }])

    const after = feed([decoded('post-compact'), read('status-line', { context_window: { used_percentage: 9 } })], deck)
    expect(gauge(after).context).toEqual({
      percent: 9,
      compactions: [{ percent: 62, trigger: 'auto', running: false }],
    })
  })

  it('marks a compaction it only saw finish', () => {
    const deck = feed([read('status-line'), decoded('post-compact')])
    expect(gauge(deck).context.compactions).toEqual([{ percent: 62, trigger: 'auto', running: false }])
  })

  it('marks a compaction without a place on the bar when no figure came before it', () => {
    const deck = feed([decoded('pre-compact')])
    expect(gauge(deck).context.compactions).toEqual([{ percent: null, trigger: 'auto', running: true }])
  })

  it('hands back the same state for a reading that changes nothing', () => {
    const deck = feed([read('status-line')])
    expect(reduce(deck, read('status-line'), 99)).toBe(deck)
  })

  it('starts afresh for a reading from another conversation', () => {
    let deck = feed([read('status-line'), decoded('pre-compact')])
    deck = reduce(deck, { ...read('status-line-early'), sessionId: 'another-conversation' }, 5)
    expect(gauge(deck).context.compactions).toEqual([])
    expect(gauge(deck).model).toBe('Sonnet 4.6')
  })

  it('never lists a reading among the Events', () => {
    expect(events(feed([read('status-line')]))).toEqual([])
  })
})
