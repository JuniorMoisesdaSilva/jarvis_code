import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// The pieces Jarvis carries into a machine's Claude Code — the spoken-summary
// style, the status line, the personality, the Maestro — ship as plain files in
// the repo, so they can be read and reviewed rather than generated. Three things
// must never drift: the style's own name, because Jarvis applies that exact
// string as `outputStyle`; the personality, which must never grow a key that
// could carry a secret onto someone else's machine; and the Maestro's embedded
// copies of Matt Pocock's skills, which are what it falls back to on a machine
// where the package is not installed.

const STYLE = new URL('../../Brain/BEHAVIOUR.md', import.meta.url)
const STATUS = new URL('../../Brain/LAYOUT.js', import.meta.url)
const PERSONALITY = new URL('../../Brain/LAYOUT.json', import.meta.url)
const ADAPTER = new URL('../src/main/claude-config.js', import.meta.url)
const MAESTRO = new URL('../../Brain/', import.meta.url)

/** The eight skills the Maestro reads, as it names them in its own instruction. */
const MATT_SKILLS = [
  'code-review',
  'domain-modeling',
  'grilling',
  'grill-me',
  'implement',
  'tdd',
  'to-spec',
  'to-tickets',
]

/** The name from a Markdown file's YAML frontmatter. */
function frontmatterName(url) {
  const text = fs.readFileSync(url, 'utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = match?.[1].split(/\r?\n/).find((each) => each.startsWith('name:'))
  return line?.slice('name:'.length).trim()
}

describe('the carried Claude Code pieces', () => {
  it('gives the output style the exact name Jarvis applies', () => {
    expect(frontmatterName(STYLE)).toBe('Resumo leigo')
    // and the applier still names that same string, so the two cannot drift
    expect(fs.readFileSync(ADAPTER, 'utf8')).toContain("OUTPUT_STYLE = 'Resumo leigo'")
  })

  it('ships a non-empty status line script', () => {
    expect(fs.readFileSync(STATUS, 'utf8').trim().length).toBeGreaterThan(0)
  })

  it('carries a personality of only behaviour, never a secret', () => {
    const personality = JSON.parse(fs.readFileSync(PERSONALITY, 'utf8'))
    expect(typeof personality).toBe('object')
    // Exactly the keys the applier whitelists, and nothing that could be a token,
    // an allow-list, or a credential path.
    const allowed = new Set(['model'])
    for (const key of Object.keys(personality)) {
      expect(allowed.has(key), `personality.json carries a non-whitelisted key: ${key}`).toBe(true)
    }
  })

  it('leaves the answering language to the panel rather than carrying one', () => {
    // The PT/EN switch is what Claude Code answers in. A language in the carried
    // file would be a second source for the same answer, and the one the user
    // can see has to win — so the applier names both languages itself and
    // whitelists only the model.
    const personality = JSON.parse(fs.readFileSync(PERSONALITY, 'utf8'))
    expect('language' in personality).toBe(false)
    const adapter = fs.readFileSync(ADAPTER, 'utf8')
    expect(adapter).toContain("PERSONALITY_KEYS = Object.freeze(['model'])")
    expect(adapter).toContain('languages.claudeName(language)')
  })
})

describe('the carried Maestro', () => {
  it('carries the skill under the name Claude Code will find it by', () => {
    // MAESTRO.md where a person reads it, SKILL.md where Claude Code does. The
    // frontmatter name is what Claude Code matches on, whichever file it is in.
    const skill = new URL('MAESTRO.md', MAESTRO)
    expect(frontmatterName(skill)).toBe('maestro')
    // and the applier places it under a folder of that same name, so a skill
    // whose frontmatter and folder disagree cannot ship
    expect(fs.readFileSync(new URL('../src/core/maestro.js', import.meta.url), 'utf8')).toContain(
      "MAESTRO = 'maestro'",
    )
  })

  it('carries all eight of the skills it says it reads', () => {
    for (const name of MATT_SKILLS) {
      const file = new URL(`matt/${name}/SKILL.md`, MAESTRO)
      expect(fs.existsSync(file), `the embedded ${name} skill is missing`).toBe(true)
      expect(fs.readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0)
    }
  })

  it('carries the licence and the credit for the copies it did not write', () => {
    expect(fs.readFileSync(new URL('matt/LICENSE', MAESTRO), 'utf8')).toContain('MIT License')
    expect(fs.readFileSync(new URL('matt/CREDIT.md', MAESTRO), 'utf8')).toContain('Matt Pocock')
  })

  it('is read from Brain rather than from inside the app', () => {
    // Everything carried lives at the folder's root now, so none of it has to
    // be unpacked out of the archive — and nothing may go back to reaching for
    // it through the app's own path, which is what this fails on.
    const adapter = fs.readFileSync(new URL('../src/main/claude-config.js', import.meta.url), 'utf8')
    expect(adapter).toContain('brainDir')
    expect(adapter).not.toContain("'claude'")
  })
})
