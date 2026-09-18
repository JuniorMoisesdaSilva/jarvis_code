'use strict'

// Unpacking an archive, the one way both platforms manage it.
//
// bsdtar reads bzip2 and gzip by itself, and both platforms have it: Windows has
// carried it since Windows 10, and it is what `/usr/bin/tar` is on a Mac.
// Shelling out to it beats adding a decompression library for a handful of
// files fetched at build time.
//
// On Windows it is named by full path on purpose. On a machine with Git
// installed, plain `tar` finds GNU tar first, which does not decompress bzip2
// itself: it pipes the archive through `bzip2.exe`, and that pipe breaks when
// the process has no console — which is exactly the case when npm runs a script.
// The archive is perfectly good and the error says it is corrupted, so this is
// worth ruling out rather than diagnosing twice.
//
// Read by both scripts that fetch anything, so the decision above is made once.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const BSDTAR =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar'

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
