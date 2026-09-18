import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The core's whole value is that it can be exercised without audio, terminal or
// disk. That is easy to state and easy to break by accident, so it is checked.

const CORE = new URL('../src/core/', import.meta.url)

/** The files the reducer actually pulls in, followed transitively. */
function reachableFrom(entry) {
  const seen = new Set()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)

    const source = fs.readFileSync(new URL(file, CORE), 'utf8')
    for (const match of source.matchAll(/require\('\.\/([^']+)'\)/g)) {
      const required = match[1].endsWith('.js') ? match[1] : `${match[1]}.js`
      queue.push(required)
    }
  }

  return [...seen]
}

function sourceOf(file) {
  return fs.readFileSync(new URL(file, CORE), 'utf8')
}

function everyCoreFile() {
  return fs.readdirSync(CORE).filter((name) => name.endsWith('.js'))
}

describe('the core', () => {
  it('never reaches for Electron', () => {
    for (const file of everyCoreFile()) {
      expect(sourceOf(file), `${file} imports Electron`).not.toMatch(/require\('electron'\)/)
    }
  })

  it('never reaches for audio, child processes, or the network', () => {
    for (const file of everyCoreFile()) {
      const source = sourceOf(file)
      for (const forbidden of ['node:child_process', 'node:http', 'node:net', 'node:dgram']) {
        expect(source, `${file} imports ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('reaches the reducer without touching the file system', () => {
    // Two core modules are file-backed by design — the preferences and the hook
    // installer, both pure logic over an injectable path. Neither may be
    // reachable from the reducer, or its tests would need a disk.
    const reachable = reachableFrom('jarvis-core.js')

    expect(reachable).not.toContain('preferences.js')
    expect(reachable).not.toContain('hook-installer.js')
    for (const file of reachable) {
      expect(sourceOf(file), `${file} is reachable from the reducer and touches the disk`).not.toContain(
        'node:fs',
      )
    }
  })

  it('has a reducer that pulls in only what it needs', () => {
    expect(reachableFrom('jarvis-core.js').sort()).toEqual([
      'effects.js',
      'jarvis-core.js',
      'language.js',
      'paths.js',
      'permission-announcement.js',
      'speech-text-filter.js',
    ])
  })
})
