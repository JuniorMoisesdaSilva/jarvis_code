'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  onData: (handler) => ipcRenderer.on('terminal:data', (_event, chunk) => handler(chunk)),
  onReset: (handler) => ipcRenderer.on('terminal:reset', () => handler()),
  onTheme: (handler) => ipcRenderer.on('theme', (_event, name) => handler(name)),
  onFontSize: (handler) => ipcRenderer.on('terminal:font-size', (_event, size) => handler(size)),
  onDim: (handler) => ipcRenderer.on('terminal:dim', (_event, dimmed) => handler(dimmed)),
  ready: () => ipcRenderer.send('terminal:ready'),
  send: (data) => ipcRenderer.send('terminal:input', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
})
