import { describe, expect, it } from 'vitest'
import { JarvisCore } from '../src/core/jarvis-core.js'
import { agentEvent, decode, decodeStatus } from '../src/core/hook-payload.js'
import { fixture } from './helpers.js'

// The nine Agent events only the Deck reads, each decoded from a payload shaped
// exactly like the one Claude Code sends. They carry what the Deck shows and
// nothing more: a format change stays in hook-payload.js.

const SESSION = '5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19'

describe('the tool calls Claude Code reports', () => {
  it('turns a tool about to run into a started call', () => {
    expect(agentEvent(fixture('pre-tool-use'))).toEqual({
      type: 'toolStarted',
      sessionId: SESSION,
      toolName: 'Bash',
      toolUseId: 'toolu_01HqT3s8kLwV2bXo9mYc4ZpA',
      detail: 'git status --short',
      agentId: null,
      agentType: null,
      permissionMode: 'default',
      effort: 'xhigh',
      spawn: null,
    })
  })

  it('says which subagent a call was made in', () => {
    expect(agentEvent(fixture('pre-tool-use-in-subagent'))).toMatchObject({
      type: 'toolStarted',
      toolName: 'Read',
      detail: 'C:\\Jarvis\\Docs\\MAP.md',
      agentId: 'a3f9c2e1b7d04e58',
      agentType: 'Explore',
    })
  })

  it('turns a tool that ran into a finished call, with how long it took', () => {
    expect(agentEvent(fixture('post-tool-use'))).toEqual({
      type: 'toolFinished',
      sessionId: SESSION,
      toolName: 'Edit',
      toolUseId: 'toolu_01Edit7aQ2nR5sTu8vWx1yZb',
      detail: 'C:\\Jarvis\\.source\\src\\core\\deck.js',
      agentId: null,
      agentType: null,
      permissionMode: 'default',
      effort: 'xhigh',
      spawn: null,
      durationMs: 41,
      plan: null,
    })
  })

  it('turns a tool that failed into a failed call, with its error', () => {
    expect(agentEvent(fixture('post-tool-use-failure'))).toMatchObject({
      type: 'toolFailed',
      toolName: 'Bash',
      toolUseId: 'toolu_01Fail2bC3dE4fG5hI6jK7lM',
      detail: 'npm test',
      error: 'Exit code 1\nTests  3 failed | 521 passed (524)',
      interrupted: false,
      durationMs: 20931,
    })
  })

  it('turns an auto-mode refusal into a denied call, with the reason', () => {
    expect(agentEvent(fixture('permission-denied'))).toMatchObject({
      type: 'permissionDenied',
      toolName: 'Bash',
      toolUseId: 'toolu_01Deny9zY8xW7vU6tS5rQ4pO',
      detail: 'rm -rf C:\\Jarvis\\Resources',
      reason: 'Deleting a folder outside the working tree is not allowed in auto mode',
      permissionMode: 'auto',
    })
  })

  it('falls back on the description for a tool with no path or command', () => {
    const payload = JSON.parse(fixture('pre-tool-use'))
    payload.tool_name = 'Agent'
    payload.tool_input = { description: 'Find the installer', prompt: 'Where…', subagent_type: 'Explore' }
    expect(agentEvent(payload).detail).toBe('Find the installer')
  })

  it('says what subagent an Agent call spawns, for what task, and whether in the background', () => {
    const payload = JSON.parse(fixture('pre-tool-use'))
    payload.tool_name = 'Agent'
    payload.tool_input = { description: 'Find the installer', prompt: 'Where…', subagent_type: 'Explore' }
    expect(agentEvent(payload).spawn).toEqual({ agentType: 'Explore', task: 'Find the installer', background: false })

    payload.tool_input = { description: 'Watch the build', prompt: '…', run_in_background: true }
    expect(agentEvent(payload).spawn).toEqual({ agentType: 'general-purpose', task: 'Watch the build', background: true })

    payload.tool_name = 'Task'
    expect(agentEvent(payload).spawn).toMatchObject({ task: 'Watch the build' })
  })
})

describe('the subagents, compactions and failures Claude Code reports', () => {
  it('turns a subagent starting into a started subagent', () => {
    expect(agentEvent(fixture('subagent-start'))).toEqual({
      type: 'subagentStarted',
      sessionId: SESSION,
      agentId: 'a3f9c2e1b7d04e58',
      agentType: 'Explore',
    })
  })

  it('turns a subagent stopping into a stopped subagent, with its transcript and last word', () => {
    expect(agentEvent(fixture('subagent-stop'))).toEqual({
      type: 'subagentStopped',
      sessionId: SESSION,
      agentId: 'a3f9c2e1b7d04e58',
      agentType: 'Explore',
      transcriptPath:
        'C:\\Users\\you\\.claude\\projects\\C--Jarvis\\5f0c2a1e-7b3d-4c8e-9a61-2d4e8f0b7c19\\subagents\\agent-a3f9c2e1b7d04e58.jsonl',
      lastMessage: 'The installer lives in src/core/hook-installer.js.',
    })
  })

  it('turns the two ends of a compaction into a start and a finish', () => {
    expect(agentEvent(fixture('pre-compact'))).toEqual({
      type: 'compactionStarted',
      sessionId: SESSION,
      trigger: 'auto',
    })
    expect(agentEvent(fixture('post-compact'))).toEqual({
      type: 'compactionFinished',
      sessionId: SESSION,
      trigger: 'auto',
    })
  })

  it('turns a turn that ended on an error into a failed turn', () => {
    expect(agentEvent(fixture('stop-failure'))).toEqual({
      type: 'turnFailed',
      sessionId: SESSION,
      error: 'rate_limit',
      details: '429 Too Many Requests: rate limit reached for the five-hour window',
    })
  })

  it('keeps the folder each one came from, for routing', () => {
    expect(decode(fixture('subagent-start')).workingDirectory).toBe('C:\\Jarvis')
  })
})

describe('what the core makes of them', () => {
  const ALL = [
    'pre-tool-use',
    'pre-tool-use-in-subagent',
    'post-tool-use',
    'post-tool-use-failure',
    'permission-denied',
    'subagent-start',
    'subagent-stop',
    'pre-compact',
    'post-compact',
    'stop-failure',
  ]

  it('says nothing and writes nothing: the Deck is only to look at', () => {
    const core = new JarvisCore({ projectPath: 'C:\\Jarvis' })
    for (const name of ALL) expect(core.receive(decode(fixture(name)))).toEqual([])
  })
})

describe('the status line reporting', () => {
  it('turns its payload into a status reading, in Jarvis units', () => {
    const reading = decodeStatus({ ...JSON.parse(fixture('status-line')), jarvis_reading: 'status' })

    expect(reading.workingDirectory).toBe('C:\\nowhere-jarvis')
    expect(reading.terminal).toBeNull()
    expect(reading.event).toEqual({
      type: 'statusReported',
      sessionId: SESSION,
      figures: {
        contextPercent: 62,
        fiveHour: { percent: 40.49999, resetsAt: 1760340000 * 1000 },
        sevenDay: { percent: 12, resetsAt: 1760900000 * 1000 },
        model: 'Opus 4.7',
        effort: 'high',
        folder: 'C:\\nowhere-jarvis',
        branch: null,
      },
    })
  })

  it('carries the folder and branch the status line worked out', () => {
    const payload = {
      ...JSON.parse(fixture('status-line')),
      jarvis_reading: 'status',
      jarvis_folder: '~\\work\\jarvis',
      jarvis_branch: 'main',
    }
    expect(decodeStatus(payload).event.figures).toMatchObject({ folder: '~\\work\\jarvis', branch: 'main' })
    // Outside a repository the script sends an empty branch: no branch at all.
    expect(decodeStatus({ ...payload, jarvis_branch: '' }).event.figures.branch).toBeNull()
  })

  it('leaves out what Claude Code has not reported yet, rather than calling it zero', () => {
    const reading = decodeStatus({ ...JSON.parse(fixture('status-line-early')), jarvis_reading: 'status' })
    expect(reading.event.figures).toEqual({
      contextPercent: null,
      fiveHour: null,
      sevenDay: null,
      model: 'Sonnet 4.6',
      effort: null,
      folder: 'C:\\nowhere-jarvis',
      branch: null,
    })
  })

  it('keeps a plan window that came alone', () => {
    const payload = {
      ...JSON.parse(fixture('status-line')),
      rate_limits: { seven_day: { used_percentage: 3 } },
      jarvis_reading: 'status',
    }
    expect(decodeStatus(payload).event.figures).toMatchObject({
      fiveHour: null,
      sevenDay: { percent: 3, resetsAt: null },
    })
  })

  it('carries the terminal the status line ran in', () => {
    const payload = { ...JSON.parse(fixture('status-line')), jarvis_reading: 'status', jarvis_terminal: 'term-3' }
    expect(decodeStatus(payload).terminal).toBe('term-3')
  })

  it('is told apart from a hook in both directions', () => {
    const status = { ...JSON.parse(fixture('status-line')), jarvis_reading: 'status' }
    // A reading is never a hook: the core would speak it or adopt a session by it.
    expect(decode(status)).toBeNull()
    // And a hook, or an untagged payload, is never a reading.
    expect(decodeStatus(fixture('pre-tool-use'))).toBeNull()
    expect(decodeStatus(JSON.parse(fixture('status-line')))).toBeNull()
    expect(decodeStatus({ jarvis_reading: 'status' })).toBeNull()
  })
})

describe('the permission mode, wherever a hook carries it', () => {
  it('rides along with a prompt, a permission request and an answer', () => {
    expect(agentEvent(fixture('user-prompt-submit'))).toMatchObject({ permissionMode: 'auto' })
    expect(agentEvent(fixture('stop-interactive'))).toMatchObject({ permissionMode: 'auto', effort: 'xhigh' })
    expect(agentEvent(fixture('permission-request'))).toMatchObject({
      permissionMode: 'default',
      effort: 'xhigh',
    })
  })
})

describe('a permission request, as the Permissions block reads it', () => {
  it('names the subagent that asked, and nobody in the main conversation', () => {
    expect(agentEvent(fixture('permission-request'))).toMatchObject({ agentId: null })
    const inside = { ...JSON.parse(fixture('permission-request')), agent_id: 'a3f9c2e1b7d04e58' }
    expect(agentEvent(inside)).toMatchObject({ agentId: 'a3f9c2e1b7d04e58' })
  })
})
