# Windows

The Windows app and its runtime. Two different things can be here:

- `Jarvis.exe` and its pieces, assembled from `.source/` by `npm run assemble`.
  Only there once that has been run: Jarvis works run from the source as well.
- `electron/` — the Electron runtime `npm start` opens the app with, fetched by
  `npm run runtime`. It is kept here rather than in `node_modules`, so
  reinstalling the dependencies never leaves the app without a runtime.

x64 only. Every compiled piece Jarvis depends on — the speech engine, the ONNX
runtime, the terminal — publishes a `win32-x64` build and no `arm64` one, so an
Arm machine is out of reach without replacing them.

In an assembled app the dependencies sit beside the archive, in
`resources/app.asar.unpacked/`, rather than inside it. A `.node` file loads from
an archive but the `.dll` files next to it do not, and the pieces Jarvis starts
from a path — the speech host, the Whisper worker, the hook relay — resolve their
imports from disk and nowhere else.

Assembled, not edited. `.source/` is the only place to change the app, and only
a Windows machine can assemble this folder: the compiled pieces are installed for
the machine npm runs on. Assembling empties this folder first, but leaves
`electron/` and this README where they are.

Nothing here carries the voices or the listening model. They live once, in
`Resources/` at the root, and the running app walks up to find them.
