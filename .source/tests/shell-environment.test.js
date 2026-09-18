import { describe, expect, it } from 'vitest'
import { forShell, SESSION_MARKERS } from '../src/main/shell-environment.js'

// Started from inside a Claude Code session, Jarvis used to hand those session
// markers straight to the shell it opened. The Claude Code started there then
// believed it was its own child, stopped saving the conversation, and said so
// above the prompt on every screen. Found in use on 1 September 2026.

describe('the environment the shell is given', () => {
  it('drops every mark of the session Jarvis was started from', () => {
    const environment = Object.fromEntries(SESSION_MARKERS.map((name) => [name, 'set']))

    expect(forShell(environment)).toEqual({})
  })

  it('drops the marker that turned transcript saving off', () => {
    const clean = forShell({ CLAUDE_CODE_CHILD_SESSION: '1', PATH: '/usr/bin' })

    expect(clean).not.toHaveProperty('CLAUDE_CODE_CHILD_SESSION')
    expect(clean.PATH).toBe('/usr/bin')
  })

  it('leaves everything else exactly as it was', () => {
    const environment = { PATH: '/usr/bin', HOME: 'C:\\Users\\me', TERM: 'dumb' }

    expect(forShell(environment)).toEqual(environment)
  })

  it('keeps configuration a person set on purpose', () => {
    // The names on the list are set by a running session and nothing else.
    // Someone's own setting must survive the trip, or Jarvis would be quietly
    // undoing their choice.
    const clean = forShell({ CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1', ANTHROPIC_API_KEY: 'k' })

    expect(clean.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE).toBe('1')
    expect(clean.ANTHROPIC_API_KEY).toBe('k')
  })

  it('copies rather than empties what it was handed', () => {
    const environment = { CLAUDECODE: '1', PATH: '/usr/bin' }

    forShell(environment)

    expect(environment.CLAUDECODE).toBe('1')
  })

  it('survives being handed nothing at all', () => {
    expect(forShell(undefined)).toEqual({})
    expect(forShell(null)).toEqual({})
  })
})
