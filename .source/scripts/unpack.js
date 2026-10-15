'use strict'

// Unpacking an archive.
//
// bsdtar reads bzip2, gzip and zip by itself, and Windows has carried it since
// Windows 10. Shelling out to it beats adding a decompression library for a
// handful of files fetched at build time.
//
// It is named by full path on purpose. On a machine with Git installed, plain `tar` finds GNU tar first, which does not decompress bzip2
// itself: it pipes the archive through `bzip2.exe`, and that pipe breaks when
// the process has no console — which is exactly the case when npm runs a script.
// The archive is perfectly good and the error says it is corrupted, so this is
// worth ruling out rather than diagnosing twice.
//
// Read by both scripts that fetch anything, so the decision above is made once.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const BSDTAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/**
 * Unpacks `archive` into `into`, which is created if it is not there. `extra`
 * carries the flags that differ from one archive to the next — `-j` or `-z` for
 * how it is compressed, `--strip-components` for a wrapper folder to drop.
 */
function unpack(archive, into, extra = []) {
  fs.mkdirSync(into, { recursive: true })
  const tar = fs.existsSync(BSDTAR) ? BSDTAR : 'tar'
  execFileSync(tar, ['-x', ...extra, '-f', archive, '-C', into], { stdio: 'inherit' })
}

module.exports = { unpack }
