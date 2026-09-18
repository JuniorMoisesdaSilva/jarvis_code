# Jarvis

A voice assistant for Claude Code, on Windows and macOS. You speak instead of
typing, hear the answer instead of reading it, and are told out loud when the
agent stops to ask for permission — with everything still saved as readable text.

Jarvis owns the terminal Claude Code runs in, which is what lets it insert
dictated text into the input line without simulating a single keystroke. Nothing
is ever submitted on your behalf: pressing Enter stays your act, and a permission
request can only ever be granted from the keyboard.

Nothing you say or hear leaves the machine. Jarvis listens with a Whisper model
that runs locally and reads with voices it carries in this folder.

## What the machine needs first

- **Claude Code, installed and already signed in.** This is the one thing Jarvis
  cannot do for you. It never carries a login or a permission of its own — the
  account is whichever one is signed in on the machine.
  [Installing Claude Code](https://docs.claude.com/en/docs/claude-code/overview).
- **Node.js 22.12 or newer.** [nodejs.org](https://nodejs.org). Everything runs
  from `.source/`, from source, on both platforms.
- **Windows 11 on x64, or a Mac on Apple Silicon.** An Intel Mac and an Arm
  Windows machine are both out of reach: every compiled piece Jarvis depends on —
  the speech engine, the ONNX runtime, the terminal — publishes a `win32-x64` and
  a `darwin-arm64` build and no others.
- **A microphone**, and its permission, which the first run asks for.
- **Git**, a connection, and about 4 GB of free disk for the first install:
  roughly 2 GB of voices and listening model, a gigabyte of dependencies, and
  the Electron runtime. All of it is fetched once and none of it is in Git.

## Install and run

```
git clone https://github.com/JuniorMoisesdaSilva/jarvis_code.git Jarvis
cd Jarvis/.source
npm install
npm run fetch-assets
npm start
```

What each step is for:

- **`npm install`** — the dependencies, plus two repairs npm leaves undone: the
  executable bit on node-pty's `spawn-helper` on a Mac, and any compiled package
  missing because the tree was installed on the other platform.
- **`npm run fetch-assets`** — the seven voices Jarvis reads in — five Brazilian
  Portuguese and two American English — and the Whisper model it listens with,
  into `Resources/` at the root: about 2 GB, fetched once and shared by both
  platforms. Skip it and Jarvis still opens and still dictates — it downloads
  the listening model on first use — but it has no voice to read the answer in,
  because it offers only the voices it carries.
- **`npm start`** — fetches Electron for this platform into `Windows/electron/`
  or `macOS/electron/` the first time, then opens the app. The runtime is kept
  per platform on purpose: `node_modules` can be one tree shared by two machines,
  and Electron unpacks into a single folder inside it.

`npm test` runs the suite. `npm run assemble` builds the app into `Windows/` or
`macOS/`, for whichever platform it is run on; running from source needs neither.

## The first run

Two things are yours to do, once:

1. **Connect Jarvis to Claude Code.** Open Settings from the rail's footer and
   press Connect under "Claude Code". This installs the five Agent event hooks
   and applies Jarvis's behaviour — the spoken-summary output style, the two-line
   status line, the model, and the language Claude Code answers in — into your
   global Claude Code configuration, keeping a copy of the file first. Disconnect
   puts it all back the way it was. It never touches your login or your
   permissions. Without it, Jarvis never learns that an answer finished or that
   permission was asked for.
2. **Allow the microphone.** On Windows: Settings → Privacy & security →
   Microphone, including "Let desktop apps access your microphone". On macOS the
   box appears the first time you speak; if you miss it, System Settings →
   Privacy & Security → Microphone.

The PT/EN switch in the panel decides all three at once: the engine that hears
you, the voice that reads to you, and the language Claude Code answers in. It
opens on PT, and Claude Code picks the change up when a session starts, so it
arrives with the next session rather than mid-answer.

Jarvis opens with nothing running. Choose a project folder with "New session…"
in the rail and it opens a shell there — PowerShell on Windows, your own login
shell on a Mac, unless you name another in Settings — and the Claude button runs
`claude` in it. Command buttons do press Enter, which dictation never does: a
command is one you wrote yourself and can read on the button. Until a session
exists there is nothing to dictate into, so the microphone keeps its place in the
rail, disabled, and says why.

## The folder

This repository **is** Jarvis. The compartments you open — `Brain`, `Resources`,
`Windows`, `macOS`, `Start Here` — and two you never have to:
`.source`, where the code is edited exactly once for both platforms, and
`.jarvis-data`, where Jarvis keeps what it writes.

`Brain/` holds everything Jarvis carries into a machine's Claude Code, as plain
files you can read and change: the Maestro's instruction, the reply style, the
status line it draws and the model and language it sets, and the Maestro's
embedded copies of the skills it reads. There is one copy of each and Jarvis
reads it from here, so the file you edit is the file that travels.

`Windows/` and `macOS/` are assembled, never edited, and each can only be built
on its own machine — the compiled pieces are published per platform and npm will
not install another machine's. They share one copy of the voices and the
listening model, in `Resources/` at the root, which is the whole reason the
folder holds two apps and about 2 GB of weights rather than two of each.

The app finds all of this by walking up to the hidden `.jarvis-root` marker, so
it works the same run from source and run from a packaged app four levels down.

## How it fits together

- **The core** (`.source/src/core/`) holds every rule about how Jarvis behaves:
  an event goes in, effects come out. It knows nothing of terminals, microphones,
  voices or disks, which is what lets the whole behaviour be tested without them.
  It is also where the two platforms are told apart, in one file rather than
  scattered: `platform.js` and `folder.js`.
- **The adapters** (`.source/src/main/`) carry those effects out — the shell,
  Whisper, the voices, and the local channel Claude Code's events arrive
  through: a named pipe on Windows, a socket file on macOS.
- **The windows** (`.source/src/renderer/`) are one workspace window holding
  three views — the terminal on the left, the Jarvis rail down the right, and the
  Settings sheet, which slides over the rail while the terminal dims rather than
  resizes — plus a hidden window that captures audio.

Clicking in the Jarvis pane hands the cursor straight back to the terminal, so
your typing is never interrupted. That is also why anything you type into lives
in the Settings sheet instead. Closing the window does not quit Jarvis or end
your session: it hides to the tray, and the tray icon brings it back.

## Reading the project

Start at `.source/src/core/` — the rules, with no machine attached — then
`.source/src/main/` for the adapters that carry them out and
`.source/src/renderer/` for the windows. Comments through the code cite decision
records under `Docs/`, the working archive of how each choice was reached and
what it rejected. That folder is kept in the private repository and does not
travel with this public copy.

## Licence

The code is MIT — see `LICENSE`. Two things in the folder travel under someone
else's terms:

- `Brain/matt/` holds literal copies of Matt Pocock's skills, MIT, with the
  licence and the credit beside them in `Brain/matt/LICENSE` and
  `Brain/matt/CREDIT.md`.
- Two of the Brazilian voices, **Miro** and **Dii**, are TigreGotico's, published
  under CC BY-NC-ND 4.0. They are not in this repository — `npm run fetch-assets`
  downloads them to your machine — but the attribution travels with them, and a
  commercial Jarvis would have to drop them or license them.
