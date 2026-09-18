@echo off
rem Opens Jarvis on this machine, straight from the source: there is no
rem assembled app on Windows any more. The runtime it starts with lives in
rem Windows\electron, and scripts\start.js fetches it on the first run.
cd /d "%~dp0..\.source"
node scripts\start.js
