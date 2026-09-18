import { readFileSync } from 'node:fs'

/**
 * The Claude Code events used in these tests are not invented — they are literal
 * captures from real runs of the tool, taken while the design was being worked
 * out. That makes the tests a check against the hooks' real contract rather than
 * against our assumption of it.
 */
export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')
}

/** The texts a run of effects would have spoken, in order. */
export function spokenTexts(effects) {
  return effects.filter((each) => each.type === 'speak').map((each) => each.text)
}

/** The Transcript lines a run of effects would have written, in order. */
export function loggedEntries(effects) {
  return effects.filter((each) => each.type === 'log').map((each) => each.entry)
}

export function hasEffect(effects, type) {
  return effects.some((each) => each.type === type)
}

export function indexOfEffect(effects, predicate) {
  return effects.findIndex(predicate)
}
