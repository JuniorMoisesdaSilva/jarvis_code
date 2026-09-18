import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import transcript from '../src/main/transcript.js'
import { EntryKind, entry } from '../src/core/effects.js'

// The written record is the half of the promise that survives the session. It
// lives inside the project, which means it must never turn up in a commit.

const { begin, append, end, current, excludeFromVersionControl, IGNORE_RULE } = transcript

let project

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-transcript-'))
})

afterEach(() => {
  end()
  fs.rmSync(project, { recursive: true, force: true })
})

function body() {
  return fs.readFileSync(current(), 'utf8')
}

function gitignore() {
  return fs.readFileSync(path.join(project, '.gitignore'), 'utf8')
}

describe('starting a conversation', () => {
  it('writes a file named by the date and time', () => {
    const file = begin(project, new Date(2026, 7, 31, 14, 5, 9))
    expect(path.basename(file)).toBe('2026-08-31-140509.md')
  })

  it('puts it in a folder inside the project', () => {
    const file = begin(project)
    expect(path.dirname(file)).toBe(path.join(project, '.jarvis'))
  })

  it('opens with the date, the time and where it happened', () => {
    begin(project, new Date(2026, 7, 31, 14, 5, 9))
    expect(body()).toContain('# Conversation of 2026-08-31')
    expect(body()).toContain('Started at 14:05')
    expect(body()).toContain(project)
  })

  it('starts a new file for each conversation', () => {
    const first = begin(project, new Date(2026, 7, 31, 14, 5, 9))
    const second = begin(project, new Date(2026, 7, 31, 15, 40, 1))
    expect(first).not.toBe(second)
    expect(fs.existsSync(first)).toBe(true)
  })
})

describe('the lines of the conversation', () => {
  beforeEach(() => {
    begin(project)
  })

  it('separates what you said from what Claude answered', () => {
    append(entry(EntryKind.userVoice, 'fix the build'))
    append(entry(EntryKind.assistant, 'Done.'))

    expect(body()).toContain('### You said')
    expect(body()).toContain('### Claude')
  })

  it('marks a typed message differently from a dictated one', () => {
    append(entry(EntryKind.userTyped, 'typed this'))
    expect(body()).toContain('### You typed')
    expect(body()).not.toContain('### You said')
  })

  it('marks a permission request for what it was', () => {
    append(entry(EntryKind.permission, 'O Claude quer rodar um comando.'))
    expect(body()).toContain('### Claude asked for permission')
  })

  it('stamps every line with the time it happened', () => {
    append(entry(EntryKind.assistant, 'Done.'), new Date(2026, 7, 31, 9, 7))
    expect(body()).toContain('— 09:07')
  })

  it('keeps the lines in the order they happened', () => {
    append(entry(EntryKind.userTyped, 'first'))
    append(entry(EntryKind.assistant, 'second'))
    expect(body().indexOf('first')).toBeLessThan(body().indexOf('second'))
  })

  it('keeps Portuguese accents intact', () => {
    append(entry(EntryKind.assistant, 'ação, coração, não, você'))
    expect(body()).toContain('ação, coração, não, você')
  })

  it('writes nothing once the conversation has ended', () => {
    const file = current()
    const before = fs.readFileSync(file, 'utf8')
    end()
    append(entry(EntryKind.assistant, 'too late'))
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })
})

describe('keeping the record out of version control', () => {
  it('adds the rule when the project uses git', () => {
    fs.mkdirSync(path.join(project, '.git'))
    begin(project)
    expect(gitignore()).toContain(IGNORE_RULE)
  })

  it('leaves a project without git alone', () => {
    begin(project)
    expect(fs.existsSync(path.join(project, '.gitignore'))).toBe(false)
  })

  it('keeps what was already in the ignore file', () => {
    fs.mkdirSync(path.join(project, '.git'))
    fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules/\ndist/\n', 'utf8')
    begin(project)

    expect(gitignore()).toContain('node_modules/')
    expect(gitignore()).toContain('dist/')
    expect(gitignore()).toContain(IGNORE_RULE)
  })

  it('does not add the rule twice, however many conversations there are', () => {
    fs.mkdirSync(path.join(project, '.git'))
    begin(project)
    begin(project)
    excludeFromVersionControl(project)

    const times = gitignore().split(/\r?\n/).filter((line) => line.trim() === IGNORE_RULE).length
    expect(times).toBe(1)
  })

  it('recognises the rule written without the trailing slash', () => {
    fs.mkdirSync(path.join(project, '.git'))
    fs.writeFileSync(path.join(project, '.gitignore'), '.jarvis\n', 'utf8')
    begin(project)

    expect(gitignore().split(/\r?\n/).filter((line) => line.startsWith('.jarvis'))).toHaveLength(1)
  })

  it('does not glue the rule onto a file with no closing newline', () => {
    fs.mkdirSync(path.join(project, '.git'))
    fs.writeFileSync(path.join(project, '.gitignore'), 'dist/', 'utf8')
    begin(project)

    expect(gitignore()).not.toContain('dist/#')
    expect(gitignore().split(/\r?\n/)).toContain('dist/')
  })
})

describe('recalling the last few conversations, on request', () => {
  it('lists the most recent logs newest first, as project-relative paths', () => {
    const folder = path.join(project, '.jarvis')
    fs.mkdirSync(folder, { recursive: true })
    for (const name of ['2026-09-01-090000.md', '2026-09-02-090000.md', '2026-09-03-090000.md', '2026-09-04-090000.md']) {
      fs.writeFileSync(path.join(folder, name), '# a conversation', 'utf8')
    }
    // something that is not a log is ignored
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'x', 'utf8')

    expect(transcript.recent(project, { limit: 3 })).toEqual([
      '.jarvis/2026-09-04-090000.md',
      '.jarvis/2026-09-03-090000.md',
      '.jarvis/2026-09-02-090000.md',
    ])
  })

  it('leaves out the current conversation', () => {
    const folder = path.join(project, '.jarvis')
    fs.mkdirSync(folder, { recursive: true })
    for (const name of ['2026-09-01-090000.md', '2026-09-02-090000.md']) {
      fs.writeFileSync(path.join(folder, name), '# a conversation', 'utf8')
    }
    const mine = path.join(folder, '2026-09-02-090000.md')
    expect(transcript.recent(project, { exclude: mine })).toEqual(['.jarvis/2026-09-01-090000.md'])
  })

  it('returns nothing when the project has no logs', () => {
    expect(transcript.recent(project)).toEqual([])
  })
})

describe('ending a Session', () => {
  // Nothing is copied anywhere. The record lives in the project it belongs to,
  // which is also the only copy the Memory toggle ever reads.
  it('closes the record and leaves it where it was written', () => {
    const own = transcript.createTranscript()

    own.begin(project)
    own.append(entry(EntryKind.Dictated, 'algo dito'))
    own.end()

    expect(own.current()).toBe(null)
    expect(fs.readdirSync(path.join(project, transcript.FOLDER))).toHaveLength(1)
  })

  it('closes a Session that never opened a record', () => {
    const own = transcript.createTranscript()
    expect(() => own.end()).not.toThrow()
    expect(own.current()).toBe(null)
  })
})
