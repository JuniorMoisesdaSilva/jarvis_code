# macOS

Everything needed to run Jarvis on macOS: `Jarvis.app`, built from `.source/`.

Apple Silicon only. Every compiled piece Jarvis depends on — the speech engine,
the ONNX runtime, the terminal — publishes an `arm64` build for macOS and no
`x64` one, so an Intel Mac is out of reach without replacing them.

The app is packaged rather than run from a stock Electron so that macOS knows it
as Jarvis: its own name and icon in the Dock, and a microphone permission granted
to Jarvis rather than shared with every other Electron app on the machine.

`electron/` appears here too when the Mac runs Jarvis from the source: it is that
platform's Electron runtime, fetched by `npm run runtime`. It is kept per
platform because `node_modules` is one tree shared with the Windows machine and
Electron unpacks into a single folder inside it, so the tree can hold only one
platform's runtime. Assembling empties this folder but leaves `electron/` and
this README alone.
