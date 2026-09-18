'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  ready: () => ipcRenderer.send('microphone:ready'),
  onStart: (handler) => ipcRenderer.on('microphone:start', () => handler()),
  onStop: (handler) => ipcRenderer.on('microphone:stop', () => handler()),
  audio: (buffer) => ipcRenderer.send('microphone:audio', buffer),
  started: (sampleRate) => ipcRenderer.send('microphone:started', sampleRate),
  denied: (reason) => ipcRenderer.send('microphone:denied', reason),
})
