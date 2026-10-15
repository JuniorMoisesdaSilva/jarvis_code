import { describe, expect, it } from 'vitest'
import { connect, disconnect } from '../src/core/connection.js'

// Connect is two writers — the personality (with the plan server) and the
// hooks (with the approval that answers for the plan tool) — and Disconnect
// undoes both. Neither may stop halfway: the approval is never left on the host
// without the server it approves, and a Disconnect that meets one failure still
// tries everything else.

function fake(name, journal, failing = {}) {
  const act = (verb) => () => {
    journal.push(`${name}.${verb}`)
    if (failing[verb]) {
      const error = new Error(`EPERM: ${name}.${verb}`)
      error.code = 'EPERM'
      throw error
    }
  }
  return { apply: act('apply'), remove: act('remove'), install: act('install'), uninstall: act('uninstall') }
}

describe('Connect', () => {
  it('registers the server before it installs the approval', () => {
    const journal = []
    connect({ personality: fake('personality', journal), hooks: fake('hooks', journal) })
    expect(journal).toEqual(['personality.apply', 'hooks.install'])
  })

  it('installs no hook when the personality fails, and takes back what it did', () => {
    const journal = []
    expect(() =>
      connect({ personality: fake('personality', journal, { apply: true }), hooks: fake('hooks', journal) }),
    ).toThrow('EPERM: personality.apply')
    expect(journal).toEqual(['personality.apply', 'personality.remove'])
  })

  it('takes the server back when the hooks fail, so nothing is left half done', () => {
    const journal = []
    expect(() =>
      connect({ personality: fake('personality', journal), hooks: fake('hooks', journal, { install: true }) }),
    ).toThrow('EPERM: hooks.install')
    expect(journal).toEqual(['personality.apply', 'hooks.install', 'hooks.uninstall', 'personality.remove'])
  })

  it('reports the failure that stopped it, not one met while rolling back', () => {
    const journal = []
    expect(() =>
      connect({
        personality: fake('personality', journal, { remove: true }),
        hooks: fake('hooks', journal, { install: true }),
      }),
    ).toThrow('EPERM: hooks.install')
  })
})

describe('Disconnect', () => {
  it('takes the approval away before the server', () => {
    const journal = []
    disconnect({ personality: fake('personality', journal), hooks: fake('hooks', journal) })
    expect(journal).toEqual(['hooks.uninstall', 'personality.remove'])
  })

  it('still takes the personality back when the hooks cannot be removed, and reports it', () => {
    const journal = []
    expect(() =>
      disconnect({ personality: fake('personality', journal), hooks: fake('hooks', journal, { uninstall: true }) }),
    ).toThrow('EPERM: hooks.uninstall')
    expect(journal).toEqual(['hooks.uninstall', 'personality.remove'])
  })

  it('reports the first failure when both fail', () => {
    const journal = []
    expect(() =>
      disconnect({
        personality: fake('personality', journal, { remove: true }),
        hooks: fake('hooks', journal, { uninstall: true }),
      }),
    ).toThrow('EPERM: hooks.uninstall')
    expect(journal).toEqual(['hooks.uninstall', 'personality.remove'])
  })
})
