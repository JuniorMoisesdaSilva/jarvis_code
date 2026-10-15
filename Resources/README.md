# Resources

The models Jarvis speaks and listens with, read by the app from this one copy.

- `voices/` — the seven Piper voices Jarvis ships (five Brazilian Portuguese,
  two American English) and `espeak-ng-data`, which they cannot run without.
- `models/` — the Whisper model Jarvis listens with.

Roughly 2 GB, so none of it is in Git. To fetch it on a machine that has none:

    cd .source && npm run fetch-assets

Nothing here is per-machine, and nothing here should be duplicated into
`Windows/`.
