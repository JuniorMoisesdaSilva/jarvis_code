'use strict'

// Registering Jarvis's MCP servers in Claude Code's own state file, and taking
// them back out.
//
// The user's MCP servers live in ~/.claude.json, which is not a settings file a
// person edits but the file Claude Code itself rewrites all the time — on every
// start, every project opened, every counter it bumps. Any Claude Code running
// while Jarvis writes there is a second writer, and the only defence a file
// with no lock allows is to hold it for as short a time as possible: read it
// and write it back in one step, with nothing in between — no other file, no
// copying, nothing that waits. A write that changes nothing is not made at all,
// which is most Connects. And only Connect and Disconnect come here: the
// panel's language switch has no business with this file.
//
// Each function reads the file afresh; none keeps a copy of it across calls,
// because a copy is exactly what goes stale.

const { readSettings, writeSettings, UnreadableSettingsError, isPlainObject } = require('./settings-file')

/** A server name that was not in the list, as a record keeps it. */
const ABSENT = { __jarvis_absent__: true }

function wasAbsent(value) {
  return isPlainObject(value) && value.__jarvis_absent__ === true
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The file and its server list: `{ host, servers }`, `servers` null when it has
 * none; null when the file is missing and `onMissing` is 'null'. A list that is
 * not an object is refused like an unreadable file — replacing it would lose
 * whatever it was.
 */
function read(file, { onMissing = 'empty' } = {}) {
  const host = readSettings(file, { onMissing })
  if (host === null) return null
  const servers = host.mcpServers
  if (servers !== undefined && !isPlainObject(servers)) throw new UnreadableSettingsError(file)
  return { host, servers: servers ?? null }
}

/** Written as Claude Code keeps it: its own key order, not sorted. */
function write(file, host) {
  writeSettings(file, host, { sorted: false })
}

/**
 * Puts every one of `servers` into the file's list, beside the host's own.
 * Returns whether the file was written: not when each is already there as it
 * would be written.
 */
function register(file, servers) {
  const hosted = read(file)
  const list = hosted.servers ?? {}
  if (hosted.servers !== null && Object.entries(servers).every(([name, server]) => same(list[name], server))) return false
  hosted.host.mcpServers = { ...list, ...servers }
  write(file, hosted.host)
  return true
}

/**
 * Puts back what the list held under each name a record keeps — `{ hadServers,
 * servers: { name: value or ABSENT } }` — and drops a list Jarvis had to make.
 * Returns whether the file was written: not when it is missing (nothing of ours
 * can be in it) or already as the record says.
 */
function unregister(file, record) {
  if (!isPlainObject(record) || !isPlainObject(record.servers)) return false
  const hosted = read(file, { onMissing: 'null' })
  if (hosted === null) return false
  const servers = { ...(hosted.servers ?? {}) }
  for (const [name, before] of Object.entries(record.servers)) {
    if (wasAbsent(before)) delete servers[name]
    else servers[name] = before
  }
  const dropList = Object.keys(servers).length === 0 && record.hadServers !== true
  if (dropList ? hosted.servers === null : same(servers, hosted.servers)) return false
  if (dropList) delete hosted.host.mcpServers
  else hosted.host.mcpServers = servers
  write(file, hosted.host)
  return true
}

/** Whether the list holds every one of `servers` as Jarvis would write it. Never throws. */
function isRegistered(file, servers) {
  let hosted
  try {
    hosted = read(file, { onMissing: 'null' })
  } catch {
    return false
  }
  if (hosted === null || hosted.servers === null) return false
  return Object.entries(servers).every(([name, server]) => same(hosted.servers[name], server))
}

/**
 * The record a first Connect keeps of what the list held under each of
 * `names`, added to an earlier record without overwriting any name it already
 * has — so the value kept is always the host's, never Jarvis's own.
 */
function record(earlier, servers, names) {
  const kept = isPlainObject(earlier)
    ? { hadServers: earlier.hadServers === true, servers: { ...earlier.servers } }
    : { hadServers: servers !== null, servers: {} }
  for (const name of names) {
    if (name in kept.servers) continue
    kept.servers[name] = servers !== null && name in servers ? servers[name] : ABSENT
  }
  return kept
}

module.exports = { read, register, unregister, isRegistered, record, ABSENT, UnreadableSettingsError }
