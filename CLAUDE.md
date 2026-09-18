# Jarvis

A voice assistant for Claude Code sessions on Windows and macOS, built with
Electron.

Read `README.md` for the product and the shape of the code. Comments through the
code cite decision records under `Docs/` — the working archive of how each choice
was reached. That folder is kept in the private repository and does not travel
with this public copy.

## Where everything is

This repository **is** the Jarvis folder. The compartments the user opens, and
two hidden ones they do not:

- `Brain/` — everything Jarvis carries into a machine's Claude Code, as plain
  files: `MAESTRO.md` (how it works), `BEHAVIOUR.md` (how it talks), `LAYOUT.js`
  and `LAYOUT.json` (what it draws, and the model and language it sets), and
  `matt/`. **The only copy.** Jarvis reads them from here, so editing one of
  these is editing what travels. They are placed on a host under the names
  Claude Code looks for, which are not these.
- `Resources/` — the voices and the listening model, one copy read by both
  platforms. Not in Git; fetched with `npm run fetch-assets`.
- `Windows/`, `macOS/` — the assembled app for each. Not in Git, and each can
  only be assembled on its own platform: `npm run assemble` builds for whichever
  machine it runs on.
- `Start Here/` — what a person opening the folder reads, and the two launchers.
- `.source/` — **the code, and the only place to edit it.** `npm start`,
  `npm test` and every script are run from here.
- `.jarvis-data/` — preferences and any downloaded model. Written, never edited.

The app finds all of this by walking up to the `.jarvis-root` marker; the
decision lives in `.source/src/core/folder.js`.
