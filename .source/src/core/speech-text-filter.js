'use strict'

// Turns a Claude Code answer into something that makes sense heard aloud.
//
// A pure function: same text in, same text out, no state and no side effects. It
// is the piece with the most edge cases in the project, which is why it is
// tested on its own rather than indirectly through the core.

const { PORTUGUESE } = require('./language')

/** Spoken content, so it is written in the language it is heard in. */
function codePlaceholder(language) {
  return language === PORTUGUESE ? 'trecho de código omitido.' : 'code block omitted.'
}

function tablePlaceholder(language) {
  return language === PORTUGUESE ? 'tabela omitida.' : 'table omitted.'
}

/**
 * Backtick-fenced blocks. An unclosed fence swallows the rest of the text —
 * which is what happens when an answer is cut off mid-way.
 */
function replaceFencedCode(text, placeholder) {
  const output = []
  let insideFence = false
  let replacedCurrentFence = false

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (insideFence) {
        insideFence = false
      } else {
        insideFence = true
        replacedCurrentFence = false
      }
      if (!replacedCurrentFence) {
        output.push(placeholder)
        replacedCurrentFence = true
      }
      continue
    }
    if (!insideFence) output.push(line)
  }

  return output.join('\n')
}

/** Table rows become a single mention, not one per row. */
function replaceTables(text, placeholder) {
  const output = []
  let inTable = false

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const looksLikeTableRow = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1
    if (looksLikeTableRow) {
      if (!inTable) {
        output.push(placeholder)
        inTable = true
      }
      continue
    }
    inTable = false
    output.push(line)
  }

  return output.join('\n')
}

function stripImages(text) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
}

/** `[text](url)` becomes just `text` — nobody wants a URL spelled out. */
function unwrapLinks(text) {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/**
 * The backticks go, the content stays: command names are usually the most
 * informative part of the sentence.
 */
function stripInlineCodeMarkers(text) {
  return text.replace(/`+/g, '')
}

/** Headings, quotes and list markers become running prose. */
function stripLinePrefixes(text) {
  return text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
}

function removeHorizontalRules(text) {
  return text.replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/gm, '')
}

function stripEmphasis(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '$1')
}

const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', '"', "'"])
const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/
const FILE_NAME = /[^\\/.]\.[A-Za-z0-9]{1,8}$/

/**
 * Long paths become just the file name. Hearing "C colon backslash Users
 * backslash you backslash Downloads" is the kind of thing that makes people
 * switch the app off. Both Windows and POSIX shapes are abbreviated: an answer
 * about this project will mix them freely.
 */
function abbreviateIfPath(token) {
  let core = token
  let suffix = ''
  while (core.length > 0 && TRAILING_PUNCTUATION.has(core[core.length - 1])) {
    suffix = core[core.length - 1] + suffix
    core = core.slice(0, -1)
  }

  const separators = (core.match(/[\\/]/g) || []).length
  if (separators === 0) return token
  // A bare web address stays whole; shortening links is the unwrapper's job.
  if (core.toLowerCase().startsWith('http')) return token

  const isAbsoluteish =
    DRIVE_PREFIX.test(core) ||
    core.startsWith('/') ||
    core.startsWith('\\\\') ||
    core.startsWith('~/') ||
    core.startsWith('./') ||
    core.startsWith('../') ||
    core.startsWith('.\\') ||
    core.startsWith('..\\')

  const components = core.split(/[\\/]/).filter((part) => part.length > 0)
  if (components.length <= 1) return token
  const last = components[components.length - 1]

  // A relative path is only recognised when it ends in something that looks like
  // a file name. Otherwise a date (12/31/2025) or a run of alternatives
  // (and/or/either) would be read aloud as its last word alone.
  if (!isAbsoluteish && !(separators >= 2 && FILE_NAME.test(last))) return token

  return last + suffix
}

/** Walks token by token, preserving the original spacing. */
function abbreviatePaths(text) {
  let result = ''
  let token = ''

  const flush = () => {
    if (token.length > 0) {
      result += abbreviateIfPath(token)
      token = ''
    }
  }

  for (const character of text) {
    if (character === ' ' || character === '\n' || character === '\t') {
      flush()
      result += character
    } else {
      token += character
    }
  }
  flush()
  return result
}

function collapseWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function spokenText(markdown, language) {
  let text = markdown.replace(/\r\n/g, '\n')

  text = replaceFencedCode(text, codePlaceholder(language))
  text = replaceTables(text, tablePlaceholder(language))
  text = stripImages(text)
  text = unwrapLinks(text)
  text = stripInlineCodeMarkers(text)
  // Rules go before prefixes: stripping the list marker off `- - -` would leave
  // `- -`, too short to still look like a rule, and it would be read aloud as
  // stray dashes.
  text = removeHorizontalRules(text)
  text = stripLinePrefixes(text)
  text = stripEmphasis(text)
  text = abbreviatePaths(text)
  text = collapseWhitespace(text)

  return text
}

module.exports = { spokenText, abbreviatePaths, abbreviateIfPath, codePlaceholder, tablePlaceholder }
