'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  releaseFocus: () => ipcRenderer.send('panel:release-focus'),
  openSettings: () => ipcRenderer.send('panel:open-settings'),
  act: (name, argument) => ipcRenderer.send('panel:action', name, argument),
  onState: (handler) => ipcRenderer.on('state', (_event, state) => handler(state)),
  onSound: (handler) => ipcRenderer.on('sound:play', (_event, sound) => handler(sound)),
  onVoicePlay: (handler) => ipcRenderer.on('voice:play', (_event, wav) => handler(wav)),
  onVoiceStop: (handler) => ipcRenderer.on('voice:stop', () => handler()),
  onVoicePause: (handler) => ipcRenderer.on('voice:pause', () => handler()),
  onVoiceResume: (handler) => ipcRenderer.on('voice:resume', () => handler()),
  voiceAt: (where) => ipcRenderer.send('voice:at', where),
  voiceEnded: () => ipcRenderer.send('voice:ended'),
  readState: () => ipcRenderer.invoke('state:read'),
})
