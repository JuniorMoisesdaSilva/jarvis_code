'use strict'

// The handover between a running Jarvis and a launch of different code, as
// Electron and the disk see it. The rules are the core's
// (src/core/second-launch.js); this is the lock, the waiting, and the answers.
//
// Electron lets a launch say something to the running Jarvis — the data passed
// to `requestSingleInstanceLock` — but gives it no way to hear back. So the
// launch names a file, and the running Jarvis writes its answer there.

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')
const { launchStep } = require('../core/second-launch')

const EVERY = 200

/** Only a file a launch could have named: in a folder, and called as `answerFile` calls it. */
const ANSWER_NAME = /^jarvis-launch-[0-9]+-[0-9a-f]+\.json$/

function answerFile() {
  return path.join(os.tmpdir(), `jarvis-launch-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`)
}

/** The running Jarvis's answer, written whole: the launch may be reading at any moment. */
function writeAnswer(to, answer) {
  if (typeof to !== 'string' || !path.isAbsolute(to) || !ANSWER_NAME.test(path.basename(to))) return
  try {
    const partial = `${to}.${process.pid}.partial`
    fs.writeFileSync(partial, JSON.stringify({ answer, pid: process.pid }))
    fs.renameSync(partial, to)
  } catch {
    // The launch has gone, or its folder with it. It decides for itself when
    // it hears nothing.
  }
}

function readAnswer(file) {
  try {
    const { answer, pid } = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { answer: typeof answer === 'string' ? answer : null, pid: Number.isInteger(pid) ? pid : null }
  } catch {
    return { answer: null, pid: null }
  }
}

function isRunning(pid) {
  if (pid === null) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ENDINGS = {
  opened: 'Jarvis is already running: it opened a window.',
  'no-answer': 'Jarvis is already running: it was asked to open a window.',
  kept: 'Jarvis is already running, and it was kept: this launch, with newer code, was not started.',
  'give-up':
    'Jarvis could not start: the Jarvis already running did not close within 10 seconds. ' +
    'Quit it from the tray and start Jarvis again.',
}

/**
 * Takes the single-instance lock, waiting for it if the running Jarvis makes
 * way. Resolves true when this process holds the lock and should start; false
 * once it has said on its own console why it is leaving.
 *
 * @param build this launch's fingerprint.
 */
async function takeLock(build) {
  const file = answerFile()
  const launching = { build, reply: file }
  if (app.requestSingleInstanceLock(launching)) return true

  const sent = Date.now()
  let makingWaySince = null
  let saidAsking = false
  try {
    for (;;) {
      const { answer, pid } = readAnswer(file)
      if (answer === 'asking' && !saidAsking) {
        saidAsking = true
        console.log('Jarvis is already running, with older code: it is asking whether to restart.')
      }
      const runningAlive = isRunning(pid)
      const losingIt = answer === 'making-way' || (answer === 'asking' && !runningAlive)
      if (losingIt && makingWaySince === null) makingWaySince = Date.now()
      const step = launchStep({
        answer,
        runningAlive,
        sinceSent: Date.now() - sent,
        sinceMakingWay: makingWaySince === null ? 0 : Date.now() - makingWaySince,
      })
      if (step === 'try-lock') {
        if (app.requestSingleInstanceLock(launching)) {
          console.log('Jarvis: the Jarvis that was running made way; this one is starting.')
          return true
        }
      } else if (step !== 'wait') {
        ;(step === 'give-up' ? console.error : console.log)(ENDINGS[step])
        process.exitCode = step === 'give-up' ? 1 : 0
        return false
      }
      await sleep(EVERY)
    }
  } finally {
    fs.rmSync(file, { force: true })
  }
}

module.exports = { takeLock, writeAnswer }
