#!/usr/bin/env node
'use strict'

// Claude Code status line, printed on two lines:
//   <cwd> [ (branch)]  <model>
//   Context: [####------] <pct>% | Usage 5h: [##--------] <pct>% | 7d: [#####-----] <pct>%
//
// Shows the current directory (home abbreviated as ~), the git branch when
// inside a repo (omitted entirely otherwise), the model display name, a
// 10-block visual context-usage bar, and 10-block bars for both plan rate
// limit windows (5 hour and 7 day).
//
// Written in Node rather than PowerShell because the status line is part of the
// Carried personality — the behaviour Jarvis applies to whatever machine it is
// plugged into — and that half of the folder is meant to be the same on both.
// Node is a safe thing to require: Claude Code itself does not run without it.
//
// Field sources, verified against the Claude Code binary's own payload builder
// (v2.1.220):
//   model.display_name                          -> model name
//   context_window.used_percentage              -> integer 0-100, or null
//                                                  before any usage is reported
//   rate_limits.five_hour.used_percentage       -> utilization * 100, so a
//   rate_limits.seven_day.used_percentage          float, not a rounded int
// The whole `rate_limits` key is omitted by the binary unless at least one
// window is present, and each window is spread in conditionally, so either may
// be missing on its own. Missing windows render as 0% to keep the line width
// stable.
//
// The flat keys `display_name` / `context_percent` are also accepted as a
// fallback so the manual validation snippet in "Claude Context.md" still works.

const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

function bar(percent) {
  const filled = Math.min(10, Math.max(0, Math.floor(percent / 10)))
  return `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`
}

/**
 * Whole numbers print without a trailing ".0", real decimals keep one place.
 * The rate limit percentages arrive as utilization*100, so they routinely carry
 * a long fractional tail that has to be trimmed.
 */
function percentText(percent) {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, '')
}

function readPayload() {
  let raw = ''
  try {
    raw = fs.readFileSync(0, 'utf8')
  } catch {
    return null
  }
  // Tolerate a leading byte-order mark, or anything else ahead of the JSON:
  // when the console's input encoding is not UTF-8 those bytes decode to
  // arbitrary characters, so drop everything before the first brace.
  const brace = raw.indexOf('{')
  if (brace > 0) raw = raw.slice(brace)
  if (raw.trim() === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function numberAt(...candidates) {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

/** The branch, or an empty string when this is not a repository. */
function branchSegment(cwd) {
  try {
    const inside = execFileSync('git', ['--no-optional-locks', '-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (inside !== 'true') return ''
    const branch = execFileSync('git', ['--no-optional-locks', '-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return branch === '' ? '' : `  (${branch})`
  } catch {
    // No git, or not a repository. Either way the segment is simply omitted.
    return ''
  }
}

function main() {
  const data = readPayload()

  if (data === null) {
    console.log('Claude')
    console.log(`Context: ${bar(0)} 0% | Usage 5h: ${bar(0)} 0% | 7d: ${bar(0)} 0%`)
    return
  }

  const model = data.model?.display_name ?? data.display_name ?? 'Claude'
  const context = numberAt(data.context_window?.used_percentage, data.context_percent)
  const fiveHour = numberAt(data.rate_limits?.five_hour?.used_percentage)
  const sevenDay = numberAt(data.rate_limits?.seven_day?.used_percentage)

  const cwd = data.workspace?.current_dir ?? process.cwd()
  const home = os.homedir()
  const shown =
    home && cwd.toLowerCase().startsWith(home.toLowerCase()) ? `~${cwd.slice(home.length)}` : cwd

  console.log(`${shown}${branchSegment(cwd)}  ${model}`)
  console.log(
    `Context: ${bar(context)} ${percentText(context)}% | ` +
      `Usage 5h: ${bar(fiveHour)} ${percentText(fiveHour)}% | ` +
      `7d: ${bar(sevenDay)} ${percentText(sevenDay)}%`,
  )
}

main()
