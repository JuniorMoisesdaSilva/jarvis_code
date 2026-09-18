# Start Here

Jarvis is one folder. Open it on a Windows machine or a Mac and the same
assistant is waiting, reading the same voices and the same listening model.

## Install it once

Jarvis runs from its own source, so the folder has to be installed before either
launcher below does anything. From a terminal, in this folder:

```
cd .source
npm install
npm run fetch-assets
```

The `README.md` at the root says what each step fetches and what the machine has
to have first — Claude Code signed in, Node.js 22.12 or newer, and Windows 11 on
x64 or a Mac on Apple Silicon.

## Then open it

Two launchers sit beside this file. Use the one for the machine you are on.

**Jarvis (Windows).cmd** runs the app from `.source`, fetching the Electron
runtime into `Windows\electron\` the first time. A console window stays open
behind Jarvis, and closing that console closes Jarvis with it. To be rid of it,
make a Windows shortcut to `Windows\electron\electron.exe` with the `.source`
folder as its argument, and give it one of the icons in
`.source\assets\icons\`. A shortcut like that is not committed: the paths inside
it belong to the machine that made it, so it has to be made again wherever the
folder lands.

**Jarvis (macOS).command** opens `macOS/Jarvis.app` if it has been assembled with
`npm run assemble`, and otherwise runs the app straight from the source.

## The first time

Jarvis asks for the microphone the first time you speak to it. On macOS, allow it
when the box appears; if you miss it, it is under System Settings → Privacy &
Security → Microphone. On Windows the switch is system-wide, under Settings →
Privacy → Microphone.

Then open the Settings sheet and press **Connect**. That is the one act that
plugs Jarvis into this machine's Claude Code — the event hooks and the carried
personality together. **Disconnect** puts the machine back exactly as it was.

## Where everything is

- `Brain/` — how Jarvis behaves, in plain files you can change: how it talks
  back to you, how it runs a piece of work from request to delivery, and what it
  draws at the bottom of the Claude Code screen.
- `Resources/` — the voices and the listening model, shared by both platforms.
- `Windows/`, `macOS/` — the Electron runtime for each, and the assembled app if
  one has been built there.
