'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  onData: (handler) => ipcRenderer.on('terminal:data', (_event, chunk) => handler(chunk)),
  onReset: (handler) => ipcRenderer.on('terminal:reset', () => handler()),
  onTheme: (handler) => ipcRenderer.on('theme', (_event, name) => handler(name)),
  onFontSize: (handler) => ipcRenderer.on('terminal:font-size', (_event, size) => handler(size)),
  onPaste: (handler) => ipcRenderer.on('terminal:paste-text', (_event, text) => handler(text)),
  ready: () => ipcRenderer.send('terminal:ready'),
  send: (data) => ipcRenderer.send('terminal:input', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
  copy: (text) => ipcRenderer.send('terminal:copy', text),
  paste: (text, bracketed) => ipcRenderer.send('terminal:paste', { text, bracketed }),
})
