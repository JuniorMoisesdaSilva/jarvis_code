# Windows

This platform's half of Jarvis. Two different things can be here:

- `Jarvis.exe` and its pieces, assembled from `.source/` by `npm run assemble`.
  Only there once that has been run: Jarvis works run from the source as well.
- `electron/` — the Electron runtime `npm start` opens the app with, fetched by
  `npm run runtime` and kept per platform on purpose. `node_modules` is one tree
  shared by the Windows machine and the Mac, and Electron unpacks into a single
  folder inside it, so the tree can only ever hold one platform's runtime. Here
  each platform has its own and neither overwrites the other.

x64 only. Every compiled piece Jarvis depends on — the speech engine, the ONNX
runtime, the terminal — publishes a `win32-x64` build and no `arm64` one, so an
Arm machine is out of reach without replacing them.

In an assembled app the dependencies sit beside the archive, in
`resources/app.asar.unpacked/`, rather than inside it. A `.node` file loads from
an archive but the `.dll` files next to it do not, and the pieces Jarvis starts
from a path — the speech host, the Whisper worker, the hook relay — resolve their
imports from disk and nowhere else.

Assembled, not edited. `.source/` is the only place to change the app, and only
a Windows machine can assemble this folder: a Mac refuses to install the Windows
binaries, and assembling there would produce macOS ones. Assembling empties this
folder first, but leaves `electron/` and this README where they are.

Nothing here carries the voices or the listening model. They live once, in
`Resources/` at the root, and the running app walks up to find them.
