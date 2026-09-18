import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agent, user, incoming } from '../src/core/events.js'
import { EntryKind, entry } from '../src/core/effects.js'
import { EVENTS } from '../src/core/hook-installer.js'
import { decode } from '../src/core/hook-payload.js'
import { fixture, loggedEntries } from './helpers.js'

// The original ask was "log everything in text". Dictating is only one of the
// ways a message reaches Claude Code — typing straight into the terminal is the
// other, and it used to go unnoticed.

const PROJECT = 'C:\\project'
const SESSION = 's1'

function silentCore() {
  const core = new JarvisCore()
  core.dispatch(user.projectOpened(PROJECT))
  core.dispatch(user.autoReadSet(false))
  return core
}

function arriving(event) {
  return incoming(event, PROJECT)
}

describe('what reaches the Transcript', () => {
  it('writes a message typed straight into the terminal', () => {
    const core = silentCore()
    const effects = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'fix the build')))

    expect(loggedEntries(effects)).toEqual([entry(EntryKind.userTyped, 'fix the build')])
  })

  it('marks a dictated message as voice, not as keyboard', () => {
    const core = silentCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.dictationFinal('fix the build'))

    const effects = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'fix the build')))
    expect(loggedEntries(effects)).toEqual([entry(EntryKind.userVoice, 'fix the build')])
  })

  it('writes a dictated message exactly once', () => {
    // Dictating and submitting are two distinct moments; the Transcript is one.
    const core = silentCore()
    core.dispatch(user.micPressed())
    const whenDictated = core.dispatch(user.dictationFinal('hi'))
    expect(loggedEntries(whenDictated)).toEqual([])

    const whenSubmitted = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'hi')))
    expect(loggedEntries(whenSubmitted)).toHaveLength(1)
  })

  it('counts text dictated then edited before sending as typed', () => {
    // If you corrected the transcription before sending, what was sent is no
    // longer what you said — and the Transcript has to say so.
    const core = silentCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.dictationFinal('fix the bild'))

    const effects = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'fix the build')))
    expect(loggedEntries(effects)[0].kind).toBe(EntryKind.userTyped)
  })

  it('lets one submit consume the Dictation, so a repeat is not marked as voice', () => {
    const core = silentCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.dictationFinal('first'))
    core.receive(arriving(agent.userPromptSubmitted(SESSION, 'first')))

    const effects = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'first')))
    expect(loggedEntries(effects)[0].kind).toBe(EntryKind.userTyped)
  })

  it('neither speaks nor answers a submitted message — it only writes it', () => {
    const core = silentCore()
    core.dispatch(user.autoReadSet(true))
    const effects = core.receive(arriving(agent.userPromptSubmitted(SESSION, 'hi')))

    expect(effects).toHaveLength(1)
    expect(effects[0].type).toBe('log')
  })

  it('ignores a message from another session', () => {
    const core = silentCore()
    core.receive(arriving(agent.assistantFinished(SESSION, 'hi')))
    const effects = core.receive(arriving(agent.userPromptSubmitted('other', 'not for me')))

    expect(effects).toEqual([])
  })

  it('ignores a blank message', () => {
    const core = silentCore()
    expect(core.receive(arriving(agent.userPromptSubmitted(SESSION, '   ')))).toEqual([])
  })
})

describe('the submitted-message hook', () => {
  it('carries the text and the folder, in a real captured event', () => {
    const decoded = decode(fixture('user-prompt-submit'))

    expect(decoded.event.type).toBe('userPromptSubmitted')
    expect(decoded.event.text).toBe('diga apenas: ok')
    expect(decoded.workingDirectory).toBe('/Users/you/Downloads/Jarvis')
  })

  it('is one of the hooks Jarvis installs', () => {
    expect(EVENTS).toContain('UserPromptSubmit')
  })
})
