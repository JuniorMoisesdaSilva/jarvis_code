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

/**
 * A named pipe, one per user: two people signed in at once must not cross
 * wires. A pipe leaves nothing behind when the app stops, so there is no file
 * to sweep away after a crash.
 *
 * The override is for the test that spawns the real relay: it needs a channel of
 * its own, or it would deliver its test event to whatever Jarvis the developer
 * happens to have running.
 */
function channelAddress(env = process.env) {
  if (env.JARVIS_PIPE) return env.JARVIS_PIPE
  const who = (os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '')
  return `\\\\.\\pipe\\jarvis-hook-${who}`
}

module.exports = { channelAddress }
