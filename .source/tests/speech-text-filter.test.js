import { describe, expect, it } from 'vitest'
import { spokenText } from '../src/core/speech-text-filter.js'
import { PORTUGUESE, ENGLISH } from '../src/core/language.js'

// The filter is a pure function, so the tests are direct: text in, text out.
// None of them knows about the internal steps — only the audible result.

function spoken(input, language = PORTUGUESE) {
  return spokenText(input, language)
}

describe('code blocks', () => {
  it('turns a fenced block with a declared language into a short mention', () => {
    const input = ['Here is the fix:', '', '```js', 'const x = 1', 'print(x)', '```', '', 'Done.'].join('\n')
    expect(spoken(input)).toBe('Here is the fix:\ntrecho de código omitido.\nDone.')
  })

  it('handles a fence with no declared language', () => {
    expect(spoken('Before\n```\nrm -rf /\n```\nAfter')).toBe(
      'Before\ntrecho de código omitido.\nAfter',
    )
  })

  it('lets an unclosed fence swallow the rest', () => {
    // Happens when the answer is cut off mid-way.
    expect(spoken("Here:\n```python\nimport os\nos.remove('a')")).toBe(
      'Here:\ntrecho de código omitido.',
    )
  })

  it('mentions two blocks twice', () => {
    expect(spoken('A\n```\none\n```\nB\n```\ntwo\n```\nC')).toBe(
      'A\ntrecho de código omitido.\nB\ntrecho de código omitido.\nC',
    )
  })

  it('follows the language for the mention', () => {
    expect(spoken('```\nx\n```', ENGLISH)).toBe('code block omitted.')
  })

  it('does not go silent when the answer is only code', () => {
    expect(spoken('```\nx = 1\n```')).toBe('trecho de código omitido.')
  })

  it('handles a tilde fence as well as a backtick one', () => {
    expect(spoken('A\n~~~\ncode\n~~~\nB')).toBe('A\ntrecho de código omitido.\nB')
  })
})

describe('inline code', () => {
  it('loses the backticks but keeps the content', () => {
    // Command names are usually the most informative part of the sentence.
    expect(spoken('Run `git status` now.')).toBe('Run git status now.')
  })
})

describe('tables', () => {
  it('becomes one mention, not one per row', () => {
    const input = ['Comparison:', '', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '', 'End.'].join('\n')
    expect(spoken(input)).toBe('Comparison:\ntabela omitida.\nEnd.')
  })
})

describe('markup', () => {
  it('turns headings into prose', () => {
    expect(spoken('## Result\nIt worked.')).toBe('Result\nIt worked.')
  })

  it('removes list markers', () => {
    expect(spoken('- first\n- second\n1. third')).toBe('first\nsecond\nthird')
  })

  it('removes bold, italic and strikethrough markers', () => {
    expect(spoken('This is **very** _important_ and ~~old~~.')).toBe(
      'This is very important and old.',
    )
  })

  it('drops a horizontal rule without leaving an audible gap', () => {
    expect(spoken('Before\n\n---\n\nAfter')).toBe('Before\nAfter')
  })

  it('drops the angle bracket off a quote', () => {
    expect(spoken('> quoted here')).toBe('quoted here')
  })

  it('reduces a link to its visible text', () => {
    expect(spoken('See the [documentation](https://example.com/docs) for this.')).toBe(
      'See the documentation for this.',
    )
  })

  it('makes an image disappear entirely', () => {
    expect(spoken('Look at ![diagram](a.png) here.')).toBe('Look at here.')
  })
})

describe('file paths', () => {
  it('reduces a POSIX absolute path to the file name', () => {
    expect(spoken('I edited /Users/you/Downloads/Jarvis/package.json ok.')).toBe(
      'I edited package.json ok.',
    )
  })

  it('reduces a Windows drive path to the file name', () => {
    expect(spoken('I edited C:\\Users\\you\\Downloads\\Jarvis\\package.json ok.')).toBe(
      'I edited package.json ok.',
    )
  })

  it('reduces a Windows path written with forward slashes', () => {
    expect(spoken('Open C:/Users/you/Jarvis/SPEC.md now.')).toBe('Open SPEC.md now.')
  })

  it('reduces a deep relative path in either separator', () => {
    expect(spoken('See src/core/jarvis-core.js now.')).toBe('See jarvis-core.js now.')
    expect(spoken('See src\\core\\jarvis-core.js now.')).toBe('See jarvis-core.js now.')
  })

  it('reduces a UNC network path', () => {
    expect(spoken('Copy from \\\\server\\share\\report.docx please.')).toBe(
      'Copy from report.docx please.',
    )
  })

  it('keeps punctuation that follows a path', () => {
    expect(spoken('Open /a/b/c/file.txt.')).toBe('Open file.txt.')
    expect(spoken('Open C:\\a\\b\\file.txt.')).toBe('Open file.txt.')
  })

  it('leaves a bare web address whole', () => {
    // Shortening links is the link unwrapper's job.
    expect(spoken('Visit https://example.com/a/b today.')).toBe('Visit https://example.com/a/b today.')
  })

  it('does not mistake a lone slash between words for a path', () => {
    expect(spoken('Choose yes/no now.')).toBe('Choose yes/no now.')
  })

  it('does not mistake a lone backslash between words for a path', () => {
    expect(spoken('Type yes\\no now.')).toBe('Type yes\\no now.')
  })

  it('does not mistake a date for a path', () => {
    // Two slashes alone are not enough — otherwise this is read aloud as "2025".
    expect(spoken('Due on 12/31/2025 sharp.')).toBe('Due on 12/31/2025 sharp.')
  })

  it('does not mistake a run of alternatives for a path', () => {
    expect(spoken('Pick and/or/either now.')).toBe('Pick and/or/either now.')
  })

  it('still abbreviates a relative path that ends in a file name', () => {
    expect(spoken('Open src/core/paths.js please.')).toBe('Open paths.js please.')
  })
})

describe('horizontal rules written with spaces', () => {
  it('drops a spaced rule of dashes', () => {
    // The list-marker step would otherwise eat the first dash, leaving `- -`,
    // too short to still look like a rule — and it would be read aloud.
    expect(spoken('Before\n\n- - -\n\nAfter')).toBe('Before\nAfter')
  })

  it('drops a spaced rule of asterisks', () => {
    expect(spoken('Before\n\n* * *\n\nAfter')).toBe('Before\nAfter')
  })

  it('drops a rule of underscores', () => {
    expect(spoken('Before\n\n___\n\nAfter')).toBe('Before\nAfter')
  })

  it('leaves a real list item alone', () => {
    expect(spoken('- - not a rule')).toBe('- not a rule')
  })
})

describe('whitespace and emptiness', () => {
  it('leaves empty text empty', () => {
    expect(spoken('')).toBe('')
  })

  it('collapses repeated blank lines', () => {
    expect(spoken('one\n\n\n\ntwo')).toBe('one\ntwo')
  })

  it('normalizes Windows line endings', () => {
    expect(spoken('one\r\ntwo')).toBe('one\ntwo')
  })

  it('leaves Portuguese accents intact', () => {
    expect(spoken('A **ação** do coração não é ambígua.')).toBe('A ação do coração não é ambígua.')
  })
})
