'use strict'

// Opens the real Settings sheet in a real Electron window and reports what
// happened, as one line of JSON on standard output.
//
// It exists because the sheet can fail in a way no unit test sees: the preload
// runs sandboxed, and a sandboxed `require` reaches Electron's own modules and
// nothing else. A relative import there throws, the bridge is never built, and
// every call the page makes fails on `undefined` — so the sheet comes up with
// the wrong theme, no voices, and no button that does anything, with no error
// anywhere a test was looking.

const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.join(__dirname, '..', '..', 'src')

/** Enough of the main process for the sheet to finish loading. */
const STORED = {
  theme: 'iron',
  shell: '/bin/zsh',
  terminalFontSize: 13.5,
  speechRate: 0,
  model: 'medium',
  voices: {},
}

ipcMain.handle('preferences:read', () => STORED)
ipcMain.handle('preferences:write', (_event, patch) => ({ ...STORED, ...patch }))
ipcMain.handle('voices:read', () => [
  { name: 'jarvis:pt_BR-faber-medium', label: 'Faber', culture: 'pt-BR', natural: true },
  { name: 'jarvis:en_US-amy-medium', label: 'Amy', culture: 'en-US', natural: true },
])
// The one model travels in Resources, which is what the sheet has to say out
// loud: a model that is already here must not be described as a download.
ipcMain.handle('models:read', () => ({
  medium: {
    label: 'More accurate, slower',
    megabytes: 940,
    shipped: true,
    id: 'onnx-community/whisper-medium-ONNX',
  },
}))
ipcMain.handle('shortcuts:read', () => [])
ipcMain.handle('skills:read', () => [])
ipcMain.handle('hooks:state', () => false)

const problems = []

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) problems.push(String(event.message))
  })
  window.webContents.on('preload-error', (_event, file, error) => {
    problems.push(`preload ${path.basename(file)}: ${error.message}`)
  })

  await window.loadFile(path.join(ROOT, 'renderer', 'settings.html'))
  // The page loads its settings over IPC, so let those promises settle.
  await new Promise((resolve) => setTimeout(resolve, 700))

  const seen = await window.webContents.executeJavaScript(`(() => ({
    bridge: typeof window.jarvis,
    theme: document.documentElement.getAttribute('data-theme'),
    shell: document.getElementById('shell')?.value ?? null,
    micLink: document.getElementById('mic-settings')?.textContent ?? null,
    voiceOptions: document.getElementById('voice-pt')?.options.length ?? 0,
    modelOptions: document.getElementById('model')?.children.length ?? 0,
    modelNote: document.getElementById('model-note')?.textContent ?? null,
    voiceNote: document.getElementById('voice-note-text')?.textContent ?? null,
  }))()`)

  process.stdout.write(`${JSON.stringify({ ...seen, problems })}\n`)
  app.exit(0)
})
