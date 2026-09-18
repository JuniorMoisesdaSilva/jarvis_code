#!/bin/zsh
# Opens Jarvis on this Mac. Prefers the assembled app; falls back to running it
# straight from the source, which is what a machine building Jarvis does.
root="${0:A:h}/.."
if [[ -d "$root/macOS/Jarvis.app" ]]; then
  open "$root/macOS/Jarvis.app"
else
  cd "$root/.source" && npm start
fi
