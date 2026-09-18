'use strict'

// The address the app and the relay Claude Code runs meet on.
//
// It lived in hooks.js until the relay stopped being the app itself. The relay
// is a plain Node script now and must not pull Electron in behind it, so the one
// thing both sides have to agree on sits here on its own, requiring nothing but
// Node.
//
// The core would be its natural home, except the core is forbidden `node:net`
// on purpose and this is a network address. It sits in helpers/ instead, beside
// the relay: everything in this folder is unpacked to real files when the app is
// assembled, and a relay started from disk resolves its imports from disk too —
// left inside the archive this module would simply not be there.

const os = require('node:os')
const path = require('node:path')

/**
 * One channel per user: two people signed in at once must not cross wires.
 *
 * On macOS the address is a path, and a path has a ceiling — 103 characters,
 * after which binding simply fails. The user id is used rather than the name
 * because it is short and cannot be, and the temporary folder is where a file
 * nobody owns belongs: it is swept up by the system, and it is not the user's
 * to find.
 *
 * The override is for the test that spawns the real relay: it needs a channel of
 * its own, or it would deliver its test event to whatever Jarvis the developer
 * happens to have running.
 */
function channelAddress(env = process.env) {
  if (env.JARVIS_PIPE) return env.JARVIS_PIPE
  if (process.platform === 'win32') {
    const who = (os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '')
    return `\\\\.\\pipe\\jarvis-hook-${who}`
  }
  return path.join(os.tmpdir(), `jarvis-hook-${process.getuid?.() ?? 0}.sock`)
}

/** A named pipe leaves nothing behind; a socket file does. */
function isSocketFile(address) {
  return !address.startsWith('\\\\')
}

module.exports = { channelAddress, isSocketFile }
