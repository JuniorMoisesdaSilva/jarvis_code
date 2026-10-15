'use strict'

// The written record: one readable Markdown file per conversation, inside the
// project it belongs to.
//
// Alongside the technical history Claude Code already keeps, because that one is
// not something a person reads months later.

const fs = require('node:fs')
const path = require('node:path')
const { EntryKind } = require('../core/effects')

const FOLDER = '.jarvis'
const IGNORE_RULE = '.jarvis/'

const HEADINGS = Object.freeze({
  [EntryKind.userVoice]: '### You said',
  [EntryKind.userTyped]: '### You typed',
  [EntryKind.assistant]: '### Claude',
  [EntryKind.permission]: '### Claude asked for permission',
})

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    forFileName: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  }
}

/**
 * Adds the exclusion rule, so a conversation never turns up in a commit. Only
 * when the project is under version control, and only once — appending a rule
 * that is already there on every launch would be its own kind of mess.
 */
function excludeFromVersionControl(projectPath) {
  if (!fs.existsSync(path.join(projectPath, '.git'))) return
  const ignoreFile = path.join(projectPath, '.gitignore')

  let existing = ''
  try {
    existing = fs.readFileSync(ignoreFile, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') return
  }

  const alreadyThere = existing
    .split(/\r?\n/)
    .some((line) => line.trim() === IGNORE_RULE || line.trim() === FOLDER)
  if (alreadyThere) return

  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  fs.appendFileSync(
    ignoreFile,
    `${separator}\n# Jarvis keeps its readable conversation logs here\n${IGNORE_RULE}\n`,
    'utf8',
  )
}

/**
 * A written record, one per Session. Each keeps its own open file, so two
 * Sessions writing at once — two projects open in two windows — never cross into
 * each other's log.
 */
function createTranscript() {
  let file = null
  let project = null

  /** Opens a fresh file for a Session. Nothing is written until there is a line. */
  function begin(projectPath, now = new Date()) {
    const when = stamp(now)
    project = projectPath
    const folder = path.join(projectPath, FOLDER)
    fs.mkdirSync(folder, { recursive: true })
    excludeFromVersionControl(projectPath)

    file = path.join(folder, `${when.forFileName}.md`)
    fs.writeFileSync(
      file,
      `# Conversation of ${when.date}\n\nStarted at ${when.time} in \`${projectPath}\`.\n`,
      'utf8',
    )
    return file
  }

  /** Appends one line of the conversation, stamped with the time it happened. */
  function append(entry, now = new Date()) {
    if (!file) return null
    const when = stamp(now)
    const heading = HEADINGS[entry.kind] ?? '### Note'
    const body = entry.text.trim()

    fs.appendFileSync(file, `\n${heading} — ${when.time}\n\n${body}\n`, 'utf8')
    return file
  }

  /**
   * Closes the Session. Nothing is copied anywhere: the record lives in the
   * project it belongs to and nowhere else. See
   * Docs/decisions/0023-the-record-lives-only-in-the-project.md.
   */
  function end() {
    file = null
    project = null
  }

  function current() {
    return file
  }

  return { begin, append, end, current }
}

// A default instance keeps the module's own begin/append/end/current working for
// callers and tests that use the transcript as a singleton.
const defaultTranscript = createTranscript()

module.exports = {
  createTranscript,
  begin: defaultTranscript.begin,
  append: defaultTranscript.append,
  end: defaultTranscript.end,
  current: defaultTranscript.current,
  excludeFromVersionControl,
  FOLDER,
  IGNORE_RULE,
}
