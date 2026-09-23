import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agent, user, incoming } from '../src/core/events.js'
import { decode } from '../src/core/hook-payload.js'
import { hasEffect } from './helpers.js'

// Jarvis's hooks are global: every Claude Code session on the machine sends
// events, including ones it did not open. These rules decide which to listen to.
//
// The comparison is plain text: resolving links and short names touches the disk
// and is the adapter's job, so the rule can be tested without a file system. The
// case-folding is not, though — Windows hands the same folder back written
// differently depending on who was asked, so that part belongs right here.

const PROJECT = 'C:\\Projects\\alpha'
const OTHER_PROJECT = 'C:\\Projects\\beta'

function coreWithProjectOpen() {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT))
  return core
}

function arriving(event, path = null, terminal = null) {
  return incoming(event, path, terminal)
}

describe('which session Jarvis answers to', () => {
  it('answers an event from the open project', () => {
    const core = coreWithProjectOpen()
    const effects = core.receive(arriving(agent.assistantFinished('s1', 'done'), PROJECT))

    expect(effects.length).toBeGreaterThan(0)
    expect(core.state.activeSessionId).toBe('s1')
  })

  it('ignores an event from another project', () => {
    const core = coreWithProjectOpen()
    const effects = core.receive(
      arriving(agent.assistantFinished('s2', 'not for me'), OTHER_PROJECT),
    )

    expect(effects).toEqual([])
    expect(core.state.activeSessionId).toBeNull()
    expect(core.state.lastAssistantText).toBeNull()
  })

  it('answers nothing at all while no project is open', () => {
    const core = new JarvisCore()
    expect(core.receive(arriving(agent.assistantFinished('s1', 'done'), PROJECT))).toEqual([])
  })

  it('ignores an event that does not say where it came from', () => {
    // Without knowing the folder, there is no way to claim it is the right
    // session.
    const core = coreWithProjectOpen()
    expect(core.receive(arriving(agent.assistantFinished('s1', 'done'), null))).toEqual([])
  })

  it('matches the same folder written with different casing', () => {
    // Windows hands the same folder back differently depending on who was asked;
    // a case-sensitive comparison here would make Jarvis look completely dead.
    const core = coreWithProjectOpen()
    const effects = core.receive(
      arriving(agent.assistantFinished('s1', 'done'), 'c:\\projects\\ALPHA'),
    )

    expect(effects.length).toBeGreaterThan(0)
  })

  it('matches the same folder written with forward slashes', () => {
    const core = coreWithProjectOpen()
    const effects = core.receive(arriving(agent.assistantFinished('s1', 'done'), 'C:/Projects/alpha'))

    expect(effects.length).toBeGreaterThan(0)
  })

  it('adopts only the first of two sessions in the same folder', () => {
    // Two Claude Code windows on the same project: speaking both at once would
    // be worse than picking one.
    const core = coreWithProjectOpen()
    core.receive(arriving(agent.assistantFinished('s1', 'first'), PROJECT))
    const effects = core.receive(arriving(agent.assistantFinished('s2', 'second'), PROJECT))

    expect(effects).toEqual([])
    expect(core.state.lastAssistantText).toBe('first')
  })
})

describe('opening another project', () => {
  it('breaks the link to the previous session', () => {
    const core = coreWithProjectOpen()
    core.receive(arriving(agent.assistantFinished('s1', 'hi'), PROJECT))
    expect(core.state.activeSessionId).toBe('s1')

    core.dispatch(user.projectOpened(OTHER_PROJECT))
    expect(core.state.activeSessionId).toBeNull()

    // The old session is now ignored; the new one is adopted.
    expect(core.receive(arriving(agent.assistantFinished('s1', 'old'), PROJECT))).toEqual([])
    core.receive(arriving(agent.assistantFinished('s9', 'new'), OTHER_PROJECT))
    expect(core.state.activeSessionId).toBe('s9')
  })

  it('leaves no previous answer to re-read', () => {
    // The re-read button would speak the answer of a project you already closed
    // — confusing, and in the wrong context on top of that.
    const core = coreWithProjectOpen()
    core.receive(arriving(agent.assistantFinished('s1', 'from alpha'), PROJECT))
    expect(core.state.lastAssistantText).not.toBeNull()

    core.dispatch(user.projectOpened(OTHER_PROJECT))
    expect(core.state.lastAssistantText).toBeNull()
    expect(core.dispatch(user.repeatLastPressed())).toEqual([])
  })

  it('forgets a Dictation that had not been submitted yet', () => {
    const core = coreWithProjectOpen()
    core.dispatch(user.micPressed())
    core.dispatch(user.dictationFinal('pending sentence'))

    core.dispatch(user.projectOpened(OTHER_PROJECT))
    expect(core.state.lastDictatedText).toBeNull()
  })
})

describe('closing the project', () => {
  it('silences everything that arrives afterwards', () => {
    const core = coreWithProjectOpen()
    core.receive(arriving(agent.assistantFinished('s1', 'hi'), PROJECT))

    core.dispatch(user.projectClosed())
    expect(core.state.projectPath).toBeNull()
    expect(core.receive(arriving(agent.assistantFinished('s1', 'hi again'), PROJECT))).toEqual([])
  })

  it('interrupts a Reading and a Dictation in progress', () => {
    const core = coreWithProjectOpen()
    core.dispatch(user.micPressed())
    core.receive(arriving(agent.assistantFinished('s1', 'answer'), PROJECT))

    const effects = core.dispatch(user.projectClosed())
    expect(hasEffect(effects, 'stopSpeaking')).toBe(true)
    expect(hasEffect(effects, 'cancelListening')).toBe(true)
  })
})

// A Claude Code that ends without saying so — a crash, a killed window, an
// update that restarts it — leaves Jarvis holding a conversation nobody is in,
// and the one that follows it in the same terminal was discarded as "a second
// session". Every answer went unspoken on 23 September 2026 for that reason.
// The terminal Jarvis opened marks what runs in it, so its own sessions are told
// apart from someone else's window on the same folder.
describe('the terminal Jarvis opened', () => {
  const TERMINAL = 't1'

  function coreWithOwnTerminal() {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT, TERMINAL))
    return core
  }

  it('hands the conversation over to a new session started in it', () => {
    const core = coreWithOwnTerminal()
    core.receive(arriving(agent.sessionStarted('s1', 'startup'), PROJECT, TERMINAL))
    core.receive(arriving(agent.sessionStarted('s2', 'startup'), PROJECT, TERMINAL))

    expect(core.state.activeSessionId).toBe('s2')
    const effects = core.receive(arriving(agent.assistantFinished('s2', 'heard'), PROJECT, TERMINAL))
    expect(effects.length).toBeGreaterThan(0)
  })

  it('wins over a session restored from last time', () => {
    const core = coreWithOwnTerminal()
    core.dispatch(user.sessionRestored('stale'))
    const effects = core.receive(arriving(agent.assistantFinished('fresh', 'heard'), PROJECT, TERMINAL))

    expect(effects.length).toBeGreaterThan(0)
    expect(core.state.activeSessionId).toBe('fresh')
  })

  it('does not let another window on the same folder take over', () => {
    const core = coreWithOwnTerminal()
    core.receive(arriving(agent.sessionStarted('s1', 'startup'), PROJECT, TERMINAL))
    core.receive(arriving(agent.sessionStarted('s2', 'startup'), PROJECT, 'someone-else'))
    core.receive(arriving(agent.sessionStarted('s3', 'startup'), PROJECT))

    expect(core.state.activeSessionId).toBe('s1')
  })

  it('does not end the conversation over an ending that is not its own', () => {
    const core = coreWithOwnTerminal()
    core.receive(arriving(agent.sessionStarted('s1', 'startup'), PROJECT, TERMINAL))
    core.receive(arriving(agent.sessionEnded('s0'), PROJECT, TERMINAL))

    expect(core.state.activeSessionId).toBe('s1')
  })

  it('still needs to be in the open project', () => {
    const core = coreWithOwnTerminal()
    core.receive(arriving(agent.sessionStarted('s1', 'startup'), OTHER_PROJECT, TERMINAL))

    expect(core.state.activeSessionId).toBeNull()
  })
})

describe('the mark of the terminal on the way in', () => {
  it('travels from the relay into the event', () => {
    const decoded = decode(
      JSON.stringify({
        session_id: 's1',
        cwd: PROJECT,
        hook_event_name: 'SessionStart',
        source: 'startup',
        jarvis_terminal: 't1',
      }),
    )
    expect(decoded.terminal).toBe('t1')
  })

  it('is absent from a session Jarvis did not open', () => {
    const decoded = decode(
      JSON.stringify({ session_id: 's1', cwd: PROJECT, hook_event_name: 'SessionStart' }),
    )
    expect(decoded.terminal).toBeNull()
  })
})
