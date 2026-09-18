'use strict'

// Opens the real terminal pane and the real panel, at the real sizes they are
// given, and reports what they measure — as one line of JSON on standard output.
//
// It exists because the two questions this effort has to answer cannot be
// answered by reading the stylesheet. Whether the shell is told about rows the
// pane can actually show is arithmetic over a font that is loaded at runtime;
// whether a footer of four controls fits 316 points is arithmetic over Inter's
// own metrics. `Docs/history/the-cut-off-terminal` was closed by measuring the
// real page, and this is the same method, kept.

const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.join(__dirname, '..', '..', 'src')

/** Enough of a Session for the panel to draw every part of itself. */
function aState(over = {}) {
  return {
    projectName: 'Jarvis',
    projectPath: process.platform === 'win32' ? 'C:\\Code\\Jarvis' : '/Code/Jarvis',
    shell: 'pwsh.exe',
    theme: 'dark',
    languageLabel: 'PT',
    hooksInstalled: true,
    hasLiveSession: true,
    autoRead: true,
    useMemory: false,
    lastAssistantText: 'An answer.',
    recentReadings: [],
    shortcuts: [
      { id: '1', label: 'Claude', command: 'claude', submits: true },
      { id: '2', label: 'Continue', command: 'claude -c', submits: true },
      { id: '3', label: 'Resume', command: 'claude -r', submits: true },
      { id: '4', label: 'Update', command: 'claude update', submits: true },
      { id: '5', label: '/usage', command: '/usage', submits: true },
      { id: '6', label: '/context', command: '/context', submits: true },
      { id: '7', label: 'Exit', command: 'exit', submits: true },
    ],
    skills: [
      { id: 's1', label: 'tdd', command: '/tdd', submits: false },
      { id: 's2', label: 'grill-me', command: '/grill-me', submits: false },
      { id: 's3', label: 'code-review', command: '/code-review', submits: false },
    ],
    panelPosition: 'right',
    panelCollapsed: false,
    ...over,
  }
}

let current = aState()
ipcMain.handle('state:read', () => current)

/**
 * What each terminal pane told the shell it could show.
 *
 * Kept per sender and not in one variable: every window opened here stays open,
 * so a pane measured earlier can still report and would otherwise answer for
 * the pane being measured now.
 */
const told = new Map()
ipcMain.on('terminal:resize', (event, size) => {
  told.set(event.sender.id, size)
})

const problems = []

function watch(window, name) {
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) problems.push(`${name}: ${event.message}`)
  })
  window.webContents.on('preload-error', (_event, file, error) => {
    problems.push(`${name} preload ${path.basename(file)}: ${error.message}`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    problems.push(`${name} load ${code} ${description} ${url}`)
  })
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Every window opened here stays open until the process ends.
 *
 * Destroying one and opening the next immediately makes the next `loadFile`
 * fail with a bare ERR_FAILED, which says nothing about why. They are hidden
 * and there are a dozen of them; holding them costs nothing.
 */
const kept = []

async function paneWindow({ preload, page, width, height, name }) {
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      preload: path.join(ROOT, 'preload', preload),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  watch(window, name)
  // The pane is a WebContentsView in the app, so what it gets is content size.
  // Set after construction rather than with `useContentSize`, which refuses the
  // load outright on Windows.
  window.setContentSize(width, height)
  await window.loadFile(path.join(ROOT, 'renderer', page))
  // The fonts arrive after the first paint, and everything measured here is
  // measured in them.
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await settle(500)
  kept.push(window)
  return window
}

/**
 * The terminal pane, at the height a maximised window gives it.
 *
 * What is checked is the one relation that matters: the rows the shell was told
 * about, drawn at the cell size the page actually has, fit inside the box the
 * page actually has — with the two reserved rows still to spare.
 */
async function measureTerminal(width, height, fontSize) {
  const window = await paneWindow({
    preload: 'terminal.js',
    page: 'terminal.html',
    width,
    height,
    name: `terminal ${fontSize ?? 'stored'}`,
  })

  // The text size is a setting from 9 to 24, and the two reserved rows have to
  // hold at both ends of it: the fault that closed `the-cut-off-terminal` was
  // two rows at the small size and one at the large. The pane is told the size
  // the same way Settings tells it, and given a frame to re-fit in.
  if (fontSize) {
    window.webContents.send('terminal:font-size', fontSize)
    // And then a nudge, because the pane re-fits a text-size change on the next
    // animation frame — and a window that is not on screen is not painting, so
    // that frame never comes. A pixel of resize goes through the pane's own
    // ResizeObserver instead, which is the path a real window takes when the
    // panel beside it is dragged.
    window.setContentSize(width - 1, height)
    await settle(250)
    window.setContentSize(width, height)
    await settle(400)
  }

  const seen = await window.webContents.executeJavaScript(`(() => {
    const frame = document.querySelector('.term-frame')
    const style = getComputedStyle(frame)
    const screen = document.querySelector('.xterm-screen')
    const pad = {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
    }
    return {
      header: Boolean(document.querySelector('.term-head')),
      pad,
      inner: {
        width: frame.clientWidth - pad.left - pad.right,
        height: frame.clientHeight - pad.top - pad.bottom,
      },
      drawn: { width: screen ? screen.clientWidth : 0, height: screen ? screen.clientHeight : 0 },
    }
  })()`)

  return {
    ...seen,
    told: told.get(window.webContents.id) ?? null,
    fontSize: fontSize ?? 13.5,
    window: { width, height },
  }
}

/**
 * The panel, at one position and one size.
 *
 * Overflow is the thing being looked for. A .seg hides what it cannot fit, so a
 * footer one pixel over the room it has does not look broken — it looks like a
 * control with a letter missing, which is worse.
 */
async function measurePanel({ width, height, position, collapsed = false }) {
  current = aState({ panelPosition: position, panelCollapsed: collapsed })
  const window = await paneWindow({
    preload: 'panel.js',
    page: 'panel.html',
    width,
    height,
    name: `panel ${position}${collapsed ? ' shut' : ''}`,
  })

  const seen = await window.webContents.executeJavaScript(`(() => {
    const over = (node) => node
      ? { need: node.scrollWidth, room: node.clientWidth, tall: node.scrollHeight, high: node.clientHeight }
      : null
    const rect = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { w: Math.round(box.width), h: Math.round(box.height) }
    }
    const body = document.body
    return {
      axis: body.dataset.axis,
      position: body.dataset.position,
      collapsed: body.dataset.collapsed,
      edit: body.dataset.edit,
      mover: document.getElementById('move-panel').firstElementChild.className,
      foot: over(document.querySelector('.foot')),
      footBox: rect(document.querySelector('.foot')),
      // How tall the footer's contents actually are, top edge to bottom edge.
      // Counting distinct top edges would count a taller control beside a
      // shorter one as a second line, which is what centring them does.
      footKids: [...document.querySelector('.foot').children].map((kid) => ({
        id: kid.id || kid.className.split(' ')[0],
        w: Math.round(kid.getBoundingClientRect().width),
        top: Math.round(kid.getBoundingClientRect().top),
      })),
      footSpan: (() => {
        const kids = [...document.querySelector('.foot').children].map((kid) =>
          kid.getBoundingClientRect(),
        )
        if (kids.length === 0) return 0
        const top = Math.min(...kids.map((box) => box.top))
        const bottom = Math.max(...kids.map((box) => box.bottom))
        return Math.round(bottom - top)
      })(),
      strip: over(document.querySelector('.strip')),
      panelBox: rect(document.getElementById('panel')),
      barBox: rect(document.getElementById('bar')),
      barRoom: over(document.getElementById('bar')),
      headBox: rect(document.getElementById('head')),
      // Which of its two homes the Session pair is in: the band's first column
      // or the scrolling page.
      sessionIn: document.getElementById('session-section').parentElement.id,
      bodyBox: rect(document.getElementById('body')),
      bodyRoom: over(document.getElementById('body')),
      dockBox: rect(document.querySelector('.dock-band')),
      editBox: rect(document.getElementById('dock-edit')),
      editWords: [...document.querySelectorAll('.edit-word')]
        .filter((word) => getComputedStyle(word).display !== 'none').length,
      sessionShown: getComputedStyle(document.getElementById('session-section')).display !== 'none',
      commandsBox: rect(document.getElementById('shortcuts')),
      // The shut bar cannot be measured at 52 points in a window of its own:
      // Windows will not make a window that narrow. What it needs is measured
      // instead — the widest button, and the whole stack of them.
      barNeeds: (() => {
        const bar = document.getElementById('bar')
        const style = getComputedStyle(bar)
        const pad = {
          x: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
          y: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        }
        const kids = [...bar.children]
        const gaps = parseFloat(style.gap) * Math.max(0, kids.length - 1)
        const widest = Math.max(0, ...kids.map((kid) => kid.getBoundingClientRect().width))
        const tallest = kids.reduce((sum, kid) => sum + kid.getBoundingClientRect().height, 0)
        return { across: widest + pad.x, along: tallest + gaps + pad.y, buttons: kids.length }
      })(),
      // Nothing in the page may spill past the pane it is drawn in.
      spill: {
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      },
    }
  })()`)

  return seen
}

/**
 * `--sweep` walks a range of band widths and reports what each one does.
 *
 * It is how the two numbers in panel.js are derived rather than guessed: the
 * width the Session block leaves at, and the width below which the row of
 * buttons starts to scroll. Run it again whenever the type or the spacing
 * changes, because both move every one of these numbers.
 */
async function sweep() {
  const rows = []
  const [from, to, step] = (process.env.JARVIS_SWEEP ?? '900,1400,20').split(',').map(Number)
  for (let width = from; width <= to; width += step) {
    const seen = await measurePanel({ width, height: 148, position: 'bottom' })
    rows.push({
      width,
      session: seen.sessionShown,
      short: seen.bodyRoom.need - seen.bodyRoom.room,
      dock: seen.dockBox.w,
      footSpan: seen.footSpan,
      footNeeds: seen.footKids.map((kid) => kid.w),
    })
  }
  return rows
}

app.whenReady().then(async () => {
  if (process.argv.includes('--sweep')) {
    process.stdout.write(`${JSON.stringify(await sweep())}
`)
    app.exit(0)
    return
  }

  const report = { problems }

  // The pane a maximised window gives the terminal, and the one a default
  // window gives it, with the panel at its narrowest.
  report.terminalTall = await measureTerminal(1240 - 316 - 5, 1009)
  // A band leaves it the full width and a good deal less height.
  report.terminalBand = await measureTerminal(1240, 780 - 148 - 5)
  // Both ends of the text size, where the rows a pane can show differ most.
  report.terminalSmall = await measureTerminal(1240 - 316 - 5, 1009, 9)
  report.terminalLarge = await measureTerminal(1240 - 316 - 5, 1009, 24)

  report.right = await measurePanel({ width: 316, height: 780, position: 'right' })
  report.left = await measurePanel({ width: 316, height: 780, position: 'left' })
  report.wide = await measurePanel({ width: 520, height: 780, position: 'right' })
  report.bottom = await measurePanel({ width: 1240, height: 148, position: 'bottom' })
  report.top = await measurePanel({ width: 1240, height: 148, position: 'top' })
  // The width at which the dock reaches its own floor, and one well below it.
  report.bandFloor = await measurePanel({ width: 1000, height: 148, position: 'bottom' })
  report.bandTight = await measurePanel({ width: 924, height: 148, position: 'bottom' })
  // 140 rather than 52: Windows refuses a window narrower than about 120, so
  // what is asked of this one is what the bar needs, not what it was given.
  report.shutSide = await measurePanel({ width: 140, height: 780, position: 'right', collapsed: true })
  report.shutBand = await measurePanel({ width: 1240, height: 52, position: 'top', collapsed: true })
  // The shortest window the app allows. The column asks for more than this,
  // which is the case the scrolling is there for.
  report.shutShort = await measurePanel({ width: 140, height: 420, position: 'right', collapsed: true })

  process.stdout.write(`${JSON.stringify(report)}\n`)
  app.exit(0)
})
