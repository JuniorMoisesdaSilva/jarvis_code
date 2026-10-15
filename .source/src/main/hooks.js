'use strict'

// How Claude Code's notices reach Jarvis.
//
// The hooks are registered globally, so they fire in any project, and they run
// a small launcher this file writes. The launcher interprets nothing: it starts
// helpers/hook-relay.js, which forwards the event over a local channel and
// exits. If Jarvis is not running it exits silently, because a hook that blocks
// would hold up the agent itself.
//
// The channel is a named pipe, which Node's `net` server and client take as an
// address like any other.

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { onDisk } = require('./unpacked')
const {
  createInstaller,
  helperCommandLine,
  launcherName,
  UnreadableSettingsError,
  EVENTS,
  HELPER_FLAG,
} = require('../core/hook-installer')
const { channelAddress } = require('./helpers/hook-channel')

function settingsFile() {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

// --- The launcher Claude Code runs -------------------------------------------

// The relay, as a real file on disk: helpers/ is unpacked when the app is
// assembled, precisely so the things started from outside the archive can be
// found.
const RELAY = onDisk(path.join(__dirname, 'helpers', 'hook-relay.js'))

/** A batch file wants Windows line endings. */
const CRLF = '\r\n'

/**
 * Where the launcher is written. Beside the preferences, because it is
 * something Jarvis writes for this machine rather than something it ships: it
 * names two absolute paths, and both of them move when the folder does.
 *
 * Under a name only this machine writes — see `launcherName` in the core. The
 * folder may be synced to other machines, and the launcher is the one thing in
 * it that cannot be shared.
 */
function launcherFile() {
  const name = launcherName({ machine: os.hostname() })
  return path.join(require('./data-location').where().dataDir, name)
}

/**
 * Two lines: set the variable that turns Electron's binary into Node, then run
 * the relay with it.
 *
 * Why a file at all, rather than putting both into the hook command. Claude Code
 * hands the command to a shell, and which shell is not knowable from here — on
 * Windows it may be `cmd`, and it may be the `sh` that comes with Git. Setting
 * an environment variable inline is written differently in each, and quoting a
 * path inside an already-quoted command differently again. A quoted path
 * followed by arguments is the one shape all of them agree on, so that is all
 * the hook command is, and the shell-specific part lives in a file whose own
 * interpreter is never in doubt.
 *
 * `%*` forwards the marker the command line carries. The relay ignores it;
 * dropping it here would only mean the launcher and the command disagree about
 * what was asked.
 */
function launcherContents() {
  return [
    '@echo off',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${process.execPath}" "${RELAY}" %*`,
    '',
  ].join(CRLF)
}

/**
 * Writes the launcher, unless it already says exactly this.
 *
 * Rewritten rather than written once, because both paths inside it are absolute
 * and the app is meant to be carried: a folder moved to another machine, or a
 * build assembled again, leaves a launcher pointing at an executable that is no
 * longer there. Since the hook command only ever names the launcher, fixing the
 * launcher is enough — Claude Code's settings never have to be touched again.
 *
 * The comparison is not an optimisation. This folder is often inside OneDrive,
 * and rewriting an unchanged file on every start would have the sync
 * client uploading it on every start too.
 */
function writeLauncher() {
  const file = launcherFile()
  const contents = launcherContents()
  try {
    if (fs.readFileSync(file, 'utf8') === contents) return file
  } catch {
    // Not there yet, or not readable. Either way, write it.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents, 'utf8')
  return file
}

/**
 * The command Claude Code is told to run. The shape of it is decided in the
 * core; this supplies the one path it needs, and makes sure that path leads
 * somewhere before handing it over.
 */
function helperCommand() {
  return helperCommandLine({ launcher: writeLauncher() })
}

function installer() {
  return createInstaller({ command: helperCommand(), file: settingsFile() })
}

/**
 * Replaces a hook left by an older Jarvis with the current one, at startup,
 * without asking.
 *
 * It is not an install: a machine with no hook of ours is left alone, because
 * connecting Claude Code to Jarvis is the user's to press. This only keeps a
 * hook that is already there pointing at something that still works.
 *
 * Silent on purpose, and safe to do every time. The command it writes names the
 * launcher, and the launcher is written for this machine on every start — so
 * once a settings file says this, it never has to say anything else, whichever
 * build wrote it and wherever the folder has been moved to since.
 */
function upgradeInstalledHooks() {
  try {
    return installer().upgrade()
  } catch {
    // A settings file that cannot be read or written is the user's to sort out,
    // and the Rail already says the hooks are not connected.
    return false
  }
}

// --- The listening side ------------------------------------------------------

let server = null

/**
 * Starts listening. Each connection carries one event as JSON and then closes.
 */
function listen(onPayload) {
  if (server) return server

  server = net.createServer((socket) => {
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      received += chunk
      // A single event should never be this big; something is wrong if it is.
      if (received.length > 2_000_000) socket.destroy()
    })
    socket.on('end', () => {
      const raw = received.trim()
      if (raw === '') return
      try {
        onPayload(JSON.parse(raw))
      } catch {
        // A payload we cannot read is dropped. The alternative — crashing the
        // app because Claude Code changed its format — is worse.
      }
    })
    socket.on('error', () => socket.destroy())
  })

  server.on('error', () => {
    // A stale pipe from a crashed instance, most likely. Nothing to recover.
    server = null
  })

  server.listen(channelAddress())
  return server
}

function stopListening() {
  if (!server) return
  server.close()
  server = null
}

// --- Being run as the helper ourselves ---------------------------------------
//
// This is no longer how an event arrives — helpers/hook-relay.js is — but the
// app has to keep answering to the flag, and the reason is not obvious.
//
// A settings file written by an older Jarvis still names the executable itself.
// Left unhandled, every event Claude Code reported would start the app, fail to
// take the single-instance lock, and be answered by the running Jarvis opening a
// window. A hook that opens a window per prompt is far worse than a slow one, so
// the old command keeps working: slowly, exactly as it did, until the user
// installs the hooks again and it is replaced.

function isHelperLaunch(argv = process.argv) {
  return argv.includes(HELPER_FLAG)
}

/**
 * Reads the event from standard input and forwards it. Never waits long: Claude
 * Code is holding still while this runs.
 *
 * The read is a plain synchronous read of file descriptor zero, and has to be.
 * `process.stdin` in Electron's main process ends immediately with nothing in
 * it — the event is sitting on that very handle, and the stream never delivers
 * it. Nothing errors along the way: the hook fires, the helper exits cleanly
 * with a zero, and Jarvis is simply never told. Every answer went unspoken for
 * that reason until 1 September 2026, which is why the relay is tested by
 * spawning the real thing rather than by calling a function.
 */
function runAsHelper() {
  const leave = () => {
    // Exit code zero always: a hook that reports failure interrupts the agent,
    // and a voice assistant being closed is not the agent's problem.
    process.exit(0)
  }

  let payload = ''
  try {
    payload = fs.readFileSync(0, 'utf8')
  } catch {
    // No standard input to speak of, so there is nothing to forward.
  }

  if (payload.trim() === '') {
    leave()
    return
  }

  const socket = net.connect(channelAddress(), () => {
    socket.end(payload)
  })
  socket.setTimeout(1500)
  socket.on('timeout', leave)
  socket.on('error', leave)
  socket.on('close', leave)

  // A connection that neither opens nor fails must not hang around either.
  setTimeout(leave, 3000)
}

module.exports = {
  listen,
  stopListening,
  installer,
  upgradeInstalledHooks,
  settingsFile,
  helperCommand,
  launcherFile,
  writeLauncher,
  channelAddress,
  isHelperLaunch,
  runAsHelper,
  UnreadableSettingsError,
  EVENTS,
  HELPER_FLAG,
}
