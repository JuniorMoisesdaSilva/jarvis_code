# Start Here

This is Jarvis for Windows. It is one folder, and it works from wherever it is
copied.

## Install it once

Jarvis runs from its own source, so the folder has to be installed before either
the launcher below does anything. From a terminal, in this folder:

```
cd .source
npm install
npm run fetch-assets
```

The `README.md` at the root says what each step fetches and what the machine has
to have first — Claude Code signed in, Node.js 22.12 or newer, and Windows 11 on
x64.

## Then open it

**Jarvis (Windows).cmd** runs the app from `.source`, fetching the Electron
runtime into `Windows\electron\` the first time. A console window stays open
behind Jarvis, and closing that console closes Jarvis with it. To be rid of it,
make a Windows shortcut to `Windows\electron\electron.exe` with the `.source`
folder as its argument, and give it one of the icons in
`.source\assets\icons\`. A shortcut like that is not committed: the paths inside
it belong to the machine that made it, so it has to be made again wherever the
folder lands.

## The first time

Jarvis asks for the microphone the first time you speak to it. The switch is
system-wide, under Settings → Privacy → Microphone.

Then open the Settings sheet and press **Connect**. That is the one act that
plugs Jarvis into this machine's Claude Code — the event hooks and the carried
personality together. **Disconnect** puts the machine back exactly as it was.

## Where everything is

- `Brain/` — how Jarvis behaves, in plain files you can change: how it talks
  back to you, how it runs a piece of work from request to delivery, what it
  draws at the bottom of the Claude Code screen, and `PLAN.js`, the small tool
  Claude Code uses to show its plan in the Deck.
- `Resources/` — the voices and the listening model.
- `Windows/` — the Electron runtime, and the assembled app if one has been
  built there.
