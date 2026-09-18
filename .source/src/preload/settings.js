'use strict'

// A preload runs sandboxed, and a sandboxed `require` reaches Electron's own
// modules and nothing else — a relative path to the core throws, the bridge is
// never built, and the sheet it belongs to comes up dead with no error in sight.
// So the three facts below are read from `process`, which the sandbox does
// provide, rather than worked out by the code that normally decides them.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  /** Which system the sheet is describing, so its links name the right place. */
  platform: process.platform,
  /** Whether this machine has voices of its own that Jarvis can reach. */
  close: () => ipcRenderer.send('settings:close'),
  readPreferences: () => ipcRenderer.invoke('preferences:read'),
  writePreferences: (patch) => ipcRenderer.invoke('preferences:write', patch),
  readVoices: () => ipcRenderer.invoke('voices:read'),
  readModels: () => ipcRenderer.invoke('models:read'),
  readShortcuts: () => ipcRenderer.invoke('shortcuts:read'),
  writeShortcuts: (list) => ipcRenderer.invoke('shortcuts:write', list),
  readSkills: () => ipcRenderer.invoke('skills:read'),
  writeSkills: (list) => ipcRenderer.invoke('skills:write', list),
  hooksState: () => ipcRenderer.invoke('hooks:state'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  removeHooks: () => ipcRenderer.invoke('hooks:remove'),
  act: (name, argument) => ipcRenderer.send('panel:action', name, argument),
  onTheme: (handler) => ipcRenderer.on('theme', (_event, name) => handler(name)),
})
