import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureTranscript } from '../src/core/agent-transcript.js'
import { READ_LIMIT, readAgentFigures } from '../src/main/agent-transcript.js'

// A subagent's tokens and whether it ran out of output room are only in its own
// transcript, read once when it stops. The reading is a pure function of the
// text; the file is the main process's business, and an unreadable one leaves
// the figures blank rather than raising anything.

/** One assistant line as Claude Code writes it: a content block of a message, with that message's usage. */
function assistant(id, usage, stopReason = null, block = { type: 'text', text: 'ok' }) {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    agentId: 'a3f9c2e1b7d04e58',
    message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [block], stop_reason: stopReason, usage },
  })
}

const user = JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'Find the installer' } })

const usage = (input, output, cacheRead = 0, cacheCreation = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
})

describe('measuring a subagent transcript', () => {
  it('sums the usage of every assistant message', () => {
    const text = [user, assistant('msg_1', usage(10, 200, 3000, 400), 'tool_use'), assistant('msg_2', usage(5, 80, 3400, 0), 'end_turn')].join('\n')
    expect(measureTranscript(text)).toEqual({
      tokens: { input: 15, output: 280, cacheRead: 6400, cacheCreation: 400 },
      outOfOutput: false,
    })
  })

  it('counts a message once, though Claude Code writes a line per content block', () => {
    const text = [
      assistant('msg_1', usage(10, 50, 100, 0), null, { type: 'thinking', thinking: '…' }),
      assistant('msg_1', usage(10, 200, 100, 0), 'tool_use', { type: 'tool_use', name: 'Read' }),
    ].join('\n')
    expect(measureTranscript(text).tokens).toEqual({ input: 10, output: 200, cacheRead: 100, cacheCreation: 0 })
  })

  it('flags a message that stopped because it ran out of output room', () => {
    const text = [assistant('msg_1', usage(1, 2), 'tool_use'), assistant('msg_2', usage(1, 32000), 'max_tokens')].join('\n')
    expect(measureTranscript(text).outOfOutput).toBe(true)
  })

  it('skips a line it cannot read, such as one cut short', () => {
    const text = [assistant('msg_1', usage(4, 6)), '{"type":"assistant","mess'].join('\r\n')
    expect(measureTranscript(text).tokens).toEqual({ input: 4, output: 6, cacheRead: 0, cacheCreation: 0 })
  })

  it('leaves the figures blank when there is no assistant message at all', () => {
    expect(measureTranscript(user)).toBeNull()
    expect(measureTranscript('')).toBeNull()
    expect(measureTranscript('not json')).toBeNull()
    expect(measureTranscript(null)).toBeNull()
  })
})

describe('reading the transcript file', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-'))

  it('reads the figures of a transcript on disk', async () => {
    const file = path.join(folder, 'agent-a.jsonl')
    fs.writeFileSync(file, [user, assistant('msg_1', usage(1, 2, 3, 4), 'max_tokens')].join('\n'))
    expect(await readAgentFigures(file)).toEqual({
      tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 },
      outOfOutput: true,
    })
  })

  it('gives nothing, and raises nothing, for a transcript that is missing', async () => {
    expect(await readAgentFigures(path.join(folder, 'nowhere.jsonl'))).toBeNull()
    expect(await readAgentFigures(null)).toBeNull()
  })

  it('reads nothing that is not a transcript, or is too big to be worth reading', async () => {
    const other = path.join(folder, 'agent-a.txt')
    fs.writeFileSync(other, assistant('msg_1', usage(1, 2)))
    expect(await readAgentFigures(other)).toBeNull()

    const big = path.join(folder, 'agent-big.jsonl')
    fs.writeFileSync(big, assistant('msg_1', usage(1, 2)))
    expect(await readAgentFigures(big, { limit: 10 })).toBeNull()
  })

  it('reads at most 8 MB: a subagent that long is better blank than slow', () => {
    expect(READ_LIMIT).toBe(8 * 1024 * 1024)
  })

  it('reads a long transcript a slice at a time, letting the main process breathe between', async () => {
    const file = path.join(folder, 'agent-long.jsonl')
    const lines = []
    for (let n = 0; n < 50; n += 1) lines.push(user, assistant(`msg_${n}`, usage(1, 1)))
    fs.writeFileSync(file, lines.join('\n'))
    let pauses = 0
    const figures = await readAgentFigures(file, {
      chunkLines: 10,
      pause: async () => {
        pauses += 1
      },
    })
    expect(figures.tokens).toEqual({ input: 50, output: 50, cacheRead: 0, cacheCreation: 0 })
    expect(pauses).toBeGreaterThanOrEqual(9)
  })
})
