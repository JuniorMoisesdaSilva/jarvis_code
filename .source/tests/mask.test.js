import { describe, expect, it } from 'vitest'
import { masked, HIDDEN } from '../src/core/mask.js'

// The Deck puts the detail of every tool call on screen, and a command line is
// where a credential most often is. Anything that looks like one is replaced
// before it reaches the Deck's state — not when it is drawn — so no copy of it
// is ever held.

describe('what is masked', () => {
  it('hides a value given to something named like a secret', () => {
    expect(masked('export GITHUB_TOKEN=ghx_abc123def456')).toBe(`export GITHUB_TOKEN=${HIDDEN}`)
    expect(masked('$env:OPENAI_API_KEY = "sk-live-1234"')).toBe(`$env:OPENAI_API_KEY = "${HIDDEN}"`)
    expect(masked('password: hunter2')).toBe(`password: ${HIDDEN}`)
    expect(masked('{"client_secret":"s3cr3t"}')).toBe(`{"client_secret":"${HIDDEN}"}`)
  })

  it('hides the value after a flag named like a secret', () => {
    expect(masked('mysql --password hunter2 -u root')).toBe(`mysql --password ${HIDDEN} -u root`)
    expect(masked('gh auth login --with-token abc')).toBe(`gh auth login --with-token ${HIDDEN}`)
  })

  it('hides a bearer token in a header', () => {
    expect(masked('curl -H "Authorization: Bearer eyAbC.dEf-123" https://api.example.com')).toBe(
      `curl -H "Authorization: Bearer ${HIDDEN}" https://api.example.com`,
    )
  })

  it('hides the password in a URL and keeps the rest of it', () => {
    expect(masked('git clone https://me:p4ss@github.com/me/repo.git')).toBe(
      `git clone https://me:${HIDDEN}@github.com/me/repo.git`,
    )
  })

  it('hides the well-known shapes of keys wherever they stand', () => {
    for (const secret of [
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv',
      'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
      'xoxb-1234567890-abcdefghij',
      'AKIAIOSFODNN7EXAMPLE',
      // Split so GitHub's secret scanning does not take the made-up key for a real one.
      'AIza' + 'SyA-1234567890abcdefghijklmnopqrstu',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    ]) {
      expect(masked(`echo ${secret} done`)).toBe(`echo ${HIDDEN} done`)
    }
  })
})

describe('what is left alone', () => {
  it('leaves an ordinary command exactly as it is', () => {
    for (const plain of [
      'git status --short',
      'npm test',
      'C:\\Jarvis\\.source\\src\\core\\deck.js',
      'grep -n "token" src/core/mask.js',
      'Find where the tokens are counted',
    ]) {
      expect(masked(plain)).toBe(plain)
    }
  })

  it('passes nothing through as nothing', () => {
    expect(masked(null)).toBeNull()
    expect(masked(undefined)).toBeNull()
    expect(masked('')).toBe('')
  })
})
