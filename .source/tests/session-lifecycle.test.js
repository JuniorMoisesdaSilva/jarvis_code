import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agent, user, incoming } from '../src/core/events.js'
import { decode } from '../src/core/hook-payload.js'
import { hasEffect, spokenTexts } from './helpers.js'

// A session can end in two ways: Claude Code says it is over, or the terminal
// simply vanishes. In both cases silence is the worst possible answer — someone
// with their eyes off the screen is left waiting for something that never comes.

const PROJECT = 'C:\\project'
const SESSION = 's1'

function coreInConversation({ autoRead = true } = {}) {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT))
  core.dispatch(user.autoReadSet(autoRead))
  core.receive(incoming(agent.assistantFinished(SESSION, 'hi'), PROJECT))
  core.dispatch(user.speechFinished())
  return core
}

describe('being told a session ended', () => {
  it('leaves a notice in the Panel when Claude Code says it is over', () => {
    const core = coreInConversation()
    core.receive(incoming(agent.sessionEnded(SESSION), PROJECT))

    expect(core.state.notice).not.toBeNull()
  })

  it('announces a terminal that vanished, too', () => {
    const core = coreInConversation()
    const effects = core.dispatch(user.sessionLost())

    expect(core.state.notice).not.toBeNull()
    expect(spokenTexts(effects)).toHaveLength(1)
  })

  it('speaks the notice when read-aloud is on', () => {
    const core = coreInConversation({ autoRead: true })
    const effects = core.dispatch(user.sessionLost())

    expect(spokenTexts(effects)).toEqual(['A sessão do Claude Code foi encerrada.'])
  })

  it('only writes the notice when read-aloud is off', () => {
    const core = coreInConversation({ autoRead: false })
    const effects = core.dispatch(user.sessionLost())

    expect(spokenTexts(effects)).toEqual([])
    expect(core.state.notice).not.toBeNull()
  })

  it('comes out in the chosen language', () => {
    const core = coreInConversation()
    core.dispatch(user.languageToggled())
    const effects = core.dispatch(user.sessionLost())

    expect(spokenTexts(effects)).toEqual(['The Claude Code session has ended.'])
  })

  it('says nothing when you ended it yourself', () => {
    // You asked for it to close; being told about it would be noise.
    const core = coreInConversation()
    core.dispatch(user.projectClosed())

    expect(core.state.notice).toBeNull()
    expect(core.hasLiveSession).toBe(false)
  })

  it('does not warn twice about a session that had already ended', () => {
    const core = coreInConversation()
    core.dispatch(user.sessionLost())
    core.clearNotice()

    expect(core.dispatch(user.sessionLost())).toEqual([])
    expect(core.state.notice).toBeNull()
  })
})

describe('the state after a session ends', () => {
  it('goes back to having no session', () => {
    const core = coreInConversation()
    core.dispatch(user.sessionLost())

    expect(core.state.activeSessionId).toBeNull()
    expect(core.hasLiveSession).toBe(false)
  })

  it('interrupts a Reading and a Dictation in progress', () => {
    const core = coreInConversation()
    core.dispatch(user.micPressed())
    core.receive(incoming(agent.assistantFinished(SESSION, 'a long answer'), PROJECT))

    const effects = core.dispatch(user.sessionLost())
    expect(hasEffect(effects, 'stopSpeaking')).toBe(true)
    expect(hasEffect(effects, 'cancelListening')).toBe(true)
  })

  it('clears the notice once a new session begins', () => {
    const core = coreInConversation()
    core.dispatch(user.sessionLost())
    expect(core.state.notice).not.toBeNull()

    core.dispatch(user.projectOpened(PROJECT))
    expect(core.state.notice).toBeNull()
  })
})

describe('reconnecting', () => {
  it('restores the session without waiting for an event', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.dispatch(user.sessionRestored(SESSION))

    expect(core.state.activeSessionId).toBe(SESSION)
    expect(core.hasLiveSession).toBe(true)
  })

  it('receives that session own events afterwards', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.dispatch(user.sessionRestored(SESSION))

    const effects = core.receive(incoming(agent.assistantFinished(SESSION, 'back'), PROJECT))
    expect(effects.length).toBeGreaterThan(0)
  })

  it('ignores another session running in the same folder', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.dispatch(user.sessionRestored(SESSION))

    expect(core.receive(incoming(agent.assistantFinished('other', 'no'), PROJECT))).toEqual([])
  })
})

// Claude Code announces itself when it opens, and that announcement is the only
// one that arrives before the conversation does. It is what tells Jarvis there
// is something in the terminal that reads requests rather than shell commands.
describe('Claude Code opening', () => {
  it('makes the session live before a word is exchanged', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.receive(incoming(agent.sessionStarted(SESSION, 'startup'), PROJECT))

    expect(core.state.activeSessionId).toBe(SESSION)
    expect(core.hasLiveSession).toBe(true)
  })

  it('says nothing on its own', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))

    const effects = core.receive(incoming(agent.sessionStarted(SESSION, 'startup'), PROJECT))
    expect(effects).toEqual([])
  })

  it('ignores one opened in another folder', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.receive(incoming(agent.sessionStarted(SESSION, 'startup'), 'C:\elsewhere'))

    expect(core.hasLiveSession).toBe(false)
  })

  it('does not hand the session over to a second Claude Code in the same folder', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened(PROJECT))
    core.receive(incoming(agent.sessionStarted(SESSION, 'startup'), PROJECT))
    core.receive(incoming(agent.sessionStarted('other', 'startup'), PROJECT))

    expect(core.state.activeSessionId).toBe(SESSION)
  })

  it('carries the tool own word for why it started', () => {
    const decoded = decode(
      JSON.stringify({
        session_id: SESSION,
        cwd: PROJECT,
        hook_event_name: 'SessionStart',
        source: 'resume',
      }),
    )

    expect(decoded.event).toEqual(agent.sessionStarted(SESSION, 'resume'))
    expect(decoded.workingDirectory).toBe(PROJECT)
  })
})
