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
//
// And because the sheet is the whole window now (ADR 0036), it is opened at
// 1366 by 768 — the smallest common laptop screen — and measured: every
// section has to be in view there without a column scrolling.

const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.join(__dirname, '..', '..', 'src')

/** Enough of the main process for the sheet to finish loading. */
const STORED = {
  theme: 'iron',
  language: 'pt-BR',
  shell: 'pwsh.exe',
  terminalFontSize: 13.5,
  deckFontSize: 12,
  spineFontSize: 9,
  commandFontSize: 12,
  skillFontSize: 12,
  commandColumns: 3,
  skillColumns: 3,
  speechRate: 0,
  model: 'medium',
  voices: {},
  panelPosition: 'right',
  // An order of the user's, not the default, and one button hidden.
  spineOrder: ['plan', 'gauge', 'commands', 'skills', 'events', 'agents', 'loops', 'readings', 'session'],
  spineHidden: ['loops'],
  deckPlan: true,
}

/** The preferences file as it stands: what is stored, with every write since. */
let onDisk = { ...STORED }
ipcMain.handle('preferences:read', () => onDisk)
/** Every patch the sheet asked to write, in order. */
const written = []
ipcMain.handle('preferences:write', (_event, patch) => {
  written.push(patch)
  onDisk = { ...onDisk, ...patch }
  return onDisk
})
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
    note: 'The one Jarvis listens with: best with accents, quiet speech and technical words.',
  },
}))

/** The seven built-ins and four skills: lists the sheet has to fit at 1366 by 768. */
const SHORTCUTS = [
  { id: '1', label: 'Claude', command: 'claude', submits: true, glyph: 'terminal-window' },
  { id: '2', label: 'Continue', command: 'claude -c', submits: true, glyph: 'play' },
  { id: '3', label: 'Resume', command: 'claude -r', submits: true, glyph: 'clock-counter-clockwise' },
  { id: '4', label: 'Update', command: 'claude update', submits: true, glyph: 'arrow-circle-up' },
  { id: '5', label: '/usage', command: '/usage', submits: true, glyph: 'gauge' },
  { id: '6', label: '/context', command: '/context', submits: true, glyph: 'stack' },
  { id: '7', label: 'Exit', command: 'exit', submits: true, glyph: 'sign-out' },
]
const SKILLS = [
  { id: 's1', label: 'tdd', command: '/tdd', submits: false, glyph: 'lightning' },
  { id: 's2', label: 'grill-me', command: '/grill-me', submits: false, glyph: null },
  { id: 's3', label: 'code-review', command: '/code-review', submits: false, glyph: 'eye' },
  { id: 's4', label: 'diagnose', command: '/diagnose', submits: false, glyph: 'bug' },
]
/** Every list the sheet stored, in order, by kind. */
const lists = { shortcuts: [], skills: [] }
ipcMain.handle('shortcuts:read', () => SHORTCUTS)
ipcMain.handle('skills:read', () => SKILLS)
ipcMain.handle('shortcuts:write', (_event, list) => {
  lists.shortcuts.push(list)
  return list
})
ipcMain.handle('skills:write', (_event, list) => {
  lists.skills.push(list)
  return list
})
ipcMain.handle('hooks:state', () => false)
/** The Panel actions the sheet asked for, in order. */
const acted = []
ipcMain.on('panel:action', (_event, name, argument) => acted.push([name, argument]))
/** How many times the sheet asked to be closed. */
let closes = 0
ipcMain.on('settings:close', () => (closes += 1))

const problems = []

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1366,
    height: 768,
    useContentSize: true,
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

  const run = (script) => window.webContents.executeJavaScript(script)
  const settled = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

  const seen = await run(`(() => ({
    bridge: typeof window.jarvis,
    theme: document.documentElement.getAttribute('data-theme'),
    shell: document.getElementById('shell')?.value ?? null,
    micLink: document.getElementById('mic-settings')?.textContent ?? null,
    voiceOptions: document.getElementById('voice-pt')?.options.length ?? 0,
    modelOptions: document.getElementById('model')?.children.length ?? 0,
    modelNote: document.getElementById('model-note')?.textContent ?? null,
    voiceNote: document.getElementById('voice-note-text')?.textContent ?? null,
    // The five sizes, each a number box with its range and its label.
    sizes: Object.fromEntries(['terminal-font', 'spine-font', 'deck-font', 'command-font', 'skill-font'].map((id) => {
      const box = document.getElementById(id)
      return [id, box && {
        type: box.type, value: box.value, min: box.min, max: box.max, step: box.step,
        label: document.querySelector('label[for="' + id + '"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
      }]
    })),
    // Everything in one view: the window, the columns, every section, and
    // whether a column has to scroll to show what it holds.
    view: (() => {
      const columns = [...document.querySelectorAll('.sheet-col')]
      return {
        width: innerWidth,
        height: innerHeight,
        columns: columns.map((column) => ({
          sections: [...column.querySelectorAll(':scope > section')].map((section) => section.querySelector('.label')?.textContent.trim()),
          tall: column.scrollHeight,
          high: column.clientHeight,
          wide: column.scrollWidth,
          room: column.clientWidth,
        })),
        cutOff: [...document.querySelectorAll('section')].filter((section) => {
          const box = section.getBoundingClientRect()
          return box.bottom > innerHeight + 0.5 || box.right > innerWidth + 0.5 || box.height === 0
        }).map((section) => section.querySelector('.label')?.textContent.trim()),
        spill: {
          x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        },
      }
    })(),
    themeOn: document.querySelector('#theme [aria-checked="true"]')?.dataset.value ?? null,
    languageOn: document.querySelector('#language [aria-checked="true"]')?.dataset.value ?? null,
    sideOn: document.querySelector('#sides [aria-checked="true"]')?.dataset.value ?? null,
    sides: [...document.querySelectorAll('#sides button')].map((button) => button.dataset.value),
    spineList: [...document.querySelectorAll('#spine-list [data-part]')].map((row) => ({
      part: row.dataset.part,
      shown: row.querySelector('input[type=checkbox]').checked,
    })),
    commandColumnsOn: document.querySelector('#command-columns [aria-checked="true"]')?.dataset.value ?? null,
    skillColumnsOn: document.querySelector('#skill-columns [aria-checked="true"]')?.dataset.value ?? null,
    commandRows: [...document.querySelectorAll('#shortcut-rows tr')].map((row) => ({
      id: row.dataset.id,
      name: row.querySelector('input.name').value,
      command: row.querySelector('input.command').value,
      glyph: row.querySelector('.iconpick').dataset.glyph,
      handle: row.querySelector('.handle')?.draggable ?? false,
      rowDraggable: row.draggable,
    })),
    skillRows: [...document.querySelectorAll('#skill-rows tr')].map((row) => row.dataset.id),
  }))()`)

  // Sizes: typed, applied as typed when in range, clamped on leaving the box.
  const type = (id, value, events) =>
    run(`(() => {
      const box = document.getElementById(${JSON.stringify(id)})
      box.focus()
      box.value = ${JSON.stringify(value)}
      for (const name of ${JSON.stringify(events)}) box.dispatchEvent(new Event(name, { bubbles: true }))
      return box.value
    })()`)
  // The Deck's typed a key at a time, 9 then 13: applied once the typing
  // pauses, as the one write of what the box ends up holding.
  await type('deck-font', '9', ['input'])
  const deckLive = await type('deck-font', '13', ['input'])
  seen.writtenWhileTyping = written.length
  await settled(700)
  seen.typed = {
    deckLive,
    commandHigh: await type('command-font', '40', ['input', 'change']),
    terminalOff: await type('terminal-font', '15.3', ['input', 'change']),
    spineWord: await type('spine-font', 'big', ['input', 'change']),
  }
  await settled()
  seen.sizeWrites = written.filter((patch) =>
    ['terminalFontSize', 'spineFontSize', 'deckFontSize', 'commandFontSize', 'skillFontSize'].some((key) => key in patch),
  )

  // Appearance, the side, the columns: each a click.
  const writesBefore = written.length
  await run(`(() => {
    document.querySelector('#theme [data-value="light"]').click()
    document.querySelector('#language [data-value="pt-BR"]').click()
    document.querySelector('#language [data-value="en-US"]').click()
    document.querySelector('#sides [data-value="left"]').click()
    document.querySelector('#command-columns [data-value="2"]').click()
    document.querySelector('#skill-columns [data-value="5"]').click()
  })()`)
  await settled()
  seen.clickedWrites = written.slice(writesBefore)
  seen.acted = [...acted]
  seen.afterClicks = await run(`({
    themeOn: document.querySelector('#theme [aria-checked="true"]')?.dataset.value,
    languageOn: document.querySelector('#language [aria-checked="true"]')?.dataset.value,
    sideOn: document.querySelector('#sides [aria-checked="true"]')?.dataset.value,
    commandColumnsOn: document.querySelector('#command-columns [aria-checked="true"]')?.dataset.value,
  })`)

  // The Spine's ticks: plan unticked, loops ticked again.
  const tickedBefore = written.length
  await run(`(() => {
    const tick = (part) => document.querySelector('#spine-list [data-part="' + part + '"] input[type=checkbox]').click()
    tick('plan')
  })()`)
  await settled()
  await run(`document.querySelector('#spine-list [data-part="loops"] input[type=checkbox]').click()`)
  await settled()
  seen.tickWrites = written.slice(tickedBefore)

  // A Command renamed in place, one added and half typed, then the icon picker.
  await run(`(() => {
    const name = document.querySelector('#shortcut-rows tr[data-id="2"] input.name')
    name.value = 'Carry on'
    name.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await settled()
  await run(`document.getElementById('add-shortcut').click()`)
  await settled()
  seen.added = await run(`(() => {
    const rows = [...document.querySelectorAll('#shortcut-rows tr')]
    const last = rows[rows.length - 1]
    const name = last.querySelector('input.name')
    const focused = document.activeElement === name
    name.value = 'Half typed'
    name.dispatchEvent(new Event('change', { bubbles: true }))
    return { rows: rows.length, focused }
  })()`)
  await settled()
  seen.added.rowsAfter = await run(`document.querySelectorAll('#shortcut-rows tr').length`)
  seen.picker = await run(`(() => {
    document.querySelector('#shortcut-rows tr[data-id="1"] .iconpick').click()
    const picker = document.getElementById('picker')
    const choices = [...picker.querySelectorAll('[data-glyph]')].map((button) => button.dataset.glyph)
    const box = picker.getBoundingClientRect()
    return {
      open: !picker.hidden,
      choices,
      inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    }
  })()`)
  await run(`document.querySelector('#picker [data-glyph="rocket"]').click()`)
  await settled()
  seen.picker.closedAfter = await run(`document.getElementById('picker').hidden`)
  seen.picker.shown = await run(`document.querySelector('#shortcut-rows tr[data-id="1"] .iconpick').dataset.glyph`)
  await run(`(() => {
    document.querySelector('#skill-rows tr[data-id="s1"] .iconpick').click()
    document.querySelector('#picker [data-glyph=""]').click()
  })()`)
  await settled()

  // A row dragged by its handle: Exit to the top of the Commands.
  seen.rowDrag = await run(`(() => {
    const row = (id) => document.querySelector('#shortcut-rows tr[data-id="' + id + '"]')
    const from = row('7').querySelector('.handle')
    const to = row('1')
    const dataTransfer = new DataTransfer()
    const box = to.getBoundingClientRect()
    const at = { clientX: box.left + 20, clientY: box.top + box.height * 0.25 }
    const fire = (node, type) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...at }))
    fire(from, 'dragstart')
    const accepted = !fire(to, 'dragover')
    const mark = [...to.classList].find((name) => name.startsWith('drop-')) ?? null
    fire(to, 'drop')
    fire(from, 'dragend')
    return { accepted, mark, left: document.querySelectorAll('#shortcut-rows .drop-before, #shortcut-rows .drop-after').length }
  })()`)
  await settled()
  seen.rowDrag.order = await run(`[...document.querySelectorAll('#shortcut-rows tr')].map((row) => row.dataset.id)`)
  seen.lists = lists

  // A right click in the Panel: the main process asks the sheet to open at a row.
  window.webContents.send('settings:edit', { list: 'skills', id: 's3' })
  await settled()
  seen.editing = await run(`(() => {
    const row = document.querySelector('#skill-rows tr[data-id="s3"]')
    return {
      focused: document.activeElement === row.querySelector('input.name'),
      marked: row.classList.contains('editing'),
    }
  })()`)

  // Rows edited in place while another is half done: s2's command cleared
  // (so it is no longer stored), then s3 renamed and s4 removed. Each edit
  // must land on the row it was made in.
  await run(`(() => {
    const command = document.querySelector('#skill-rows tr[data-id="s2"] input.command')
    command.value = ''
    command.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await settled()
  await run(`(() => {
    const name = document.querySelector('#skill-rows tr[data-id="s3"] input.name')
    name.value = 'review'
    name.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await settled()
  await run(`document.querySelector('#skill-rows tr[data-id="s4"] .remove').click()`)
  await settled()
  seen.inPlace = {
    rows: await run(`[...document.querySelectorAll('#skill-rows tr')].map((row) => [row.dataset.id, row.querySelector('input.name').value])`),
    stored: lists.skills.at(-1).map((each) => [each.id, each.label]),
  }

  // Another window hides Events while the sheet is open; then Agents is
  // unticked here. What is stored keeps both.
  onDisk = { ...onDisk, spineHidden: [...onDisk.spineHidden, 'events'] }
  const staleBefore = written.length
  await run(`document.querySelector('#spine-list [data-part="agents"] input[type=checkbox]').click()`)
  await settled()
  seen.staleTick = written.slice(staleBefore)

  // The picker, open, when a column scrolls and when the window is resized.
  const pickerAfter = async (move) => {
    await run(`document.querySelector('#shortcut-rows tr[data-id="3"] .iconpick').click()`)
    const opened = await run(`!document.getElementById('picker').hidden`)
    await run(move)
    await settled()
    return { opened, closed: await run(`document.getElementById('picker').hidden`) }
  }
  seen.pickerScrolled = await pickerAfter(`document.querySelectorAll('.sheet-col')[2].dispatchEvent(new Event('scroll'))`)
  seen.pickerResized = await pickerAfter(`window.dispatchEvent(new Event('resize'))`)

  // Escape with a size and then a cell half typed: each is kept before the sheet goes.
  window.webContents.focus()
  await run(`(() => { const box = document.getElementById('skill-font'); box.focus(); box.value = '' })()`)
  await window.webContents.insertText('14')
  await settled(50)
  const escapeBefore = written.length
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await settled()
  seen.escapedSize = { writes: written.slice(escapeBefore), closes }
  await run(`(() => { const name = document.querySelector('#skill-rows tr[data-id="s1"] input.name'); name.focus(); name.select() })()`)
  await window.webContents.insertText('tdd-loop')
  await settled(50)
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await settled()
  seen.escapedCell = { stored: lists.skills.at(-1).map((each) => each.label), closes }

  // The Claude Code line, drawn for each standing the main process can report.
  seen.connection = await run(`(() => {
    const read = (state) => {
      drawHooks(state)
      return {
        text: document.getElementById('hooks-text').textContent,
        connect: document.getElementById('install-hooks').textContent.trim(),
        connectEnabled: !document.getElementById('install-hooks').disabled,
        disconnectEnabled: !document.getElementById('remove-hooks').disabled,
      }
    }
    return {
      connected: read({ hooks: true, config: true }),
      stale: read({ hooks: false, config: true, stale: true }),
      elsewhere: read({ hooks: false, config: true, elsewhere: 'C:\\\\Other\\\\Jarvis' }),
      none: read({ hooks: false, config: false }),
    }
  })()`)

  // Smaller windows: the four columns become two, then one, the sheet then
  // scrolling as a page; no table is cut in any of them.
  const measureAt = async (width, height) => {
    window.setContentSize(width, height)
    await settled(400)
    return run(`(() => {
      const columns = [...document.querySelectorAll('.sheet-col')]
      const lefts = [...new Set(columns.map((column) => Math.round(column.getBoundingClientRect().left)))]
      const cut = []
      for (const table of document.querySelectorAll('.table')) {
        const room = table.parentElement.getBoundingClientRect()
        for (const cell of table.querySelectorAll('td, th')) {
          const at = cell.getBoundingClientRect()
          if (at.right > room.right + 0.5 || at.width < 4) cut.push(table.id || 'table')
        }
        for (const input of table.querySelectorAll('input.cell')) {
          if (input.getBoundingClientRect().width < 40) cut.push('narrow ' + input.className)
        }
      }
      for (const column of columns) if (column.scrollWidth > column.clientWidth + 0.5) cut.push('column wider than itself')
      const grid = document.querySelector('.sheet-grid')
      return {
        width: innerWidth,
        across: lefts.length,
        cut: [...new Set(cut)],
        spillX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pageScrolls: grid.scrollHeight > grid.clientHeight + 0.5,
      }
    })()`)
  }
  seen.at1366 = await measureAt(1366, 768)
  seen.at1024 = await measureAt(1024, 640)
  seen.at480 = await measureAt(480, 640)

  process.stdout.write(`${JSON.stringify({ ...seen, problems })}\n`)
  app.exit(0)
}).catch((error) => {
  // A step that threw is a sheet missing something it should have: said in
  // the report the tests read, rather than left as a process that never ends.
  process.stdout.write(`${JSON.stringify({ problems: [...problems, String(error?.stack ?? error)] })}\n`)
  app.exit(0)
})
