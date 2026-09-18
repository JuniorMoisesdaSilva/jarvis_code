'use strict'

// The handful of places where Windows and macOS genuinely differ, decided in
// one file rather than sprinkled through the app.
//
// Pure by construction: every function takes the platform and the environment
// rather than reading them, and the callers that do not care pass nothing. That
// is what lets a Mac test what Windows will do, and the other way round.

/** Is this the platform Jarvis is running on right now? */
function current() {
  return { platform: process.platform, env: process.env }
}

/**
 * The shell a Session opens with when the user has not chosen one.
 *
 * On Windows that is PowerShell, which is what everybody has. On a Mac the
 * user's own login shell is a better answer than any name we could pick — it is
 * the one their `PATH` is built for, and Claude Code has to be on it — so `zsh`
 * is only the fallback for an environment that does not say.
 */
function defaultShell({ platform, env } = current()) {
  if (platform === 'win32') return 'powershell.exe'
  const chosen = typeof env?.SHELL === 'string' ? env.SHELL.trim() : ''
  return chosen !== '' ? chosen : '/bin/zsh'
}

/**
 * Whether a stored path is one the platform running now could have written.
 *
 * The preferences file travels inside the folder — that is what portable by
 * copy means — so it arrives on Windows holding a Mac's answers, and on a Mac
 * holding Windows'. `/bin/zsh` is not a shell Windows can open and
 * `/Users/someone/Code` is not a folder it can find: kept, the first opens a
 * Session on a shell that does not exist, and the second offers to reopen a
 * project that was never here.
 *
 * Shape, not existence. It asks whether this platform could have written the
 * path, not whether the path is on the disk today — a project moved or deleted
 * is a different question, and answering it here would throw away a perfectly
 * good preference every time a drive was not mounted yet.
 *
 * A bare name — `zsh`, `bash` — belongs to whoever is asking. It names no
 * place, so there is nothing in it to be foreign. With one exception, and it
 * is the one this file used to get wrong: `powershell.exe` names no place
 * either, but the suffix names a platform. Kept, a Mac opens a Session on a
 * program that is not installed, and node-pty cannot say so — the exec fails
 * inside the forked child, the spawn returns a live handle, and the terminal
 * dies in milliseconds having written nothing anywhere. So an executable
 * suffix is Windows-shaped wherever it turns up, which is what the Windows
 * side actually stores: `defaultShell` above returns a bare `powershell.exe`.
 */
function isNativePath(candidate, { platform } = current()) {
  const value = String(candidate ?? '').trim()
  if (value === '') return false
  // A suffix only names a platform on a name that names no place: a folder
  // called `tools.exe` on a Mac is still a Mac folder.
  const bare = !value.includes('/') && !value.includes('\\')
  const windowsShaped =
    /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\') || (bare && /\.exe$/i.test(value))
  const posixShaped = value.startsWith('/')
  return platform === 'win32' ? !posixShaped : !windowsShaped
}

/**
 * The command Claude Code is told to run for the status line.
 *
 * The status line is part of the Carried personality — the behaviour Jarvis
 * applies to whatever machine it is plugged into — so it has to run the same on
 * both. It is a Node script, and Node is already there: Claude Code itself does
 * not run without it.
 */
function statusLineCommand(script) {
  return `node "${String(script).replace(/\\/g, '/')}"`
}

/**
 * The file name at the end of a path, whichever separator wrote it.
 *
 * `path.basename` only splits the separator of the platform it is running on,
 * so a Mac reads `C:\\...\\powershell.exe` as one long file name. Jarvis holds
 * paths written by the other platform often enough — a stored preference that
 * travelled in the folder — that this cannot depend on where it runs.
 */
function fileName(candidate) {
  const parts = String(candidate ?? '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

module.exports = { defaultShell, isNativePath, statusLineCommand, fileName, current }
