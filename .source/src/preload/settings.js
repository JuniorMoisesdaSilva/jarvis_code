'use strict'

// A preload runs sandboxed, and a sandboxed `require` reaches Electron's own
// modules and nothing else — a relative path to the core throws, the bridge is
// never built, and the sheet it belongs to comes up dead with no error in sight.
// So nothing here reaches past Electron: every fact the sheet needs is asked of
// the main process.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
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
  onShown: (handler) => ipcRenderer.on('settings:shown', (_event, shape) => handler(shape)),
  onEdit: (handler) => ipcRenderer.on('settings:edit', (_event, row) => handler(row)),
})
