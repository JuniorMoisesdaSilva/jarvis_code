'use strict'

// Hides anything that looks like a credential in a piece of text the Deck will
// show — a command line, a path, a prompt.
//
// It runs before the text reaches the Deck's state, not when it is drawn, so no
// copy of a secret is ever held there. It errs on the side of hiding: a masked
// word that was harmless costs nothing, a key on screen costs a key.

/** What a hidden value is replaced with. Matches none of the patterns below. */
const HIDDEN = '•••'

/** Words that make a name a secret's name. */
const SECRET_WORD =
  'api[_-]?key|apikey|access[_-]?key|private[_-]?key|token|secret|passw(?:or)?d|pwd|credential'

const RULES = [
  // A password inside a URL: scheme://user:password@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi, `$1${HIDDEN}$3`],
  // An Authorization header's scheme and token.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${HIDDEN}`],
  // A flag named like a secret and the value after it: --password hunter2.
  [
    new RegExp(`(--?[A-Za-z0-9-]*(?:${SECRET_WORD})[A-Za-z0-9-]*)(\\s+)(["']?)[^\\s"']+`, 'gi'),
    `$1$2$3${HIDDEN}`,
  ],
  // A name like a secret given a value: TOKEN=…, "client_secret": "…", $env:KEY = "…".
  [
    new RegExp(
      `([A-Za-z0-9_.$:-]*(?:${SECRET_WORD})[A-Za-z0-9_.-]*)(["']?\\s*[:=]\\s*["']?)[^\\s"'&;,]+`,
      'gi',
    ),
    `$1$2${HIDDEN}`,
  ],
  // The well-known shapes of keys, wherever they stand.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, HIDDEN],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, HIDDEN],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, HIDDEN],
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, HIDDEN],
  [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, HIDDEN],
]

/** The text with every credential-looking value replaced; null stays null. */
function masked(text) {
  if (text === null || text === undefined) return null
  let result = String(text)
  for (const [pattern, replacement] of RULES) result = result.replace(pattern, replacement)
  return result
}

module.exports = { masked, HIDDEN }
