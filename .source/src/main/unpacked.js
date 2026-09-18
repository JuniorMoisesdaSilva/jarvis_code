'use strict'

// Turning a path inside the packaged archive into a path on the real disk.
//
// Electron makes the archive look like a folder to Node, which is why most code
// never has to think about it. But two things here are handed a path and then
// opened by somebody else entirely — PowerShell opening the speech host, and a
// worker thread starting from a file — and neither knows what an archive is.
//
// In development there is no archive and this changes nothing.

/**
 * The archive, wherever it falls in a path: with something after it, or at the
 * very end of one. The end matters. `app.getAppPath()` returns the archive
 * itself and nothing inside it, and a rule that insisted on a separator
 * afterwards left that path pointing into the archive with nothing said about
 * it — the models simply were not found, in a packaged build, at the moment
 * they were first needed.
 */
const ARCHIVE = /([\\/])app\.asar([\\/]|$)/

/** Where a file really is, given where the code thinks it is. */
function onDisk(file) {
  return file.replace(ARCHIVE, '$1app.asar.unpacked$2')
}

/** Whether the app is running from a packaged archive at all. */
function isPackaged(file) {
  return ARCHIVE.test(file)
}

module.exports = { onDisk, isPackaged }
