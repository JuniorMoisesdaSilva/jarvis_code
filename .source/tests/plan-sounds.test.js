import { describe, expect, it } from 'vitest'
import { createPlanSounds, PLAN_SOUND_FILES } from '../src/main/sounds.js'

// The Plan block's two sounds are the Windows files the terminal mod played.
// The main process reads each once and hands its bytes to the window the plan
// belongs to, which plays it; a file that is not there is silence, never an error.

function panel() {
  const sent = []
  return {
    sent,
    isDestroyed: () => false,
    send: (channel, payload) => sent.push({ channel, payload }),
  }
}

describe('the plan sounds', () => {
  it('are the two Windows files the terminal mod used', () => {
    expect(PLAN_SOUND_FILES).toEqual({
      step: 'C:\\Windows\\Media\\Windows Notify System Generic.wav',
      done: 'C:\\Windows\\Media\\tada.wav',
    })
  })

  it('send the file’s bytes to the window, reading each file once', () => {
    const reads = []
    const sounds = createPlanSounds({
      read: (file) => {
        reads.push(file)
        return Buffer.from(file === PLAN_SOUND_FILES.done ? 'tada' : 'ding')
      },
    })
    const contents = panel()
    sounds.play('step', contents)
    sounds.play('step', contents)
    sounds.play('done', contents)
    expect(reads).toEqual([PLAN_SOUND_FILES.step, PLAN_SOUND_FILES.done])
    expect(contents.sent.map((each) => each.channel)).toEqual(['sound:chime', 'sound:chime', 'sound:chime'])
    expect(Buffer.from(contents.sent[2].payload).toString()).toBe('tada')
  })

  it('are silent when the file is missing, and say nothing about it', () => {
    const sounds = createPlanSounds({
      read: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    })
    const contents = panel()
    expect(() => sounds.play('done', contents)).not.toThrow()
    expect(contents.sent).toEqual([])
  })

  it('are silent for a sound they do not know, or a window that is gone', () => {
    const sounds = createPlanSounds({ read: () => Buffer.from('x') })
    const contents = panel()
    sounds.play('none', contents)
    sounds.play('step', null)
    sounds.play('step', { isDestroyed: () => true, send: () => contents.sent.push('gone') })
    expect(contents.sent).toEqual([])
  })
})
