import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agent, user, incoming } from '../src/core/events.js'
import { Sound, EntryKind, entry, effect } from '../src/core/effects.js'
import { PORTUGUESE, ENGLISH } from '../src/core/language.js'
import { decode, agentEvent } from '../src/core/hook-payload.js'
import { fixture, hasEffect } from './helpers.js'

const SESSION = 'session-1'

/** Exercises the whole app through its main seam: events in, effects out. */
function attachedCore({ autoRead = true, language = PORTUGUESE } = {}) {
  return new JarvisCore({
    autoRead,
    language,
    activeSessionId: SESSION,
    projectPath: '/project',
  })
}

describe('reading answers aloud', () => {
  it('speaks a finished answer when read-aloud is on', () => {
    const core = attachedCore({ autoRead: true })
    const effects = core.handleAgentEvent(agent.assistantFinished(SESSION, 'All good.'))

    expect(effects).toEqual([
      effect.log(entry(EntryKind.assistant, 'All good.')),
      effect.speak('All good.', PORTUGUESE),
    ])
    expect(core.state.isSpeaking).toBe(true)
  })

  it('writes but does not speak when read-aloud is off', () => {
    const core = attachedCore({ autoRead: false })
    const effects = core.handleAgentEvent(agent.assistantFinished(SESSION, 'All good.'))

    expect(effects).toEqual([effect.log(entry(EntryKind.assistant, 'All good.'))])
    expect(core.state.isSpeaking).toBe(false)
  })

  it('filters the answer before speaking it', () => {
    const core = attachedCore()
    const effects = core.handleAgentEvent(
      agent.assistantFinished(SESSION, 'Done:\n```js\nconst x = 1\n```'),
    )

    expect(effects.at(-1)).toEqual(effect.speak('Done:\ntrecho de código omitido.', PORTUGUESE))
  })

  it('says nothing when the filter leaves the answer empty', () => {
    const core = attachedCore()
    const effects = core.handleAgentEvent(agent.assistantFinished(SESSION, '   \n\n  '))

    expect(effects).toEqual([])
    expect(core.state.isSpeaking).toBe(false)
  })
})

describe('permission requests', () => {
  it('is spoken even with read-aloud off', () => {
    const core = attachedCore({ autoRead: false })
    const effects = core.handleAgentEvent(
      agent.permissionRequested(SESSION, 'Bash', 'rm -rf build'),
    )

    expect(effects).toContainEqual(effect.play(Sound.permissionNeeded))
    expect(hasEffect(effects, 'speak')).toBe(true)
  })

  it('is announced in Portuguese, not in the English the event carries', () => {
    const core = attachedCore({ language: PORTUGUESE })
    const effects = core.handleAgentEvent(
      agent.permissionRequested(SESSION, 'Bash', 'curl -s https://example.com'),
    )

    expect(effects.at(-1).text).toBe(
      'O Claude quer rodar um comando no terminal: curl -s https://example.com.',
    )
  })

  it('still says what will happen when the event carries no detail', () => {
    const core = attachedCore()
    const effects = core.handleAgentEvent(agent.permissionRequested(SESSION, 'Write', null))

    expect(effects.at(-1).text).toBe('O Claude quer criar ou substituir um arquivo.')
  })

  it('interrupts a Reading already in progress, before the alert sound', () => {
    const core = attachedCore()
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'A long answer.'))
    expect(core.state.isSpeaking).toBe(true)

    const effects = core.handleAgentEvent(agent.permissionRequested(SESSION, 'Bash', 'ls'))
    const stopAt = effects.findIndex((each) => each.type === 'stopSpeaking')
    const soundAt = effects.findIndex((each) => each.type === 'play')

    expect(stopAt).toBeGreaterThanOrEqual(0)
    expect(stopAt).toBeLessThan(soundAt)
  })

  it('never sends anything to the terminal', () => {
    // Authorizing is always done on the keyboard. A recognition error must never
    // be able to approve a destructive command.
    const core = attachedCore()
    const effects = core.handleAgentEvent(agent.permissionRequested(SESSION, 'Bash', 'rm -rf /'))

    expect(hasEffect(effects, 'sendTextToTerminal')).toBe(false)
    expect(hasEffect(effects, 'runInTerminal')).toBe(false)
  })
})

describe('telling sessions apart', () => {
  it('drops an event from another session with no effect', () => {
    const core = attachedCore()
    const effects = core.handleAgentEvent(agent.assistantFinished('other', 'hi'))

    expect(effects).toEqual([])
    expect(core.state.lastAssistantText).toBeNull()
  })

  it('adopts the first session to show up when none is active', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened('/project'))
    core.receive(incoming(agent.assistantFinished('new', 'hi'), '/project'))

    expect(core.state.activeSessionId).toBe('new')
  })

  // Claude Code reports the folder its shell is in now, not the one it opened
  // in. One `cd` into a subfolder and every answer after it went unread, for
  // the rest of the session, on 9 October 2026.
  it('keeps reading after Claude Code moves into a subfolder of the project', () => {
    const core = new JarvisCore({ autoRead: true })
    core.dispatch(user.projectOpened('/project'))
    core.receive(incoming(agent.assistantFinished(SESSION, 'first'), '/project'))
    core.dispatch(user.speechFinished())

    const effects = core.receive(
      incoming(agent.assistantFinished(SESSION, 'second'), '/project/receipts/2025'),
    )

    expect(effects).toContainEqual(effect.speak('second', PORTUGUESE))
  })

  it('still ignores a folder that only begins with the project name', () => {
    const core = new JarvisCore({ autoRead: true })
    core.dispatch(user.projectOpened('/project'))

    expect(core.receive(incoming(agent.assistantFinished(SESSION, 'no'), '/project-old'))).toEqual([])
  })

  it('interrupts speech and listening when the session ends', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'something'))

    const effects = core.handleAgentEvent(agent.sessionEnded(SESSION))
    expect(hasEffect(effects, 'stopSpeaking')).toBe(true)
    expect(hasEffect(effects, 'cancelListening')).toBe(true)
    expect(core.state.activeSessionId).toBeNull()
  })
})

describe('the microphone', () => {
  it('starts listening in the current language', () => {
    const core = attachedCore({ language: ENGLISH })
    const effects = core.dispatch(user.micPressed())

    expect(effects).toEqual([effect.play(Sound.listeningStarted), effect.startListening(ENGLISH)])
    expect(core.state.isListening).toBe(true)
  })

  it('ends listening on the second press and waits for the final text', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.micPressed())

    expect(effects).toEqual([effect.stopListening()])
    // Listening is only over once the engine delivers the text: stopping before
    // that would lose the last sentence spoken.
    expect(core.state.isListening).toBe(true)
    expect(core.state.isFinishingDictation).toBe(true)
  })

  it('does not end listening twice when pressed twice in a row', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.micPressed())

    expect(core.dispatch(user.micPressed())).toEqual([])
  })

  it('still accepts the final text after the microphone was switched off', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.dictationFinal('last sentence'))

    expect(effects).toContainEqual(effect.sendTextToTerminal('last sentence'))
    expect(core.state.isListening).toBe(false)
    expect(core.state.isFinishingDictation).toBe(false)
  })

  it('stops a Reading first when pressed while Jarvis is speaking', () => {
    const core = attachedCore()
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'A long answer.'))
    expect(core.state.isSpeaking).toBe(true)

    const effects = core.dispatch(user.micPressed())
    expect(effects[0]).toEqual(effect.stopSpeaking())
    expect(effects).toContainEqual(effect.startListening(PORTUGUESE))
    expect(core.state.isSpeaking).toBe(false)
  })
})

describe('dictation', () => {
  it('reaches the terminal without being submitted', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.dictationFinal('create a test file'))

    expect(effects).toContainEqual(effect.sendTextToTerminal('create a test file'))
    expect(hasEffect(effects, 'runInTerminal')).toBe(false)
    // Nothing is written here: the text can still be corrected or abandoned
    // before you press Enter.
    expect(hasEffect(effects, 'log')).toBe(false)
    expect(core.state.lastDictatedText).toBe('create a test file')
    expect(core.state.isListening).toBe(false)
  })

  it('sends nothing to the terminal when nothing was said', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.dictationFinal('   '))

    expect(hasEffect(effects, 'sendTextToTerminal')).toBe(false)
  })

  it('never reaches the terminal once cancelled', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.cancelDictationPressed())

    expect(effects).toEqual([effect.cancelListening()])
    expect(core.state.isListening).toBe(false)
  })

  it('shows a Preview in the Panel without producing any effect', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const effects = core.dispatch(user.dictationPartial('create a fi'))

    expect(effects).toEqual([])
    expect(core.state.partialText).toBe('create a fi')
  })

  it('a Preview never reaches the terminal, however many arrive', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    const previews = ['cri', 'crie um', 'crie um arquivo'].flatMap((text) =>
      core.dispatch(user.dictationPartial(text)),
    )

    expect(previews).toEqual([])
  })

  it('is ignored when the microphone was never started', () => {
    const core = attachedCore()
    expect(core.dispatch(user.dictationFinal('ghost'))).toEqual([])
  })
})

describe('stopping and repeating', () => {
  it('re-reads the last answer, not the one before it', () => {
    const core = attachedCore({ autoRead: false })
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'first'))
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'second'))

    expect(core.dispatch(user.repeatLastPressed())).toEqual([effect.speak('second', PORTUGUESE)])
  })

  it('does nothing when there is nothing to re-read', () => {
    const core = attachedCore()
    expect(core.dispatch(user.repeatLastPressed())).toEqual([])
  })

  it('only has an effect while Jarvis is speaking', () => {
    const core = attachedCore()
    expect(core.dispatch(user.stopSpeechPressed())).toEqual([])

    core.handleAgentEvent(agent.assistantFinished(SESSION, 'something'))
    expect(core.dispatch(user.stopSpeechPressed())).toEqual([effect.stopSpeaking()])
    expect(core.state.isSpeaking).toBe(false)
  })

  it('releases the speaking state when the voice finishes on its own', () => {
    const core = attachedCore()
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'something'))
    core.dispatch(user.speechFinished())

    expect(core.state.isSpeaking).toBe(false)
  })
})

describe('language', () => {
  it('affects the next Reading', () => {
    const core = attachedCore()
    core.dispatch(user.languageToggled())
    const effects = core.handleAgentEvent(agent.assistantFinished(SESSION, 'done'))

    expect(effects.at(-1)).toEqual(effect.speak('done', ENGLISH))
  })

  it('restarts listening when switched mid-Dictation', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())

    expect(core.dispatch(user.languageToggled())).toEqual([
      effect.cancelListening(),
      effect.startListening(ENGLISH),
    ])
  })

  it('lets a Dictation you already stopped finish, in the old language', () => {
    // You pressed stop, so the sentence is on its way. Cancelling and restarting
    // would leave the old engine's final in flight, to be typed in after the new
    // listening had begun.
    const core = attachedCore()
    core.dispatch(user.micPressed())
    core.dispatch(user.micPressed())

    expect(core.dispatch(user.languageToggled())).toEqual([])
    expect(core.state.language).toBe(ENGLISH)

    const effects = core.dispatch(user.dictationFinal('o que eu falei'))
    expect(effects).toContainEqual(effect.sendTextToTerminal('o que eu falei'))
  })

  it('leaves the microphone alone when switched outside a Dictation', () => {
    const core = attachedCore()
    expect(core.dispatch(user.languageToggled())).toEqual([])
    expect(core.state.language).toBe(ENGLISH)
  })
})

describe('real events captured from Claude Code', () => {
  it('preserves Portuguese accents through a finished answer', () => {
    const event = agentEvent(fixture('stop-interactive'))
    expect(event.type).toBe('assistantFinished')
    expect(event.text).toBe('ação, coração, não, você')
  })

  it('carries the tool and the exact command on a permission request', () => {
    const event = agentEvent(fixture('permission-request'))
    expect(event.type).toBe('permissionRequested')
    expect(event.toolName).toBe('Bash')
    expect(event.detail).toBe('curl -s https://example.com | head -3')
  })

  it('drops a payload with no session identifier', () => {
    // Adopting it would make every real event fail to match, and Jarvis would go
    // deaf for the rest of the session with nothing on screen to explain it.
    for (const name of ['SessionStart', 'Stop', 'PermissionRequest', 'UserPromptSubmit', 'SessionEnd']) {
      const payload = JSON.stringify({ hook_event_name: name, cwd: '/p', last_assistant_message: 'hi', prompt: 'hi' })
      expect(agentEvent(payload), name).toBeNull()
    }
  })

  it('drops the generic notification as redundant', () => {
    // It does not carry the request's content; the permission event does.
    // Speaking both would produce an echo.
    expect(agentEvent(fixture('notification'))).toBeNull()
  })

  it('carries the session folder, which is what tells projects apart', () => {
    const decoded = decode(fixture('permission-request'))
    expect(decoded.workingDirectory).toBe('/Users/you/Downloads/Jarvis')
    expect(decoded.event.sessionId).toBe('ad452c98-2345-4e67-b64f-8f3edf749d2f')
  })

  it('travels through the core into Portuguese speech', () => {
    const core = new JarvisCore()
    core.dispatch(user.projectOpened('/Users/you/Downloads/Jarvis'))
    const effects = core.receive(decode(fixture('permission-request')))

    expect(effects.at(-1)).toEqual(
      effect.speak(
        'O Claude quer rodar um comando no terminal: curl -s https://example.com | head -3.',
        PORTUGUESE,
      ),
    )
  })
})

describe('holding, resuming and replaying a reading', () => {
  function speaking() {
    const core = attachedCore({ autoRead: true })
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'A long answer.'))
    return core
  }

  it('holds a running reading, and does nothing when asked to hold twice', () => {
    const core = speaking()
    expect(core.dispatch(user.pauseSpeechPressed())).toEqual([effect.pauseSpeaking()])
    expect(core.state.isPaused).toBe(true)
    expect(core.dispatch(user.pauseSpeechPressed())).toEqual([])
  })

  it('lets a held reading go on, and does nothing when it is not held', () => {
    const core = speaking()
    core.dispatch(user.pauseSpeechPressed())
    expect(core.dispatch(user.resumeSpeechPressed())).toEqual([effect.resumeSpeaking()])
    expect(core.state.isPaused).toBe(false)
    expect(core.dispatch(user.resumeSpeechPressed())).toEqual([])
  })

  it('cannot hold when nothing is being read', () => {
    const core = attachedCore()
    expect(core.dispatch(user.pauseSpeechPressed())).toEqual([])
    expect(core.state.isPaused).toBe(false)
  })

  it('a full stop clears the held state', () => {
    const core = speaking()
    core.dispatch(user.pauseSpeechPressed())
    core.dispatch(user.stopSpeechPressed())
    expect(core.state.isPaused).toBe(false)
    expect(core.state.isSpeaking).toBe(false)
  })

  it('replays a stored reading by id, taking over as the reading in progress', () => {
    const core = speaking()
    core.dispatch(user.pauseSpeechPressed())
    expect(core.dispatch(user.replayReadingPressed('reading-2'))).toEqual([
      effect.replayReading('reading-2'),
    ])
    expect(core.state.isSpeaking).toBe(true)
    expect(core.state.isPaused).toBe(false)
  })
})

describe('the held state does not linger past an interruption', () => {
  function pausedReading() {
    const core = attachedCore({ autoRead: true })
    core.handleAgentEvent(agent.assistantFinished(SESSION, 'A long answer.'))
    core.dispatch(user.pauseSpeechPressed())
    return core
  }

  it('is cleared when a command button interrupts the reading', () => {
    const core = pausedReading()
    core.dispatch(user.shortcutPressed({ id: 'x', label: 'x', command: 'claude', submits: true }))
    expect(core.state.isSpeaking).toBe(false)
    expect(core.state.isPaused).toBe(false)
  })

  it('is cleared when the microphone interrupts the reading', () => {
    const core = pausedReading()
    core.dispatch(user.micPressed())
    expect(core.state.isSpeaking).toBe(false)
    expect(core.state.isPaused).toBe(false)
  })

  it('does not replay a reading into an open microphone', () => {
    const core = attachedCore()
    core.dispatch(user.micPressed())
    expect(core.state.isListening).toBe(true)
    expect(core.dispatch(user.replayReadingPressed('reading-1'))).toEqual([])
    expect(core.state.isSpeaking).toBe(false)
  })
})

describe('the request to catch up from previous conversations', () => {
  it('names the .jarvis folder and follows the spoken language', () => {
    const { recallConversationsPrompt } = require('../src/core/language.js')
    const pt = recallConversationsPrompt(PORTUGUESE)
    expect(pt).toContain('.jarvis')
    expect(pt).toContain('últimas conversas')
    const en = recallConversationsPrompt(ENGLISH)
    expect(en).toContain('.jarvis')
    expect(en).toContain('latest conversations')
  })
})
