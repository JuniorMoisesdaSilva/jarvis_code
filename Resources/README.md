# Resources

The models Jarvis speaks and listens with. Both platforms read this one copy —
it is the reason the folder holds two apps and one set of weights.

- `voices/` — the five Piper voices Jarvis ships (three Brazilian Portuguese,
  two American English) and `espeak-ng-data`, which they cannot run without.
- `models/` — the Whisper model Jarvis listens with.

Roughly 2 GB, so none of it is in Git. To fetch it on a machine that has none:

    cd .source && npm run fetch-assets

The files are identical on Windows and macOS, byte for byte. Nothing here is
per-platform, and nothing here should be duplicated into `Windows/` or `macOS/`.
