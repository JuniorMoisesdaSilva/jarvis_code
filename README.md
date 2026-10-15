# Jarvis

A voice assistant for Claude Code, on Windows. You speak instead of typing, hear
the answer instead of reading it, are told out loud when the agent stops to ask
for permission, and can watch what it is doing while it works — with everything
still saved as readable text.

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
  from `.source/`, from source.
- **Windows 11 on x64.** An Arm machine is out of reach: every compiled piece
  Jarvis depends on — the speech engine, the ONNX runtime, the terminal —
  publishes a `win32-x64` build and no `arm64` one. Jarvis no longer runs on a
  Mac.
- **A microphone**, and its permission.
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

- **`npm install`** — the dependencies.
- **`npm run fetch-assets`** — the seven voices Jarvis reads in — five Brazilian
  Portuguese and two American English — and the Whisper model it listens with,
  into `Resources/` at the root: about 2 GB, fetched once. Skip it and Jarvis
  still opens and still dictates — it downloads the listening model on first
  use — but it has no voice to read the answer in, because it offers only the
  voices it carries.
- **`npm start`** — fetches the Electron runtime into `Windows/electron/` the
  first time, then opens the app. The runtime is kept there rather than in
  `node_modules`, so reinstalling the dependencies never leaves the app without
  one.

`npm test` runs the suite. `npm run assemble` builds the app into `Windows/`;
running from source does not need it.

## The first run

Two things are yours to do, once:

1. **Connect Jarvis to Claude Code.** Open Settings and press Connect under
   "Claude Code". This installs the event hooks Jarvis listens through and
   applies Jarvis's behaviour — the spoken-summary output style, the status
   line, the model, the language Claude Code answers in, and the small plan
   tool that feeds the Deck — into your global Claude Code configuration,
   keeping a copy of the file first. Disconnect puts it all back the way it
   was. It never touches your login or your permissions. Without it, Jarvis
   never learns that an answer finished, that permission was asked for, or what
   the agent is doing.
2. **Allow the microphone.** Settings → Privacy & security → Microphone,
   including "Let desktop apps access your microphone".

The PT/EN switch in the panel decides all three at once: the engine that hears
you, the voice that reads to you, and the language Claude Code answers in. It
opens on PT, and Claude Code picks the change up when a session starts, so it
arrives with the next session rather than mid-answer.

Jarvis opens with nothing running. Choose a project folder with "New session…"
and it opens a shell there — PowerShell, unless you name another in Settings —
and the Claude button runs `claude` in it. Command buttons do press Enter, which
dictation never does: a command is one you wrote yourself and can read on the
button. Until a session exists there is nothing to dictate into, so the
microphone stays disabled and says why. Each session is a window of its own, and
several can run at once.

## What you see

- **The terminal**, where Claude Code runs as it always does.
- **The panel**, on whichever side of the window you put it — down a side as a
  rail, or along the top or bottom as a band. Its outer edge is the **Spine**, a
  column of buttons, one per part of the panel, each adding that part to the
  page or taking it away: the Deck's blocks, your Commands and Skills, the
  recent readings and the session card.
- **The Deck**, what Claude Code is doing right now, in five blocks you switch on
  as you like: **Context** (how full the context is, the plan limits, the model),
  **Events** (what happened, newest first), **Plan** (the steps of the work under
  way), **Agents** (each subagent at work, with its task, steps and a bar on a
  shared time line) and **Loops** (compactions and work no agent owns). While a
  block is on, its Spine button shows its live figure. The Deck only shows: it
  never speaks and never answers a permission.
- **Settings**, which covers the whole window while open, with the terminal
  running on behind it.

## The folder

This repository **is** Jarvis. The compartments you open — `Brain`, `Resources`,
`Windows`, `Start Here` — and two you never have to: `.source`, where the code
is edited, and `.jarvis-data`, where Jarvis keeps what it writes.

`Brain/` holds everything Jarvis carries into a machine's Claude Code, as plain
files you can read and change: the Maestro's instruction, the reply style, the
status line and the model and view it sets, `PLAN.js` — the one-tool server
Claude Code calls to show its plan in the Deck — and the Maestro's embedded
copies of the skills it reads. There is one copy of each and Jarvis reads it
from here, so the file you edit is the file Jarvis carries.

`Windows/` is assembled, never edited. The voices and the listening model live
once, in `Resources/` at the root.

The app finds all of this by walking up to the hidden `.jarvis-root` marker, so
it works the same run from source and run from a packaged app four levels down.

## How it fits together

- **The core** (`.source/src/core/`) holds every rule about how Jarvis behaves:
  an event goes in, effects come out. It knows nothing of terminals, microphones,
  voices or disks, which is what lets the whole behaviour be tested without them.
  The Deck is one reducer there over what Claude Code reports, and every block
  is a view of its state.
- **The adapters** (`.source/src/main/`) carry those effects out — the shell,
  Whisper, the voices, and the named pipe Claude Code's events arrive through.
- **The windows** (`.source/src/renderer/`) are one workspace window per session
  holding three views — the terminal, the panel and the Settings sheet — plus a
  hidden window that captures audio.

Clicking in the panel hands the cursor straight back to the terminal, so your
typing is never interrupted. That is also why anything you type into lives in
the Settings sheet instead. Closing the window does not quit Jarvis or end your
session: it hides to the tray, and the tray icon brings it back.

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
