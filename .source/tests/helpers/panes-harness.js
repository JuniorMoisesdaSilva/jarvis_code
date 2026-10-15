'use strict'

// Opens the real terminal pane and the real panel, at the real sizes they are
// given, and reports what they measure — as one line of JSON on standard output.
//
// It exists because the two questions this effort has to answer cannot be
// answered by reading the stylesheet. Whether the shell is told about rows the
// pane can actually show is arithmetic over a font that is loaded at runtime;
// whether the Spine and three columns of Commands fit 316 points is arithmetic
// over the type's own metrics. `Docs/history/the-cut-off-terminal` was closed by measuring the
// real page, and this is the same method, kept.

const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.join(__dirname, '..', '..', 'src')

/** Enough of a Session for the panel to draw every part of itself. */
function aState(over = {}) {
  return {
    projectName: 'Jarvis',
    projectPath: 'C:\\Jarvis',
    shell: 'pwsh.exe',
    theme: 'dark',
    languageLabel: 'PT',
    hooksInstalled: true,
    hasLiveSession: true,
    autoRead: true,
    lastAssistantText: 'An answer.',
    recentReadings: [],
    shortcuts: [
      // The built-ins, with the icons they ship with.
      { id: '1', label: 'Claude', command: 'claude', submits: true, glyph: 'terminal-window' },
      { id: '2', label: 'Continue', command: 'claude -c', submits: true, glyph: 'play' },
      { id: '3', label: 'Resume', command: 'claude -r', submits: true, glyph: 'clock-counter-clockwise' },
      { id: '4', label: 'Update', command: 'claude update', submits: true, glyph: 'arrow-circle-up' },
      { id: '5', label: '/usage', command: '/usage', submits: true, glyph: 'gauge' },
      { id: '6', label: '/context', command: '/context', submits: true, glyph: 'stack' },
      { id: '7', label: 'Exit', command: 'exit', submits: true, glyph: 'sign-out' },
    ],
    skills: [
      { id: 's1', label: 'tdd', command: '/tdd', submits: false, glyph: 'lightning' },
      { id: 's2', label: 'grill-me', command: '/grill-me', submits: false, glyph: null },
      { id: 's3', label: 'code-review', command: '/code-review', submits: false, glyph: 'eye' },
    ],
    panelPosition: 'right',
    panelCollapsed: false,
    // The Spine as the app model publishes it: the sections on, the Deck's
    // share in `deckBlocks`, the default order, nothing hidden.
    parts: { commands: true, skills: true, readings: true, session: true },
    deckBlocks: { gauge: false, events: false, plan: false, agents: false, loops: false },
    spineOrder: ['gauge', 'events', 'plan', 'agents', 'loops', 'commands', 'skills', 'readings', 'session'],
    spineHidden: [],
    ...over,
  }
}

let current = aState()
ipcMain.handle('state:read', () => current)

/**
 * The state each panel was last sent, and what it asked for.
 *
 * `setPart` and `setSpineOrder` are answered the way the app model answers
 * them — the Part's switch flipped, or the order taken, and the whole state
 * sent back — so a click or a drop on the Spine goes the whole way round:
 * button, action, state, page.
 */
const shown = new Map()
const asked = new Map()
ipcMain.on('panel:action', (event, name, argument) => {
  const id = event.sender.id
  asked.set(id, [...(asked.get(id) ?? []), [name, argument]])
  const state = shown.get(id) ?? current
  // A drop among the Commands or the Skills: the list put in the order sent.
  const lists = { setShortcutOrder: 'shortcuts', setSkillOrder: 'skills' }
  if (name in lists) {
    const list = state[lists[name]]
    const next = { ...state, [lists[name]]: argument.map((id) => list.find((each) => each.id === id)) }
    shown.set(id, next)
    event.sender.send('state', next)
    return
  }
  if (name === 'setSpineOrder') {
    const next = { ...state, spineOrder: argument }
    shown.set(id, next)
    event.sender.send('state', next)
    return
  }
  if (name !== 'setPart') return
  const deck = argument.part in state.deckBlocks
  const next = deck
    ? { ...state, deckBlocks: { ...state.deckBlocks, [argument.part]: argument.on } }
    : { ...state, parts: { ...state.parts, [argument.part]: argument.on } }
  shown.set(id, next)
  event.sender.send('state', next)
})

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

/** What each terminal pane sent as a paste, and as typing, per sender. */
const pastes = new Map()
const typing = new Map()
const note = (map) => (event, value) => {
  map.set(event.sender.id, [...(map.get(event.sender.id) ?? []), value])
}
ipcMain.on('terminal:paste', note(pastes))
ipcMain.on('terminal:input', note(typing))

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
 * A paste into the real pane, before and after the program asks for bracketed
 * paste.
 *
 * Synthetic, dispatched on xterm's own textarea where every real paste lands,
 * so the user's clipboard is never touched. What is checked is that the pane's
 * handler takes it ahead of xterm — one paste sent, nothing typed — and that it
 * says what xterm read of the mode — and that the panel's Paste button, which
 * reads the clipboard in main, comes back through the same handler.
 */
async function pasteIntoTerminal() {
  const window = await paneWindow({
    preload: 'terminal.js',
    page: 'terminal.html',
    width: 900,
    height: 600,
    name: 'terminal paste',
  })
  const paste = (text) =>
    window.webContents.executeJavaScript(`(() => {
      const data = new DataTransfer()
      data.setData('text/plain', ${JSON.stringify(text)})
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      document.querySelector('.xterm-helper-textarea').dispatchEvent(event)
      return event.defaultPrevented
    })()`)

  const prevented = []
  prevented.push(await paste('a\nb'))
  window.webContents.send('terminal:data', '\u001b[?2004h')
  await settle(150)
  prevented.push(await paste('c\td'))
  prevented.push(await paste(''))
  // The panel's Paste button: main read the clipboard and hands it over.
  window.webContents.send('terminal:paste-text', 'e\nf')
  await settle(150)

  const id = window.webContents.id
  return { prevented, pastes: pastes.get(id) ?? [], typing: typing.get(id) ?? [] }
}

/**
 * The panel, at one position and one size.
 *
 * Overflow is the thing being looked for. A .seg hides what it cannot fit, so a
 * footer one pixel over the room it has does not look broken — it looks like a
 * control with a letter missing, which is worse.
 */
async function measurePanel({ width, height, position, collapsed = false, over = {}, clicks = [], openAll = false, spineClicks = [], spineDrags = [], buttonDrags = [], presses = [] }) {
  current = aState({ panelPosition: position, panelCollapsed: collapsed, ...over })
  const window = await paneWindow({
    preload: 'panel.js',
    page: 'panel.html',
    width,
    height,
    name: `panel ${position}${collapsed ? ' shut' : ''}`,
  })
  shown.set(window.webContents.id, current)

  // Buttons on the Spine pressed in turn, as a person would, each answered
  // before the next.
  for (const part of spineClicks) {
    await window.webContents.executeJavaScript(`document.querySelector('#spine [data-part="${part}"]').click()`)
    await settle(150)
  }

  // Buttons pressed in turn by id, as a person would.
  for (const id of presses) {
    await window.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`)
    await settle(150)
  }

  // Buttons on the Spine dragged onto others, as a person would: picked up,
  // held over the target's first or second half, dropped. What the target
  // showed while it was held over is kept, since it is gone once the drop lands.
  const dropMarks = []
  for (const { part, onto, after } of spineDrags) {
    dropMarks.push(
      await window.webContents.executeJavaScript(`(() => {
        const button = (id) => document.querySelector('#spine [data-part="' + id + '"]')
        const from = button(${JSON.stringify(part)})
        const to = button(${JSON.stringify(onto)})
        const dataTransfer = new DataTransfer()
        const box = to.getBoundingClientRect()
        const at = {
          clientX: box.left + box.width * (${after} ? 0.75 : 0.25),
          clientY: box.top + box.height * (${after} ? 0.75 : 0.25),
        }
        const fire = (node, type) =>
          node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...at }))
        fire(from, 'dragstart')
        fire(to, 'dragenter')
        const accepted = !fire(to, 'dragover')
        const line = getComputedStyle(to, '::after')
        const seen = {
          over: to.dataset.part,
          accepted,
          mark: [...to.classList].find((name) => name.startsWith('drop-')) ?? null,
          line: line.content === 'none' ? null : { w: parseFloat(line.width), h: parseFloat(line.height) },
          lifted: from.classList.contains('dragging'),
        }
        fire(to, 'drop')
        fire(from, 'dragend')
        seen.left = document.querySelectorAll('#spine .drop-before, #spine .drop-after, #spine .dragging').length
        return seen
      })()`),
    )
    await settle(150)
  }

  // Command and Skill buttons dragged onto others, the same way, by their list
  // and their ids; and then one Command clicked, which must still press it.
  // Held over the target's left or right half at its middle height — or at
  // `at`, fractions of its width and height, for a grid that flows otherwise.
  for (const { list, id, onto, after, at: where } of buttonDrags) {
    const spot = where ?? { x: after ? 0.75 : 0.25, y: 0.5 }
    dropMarks.push(
      await window.webContents.executeJavaScript(`(() => {
        const button = (id) => document.querySelector('#${list} [data-id="' + id + '"]')
        const from = button(${JSON.stringify(id)})
        const to = button(${JSON.stringify(onto)})
        const dataTransfer = new DataTransfer()
        const box = to.getBoundingClientRect()
        const at = { clientX: box.left + box.width * ${spot.x}, clientY: box.top + box.height * ${spot.y} }
        const fire = (node, type) =>
          node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...at }))
        fire(from, 'dragstart')
        fire(to, 'dragenter')
        const accepted = !fire(to, 'dragover')
        const line = getComputedStyle(to, '::after')
        const seen = {
          over: to.dataset.id,
          accepted,
          mark: [...to.classList].find((name) => name.startsWith('drop-')) ?? null,
          line: line.content === 'none' ? null : { w: parseFloat(line.width), h: parseFloat(line.height) },
          lifted: from.classList.contains('dragging'),
        }
        fire(to, 'drop')
        fire(from, 'dragend')
        seen.left = document.querySelectorAll('.commands .drop-before, .commands .drop-after, .commands .dragging').length
        return seen
      })()`),
    )
    await settle(150)
  }
  if (buttonDrags.length > 0) {
    await window.webContents.executeJavaScript(`document.querySelector('#shortcuts .btn').click()`)
    // A right click on a Command and on a Skill: each asks for Settings at its row.
    await window.webContents.executeJavaScript(`(() => {
      const press = (node) => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      press(document.querySelector('#shortcuts .btn[data-id="3"]'))
      press(document.querySelector('#skills .btn[data-id="s3"]'))
    })()`)
    await settle(150)
  }

  // A click on a Deck line opens or closes its detail, as a person's would;
  // `openAll` opens every line still closed, so every detail can be read.
  const toggles = [...clicks]
  if (openAll) {
    toggles.push(
      ...(await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('.deck-block:not([hidden])')].filter((block) => block.querySelector('.deck-line-toggle').getAttribute('aria-expanded') === 'false').map((block) => block.dataset.block)`,
      )),
    )
  }
  for (const block of toggles) {
    await window.webContents.executeJavaScript(
      `document.querySelector('.deck-block[data-block="${block}"] .deck-line-toggle').click()`,
    )
  }
  if (toggles.length > 0) await settle(150)

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
    // What a line or a chip says, word by word: its abbreviation and each part,
    // a tick or a cross read back as the mark it stands for.
    const said = (node) =>
      [...node.querySelectorAll('.deck-line-abbr, .deck-chip-abbr, .deck-part')]
        .map((part) => {
          const copy = part.cloneNode(true)
          for (const mark of copy.querySelectorAll('.deck-mark')) {
            mark.replaceWith(mark.classList.contains('ph-check') ? '✓' : '✗')
          }
          return copy.textContent
        })
        .join(' ')
    return {
      axis: body.dataset.axis,
      position: body.dataset.position,
      collapsed: body.dataset.collapsed,
      edit: body.dataset.edit,
      mover: document.getElementById('move-panel').firstElementChild.className,
      // The footer is gone; its work is done at the Spine's foot.
      footer: Boolean(document.querySelector('.foot, footer')),
      // The Spine: how wide it is and the pane beside it, which edge it is on,
      // and whether its buttons fit the height it has.
      spineBox: rect(document.getElementById('spine')),
      paneBox: rect(document.getElementById('pane')),
      spineEdge: (() => {
        const spine = document.getElementById('spine').getBoundingClientRect()
        const pane = document.getElementById('pane').getBoundingClientRect()
        return spine.left < pane.left ? 'left' : 'right'
      })(),
      spineRoom: over(document.getElementById('spine')),
      // Along an edge: whether the Spine's row is above the pane or below it.
      spineRow: (() => {
        const spine = document.getElementById('spine').getBoundingClientRect()
        const pane = document.getElementById('pane').getBoundingClientRect()
        return spine.bottom <= pane.top + 0.5 ? 'above' : spine.top >= pane.bottom - 0.5 ? 'below' : 'beside'
      })(),
      // Along an edge, the pane's columns from left to right: the head, each
      // thing the page shows (by its Part, or its id), and the Dock — each with
      // where it starts and ends across.
      columns: [
        document.getElementById('head'),
        ...[...document.getElementById('body').children].filter((node) => node.getClientRects().length > 0),
        document.querySelector('.dock-band'),
      ].map((node) => {
        const box = node.getBoundingClientRect()
        return { name: node.dataset.part ?? (node.id || node.className), left: Math.round(box.left), right: Math.round(box.right) }
      }),
      // Each Part's button, in the Spine's order: pressed or not, shown or
      // not, and what its face says.
      spineParts: [...document.querySelectorAll('#spine [data-part]')].map((node) => ({
        part: node.dataset.part,
        pressed: node.getAttribute('aria-pressed'),
        shown: node.getClientRects().length > 0,
        face: [...node.children].filter((kid) => kid.getClientRects().length > 0).map((kid) => kid.tagName === 'I' ? 'glyph' : kid.textContent).join(' '),
        w: Math.round(node.getBoundingClientRect().width),
      })),
      // The Spine's foot, by id, in order — what is drawn of it — and what its
      // theme and language say.
      spineFoot: [...document.getElementById('spine-foot').children].filter((kid) => kid.getClientRects().length > 0).map((kid) => kid.id),
      // Where the Session section is drawn against the page that scrolls it:
      // inside it, once it has been brought into view.
      sessionInView: (() => {
        const page = document.getElementById('body').getBoundingClientRect()
        const section = document.getElementById('session-section').getBoundingClientRect()
        return { scrolled: document.getElementById('body').scrollTop, top: section.top - page.top, bottom: page.bottom - section.bottom }
      })(),
      spineFootShown: [...document.getElementById('spine-foot').children].filter((kid) => kid.id !== 'spine-mic').every((kid) => kid.getClientRects().length > 0),
      // Every button drawn anywhere in the window, by its Part or its id, in
      // the order they come: shut, the Spine's and the microphone's alone.
      buttonsShown: [...document.querySelectorAll('button')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.dataset.part ?? node.id),
      paneShown: document.getElementById('pane').getClientRects().length > 0,
      gripShown: document.getElementById('grip').getClientRects().length > 0,
      spineScrolls: getComputedStyle(document.getElementById('spine')).overflowY,
      collapseTitle: document.getElementById('collapse').title,
      // The microphone on the Spine: drawn or not, its face, and whether it is
      // painted in the accent — the one filled button. And how many buttons
      // in the window wear that paint.
      mic: (() => {
        const mic = document.getElementById('spine-mic')
        const probe = document.createElement('div')
        probe.style.background = 'var(--color-accent)'
        document.body.append(probe)
        const accent = getComputedStyle(probe).backgroundColor
        probe.remove()
        const filled = [...document.querySelectorAll('button')].filter(
          (node) => node.getClientRects().length > 0 && getComputedStyle(node).backgroundColor === accent,
        )
        return {
          shown: mic.getClientRects().length > 0,
          title: mic.title,
          glyph: mic.firstElementChild.className,
          disabled: mic.disabled,
          box: rect(mic),
          filled: filled.map((node) => node.id),
        }
      })(),
      theme: { glyph: document.querySelector('#theme i').className, title: document.getElementById('theme').title },
      language: document.getElementById('language').textContent.trim(),
      // The page, top to bottom: each thing shown, by its Part, or by its id
      // for what is not a Part.
      stack: [...document.getElementById('body').children]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.dataset.part ?? node.dataset.block ?? node.id),
      // Each section's head: its name and whether its cross is there.
      heads: [...document.querySelectorAll('section[data-part] > .part-head')]
        .filter((head) => head.getClientRects().length > 0)
        .map((head) => ({
          name: head.querySelector('.label').textContent,
          remove: head.querySelector('.part-remove').getClientRects().length > 0,
        })),
      // A Command whose label is cut short.
      commandsCut: [...document.querySelectorAll('#shortcuts .btn span')]
        .filter((word) => word.scrollWidth > word.clientWidth + 0.5)
        .map((word) => word.textContent),
      commandColumns: new Set([...document.querySelectorAll('#shortcuts .btn')].map((button) => Math.round(button.getBoundingClientRect().left))).size,
      skillColumns: new Set([...document.querySelectorAll('#skills .btn')].map((button) => Math.round(button.getBoundingClientRect().left))).size,
      // Each Command and Skill button: its label, its icon, its size, its
      // text size, and the room either side of what it carries.
      buttons: Object.fromEntries(['shortcuts', 'skills'].map((list) => [list, [...document.querySelectorAll('#' + list + ' .btn')].map((button) => {
        const box = button.getBoundingClientRect()
        const kids = [...button.children].map((kid) => kid.getBoundingClientRect())
        const from = Math.min(...kids.map((kid) => kid.left))
        const to = Math.max(...kids.map((kid) => kid.right))
        return {
          id: button.dataset.id,
          label: button.querySelector('span').textContent,
          glyph: button.querySelector('i')?.className ?? null,
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
          font: parseFloat(getComputedStyle(button).fontSize),
          before: Math.round(from - box.left),
          after: Math.round(box.right - to),
          draggable: button.draggable,
        }
      })])),
      skillsCut: [...document.querySelectorAll('#skills .btn span')]
        .filter((word) => word.scrollWidth > word.clientWidth + 0.5)
        .map((word) => word.textContent),
      // The Spine's labels, as drawn.
      spineFont: parseFloat(getComputedStyle(document.querySelector('#spine .spine-abbr')).fontSize),
      strip: over(document.querySelector('.strip')),
      panelBox: rect(document.getElementById('panel')),
      headBox: rect(document.getElementById('head')),
      // Which of its two homes the Session pair is in: the band's first column
      // or the scrolling page.
      sessionIn: document.getElementById('session-section').parentElement.id,
      bodyBox: rect(document.getElementById('body')),
      bodyRoom: over(document.getElementById('body')),
      dockBox: rect(document.querySelector('.dock-band')),
      editBox: rect(document.getElementById('dock-edit')),
      // The reading's row, in order: each button by its title, the bar as
      // "bar" — with where each one starts and how big it is drawn.
      dockPlay: [...document.querySelectorAll('.dock-play button, .dock-play .bar')].map((node) => {
        const box = node.getBoundingClientRect()
        return {
          name: node.classList.contains('bar') ? 'bar' : node.title,
          label: node.getAttribute('aria-label'),
          glyph: node.querySelector('i')?.className ?? null,
          left: Math.round(box.left),
          w: Math.round(box.width),
          h: Math.round(box.height),
        }
      }),
      // Where the listening's wave is drawn, and the voice group's own height.
      waveIn: document.getElementById('wave').parentElement.className,
      waveShown: document.getElementById('wave').getClientRects().length > 0,
      dockMicBox: rect(document.querySelector('.dock-mic')),
      // What the three edit buttons need to carry their words: each one's
      // glyph, gap, word, padding and border, and the gaps between them.
      editNeed: (() => {
        const row = document.getElementById('dock-edit')
        const buttons = [...row.querySelectorAll('.edit-btn')]
        const gap = parseFloat(getComputedStyle(row).columnGap) || 0
        return Math.ceil(buttons.reduce((sum, button) => {
          const style = getComputedStyle(button)
          const word = button.querySelector('.edit-word')
          const glyph = button.querySelector('.ph').getBoundingClientRect().width
          const inner = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
          return sum + glyph + (parseFloat(style.columnGap) || 0) + word.scrollWidth + inner
        }, 0) + gap * (buttons.length - 1))
      })(),
      // An edit button's word cut short.
      editCut: [...document.querySelectorAll('.edit-word')]
        .filter((word) => getComputedStyle(word).display !== 'none' && word.scrollWidth > word.clientWidth + 0.5)
        .map((word) => word.textContent),
      editWords: [...document.querySelectorAll('.edit-word')]
        .filter((word) => getComputedStyle(word).display !== 'none').length,
      sessionShown: getComputedStyle(document.getElementById('session-section')).display !== 'none',
      commandsBox: rect(document.getElementById('shortcuts')),
      // The Deck, when a block is on: a line down a side, a chip in a band.
      deckShown: [...document.querySelectorAll('.deck-block, .deck-chip')].some((node) => node.getClientRects().length > 0),
      deckRows: document.querySelectorAll('.deck-event').length,
      deckBox: rect(document.getElementById('deck')),
      // The Agents block: a list of lanes, whether any is cut, and where a
      // running bar ends on its track (1 is the track's right edge).
      agentLanes: document.querySelectorAll('.deck-agent-lane').length,
      agentFlags: document.querySelectorAll('.deck-agent-flag').length,
      agentLaneOver: Math.max(0, ...[...document.querySelectorAll('.deck-agent-lane')].map((lane) => lane.scrollWidth - lane.clientWidth)),
      agentLaneBars: document.querySelectorAll('.deck-agent-lane .deck-agent-bar').length,
      agentRunningEnd: Math.max(0, ...[...document.querySelectorAll('.deck-agent-lane.running .deck-agent-track')].map((track) => {
        const box = track.getBoundingClientRect()
        const bar = track.querySelector('.deck-agent-bar').getBoundingClientRect()
        return (bar.right - box.left) / box.width
      })),
      // The Loops block: a row per compaction or stray.
      loopRows: document.querySelectorAll('.deck-loop').length,
      loopsLive: document.querySelectorAll('.deck-loop.live').length,
      // The Plan block: a row per plan, and the main plan's steps.
      planRows: document.querySelectorAll('.deck-plan-row').length,
      planSteps: document.querySelectorAll('.deck-plan-step').length,
      planStepTexts: [...document.querySelectorAll('.deck-plan-step')].map((step) => step.textContent.replace(/^[0-9]+/, '')),
      planOver: Math.max(0, ...[...document.querySelectorAll('.deck-plan-rows, .deck-plan-steps')].map((list) => list.scrollWidth - list.clientWidth)),
      // The Plan block's mute, in its head, and whether it is pressed.
      planMute: (() => {
        const mute = document.querySelector('.deck-plan-mute')
        if (!mute || mute.getClientRects().length === 0) return null
        return {
          pressed: mute.getAttribute('aria-pressed'),
          glyph: mute.firstElementChild.className,
          title: mute.title,
          inLine: mute.parentElement.classList.contains('deck-line'),
        }
      })(),
      // The Plan's mute on its chip, in a band.
      chipMute: (() => {
        const mute = document.querySelector('.deck-chip[data-block="plan"] .deck-plan-mute')
        if (!mute || mute.getClientRects().length === 0) return null
        return {
          pressed: mute.getAttribute('aria-pressed'),
          glyph: mute.firstElementChild.className,
          title: mute.title,
          label: mute.getAttribute('aria-label'),
        }
      })(),
      // The Deck's type size as drawn: a line's text down a side, a chip's in a band.
      deckFont: (() => {
        const node = [...document.querySelectorAll('.deck-line, .deck-chip')].find(
          (each) => each.getClientRects().length > 0,
        )
        return node ? parseFloat(getComputedStyle(node).fontSize) : null
      })(),
      // And the Commands', which are no part of the Deck and do not follow it.
      commandsFont: parseFloat(getComputedStyle(document.querySelector('#shortcuts .btn')).fontSize),
      // The Deck in a band: the chips drawn, the blocks drawn in full, which
      // chips ask for attention, and whether any chip reaches past the panel.
      blocksDrawn: [...document.querySelectorAll('.deck-block')].filter((block) => !block.hidden).length,
      chips: [...document.querySelectorAll('.deck-chip')]
        .filter((chip) => chip.getClientRects().length > 0)
        .map((chip) => {
          const box = chip.getBoundingClientRect()
          const panel = document.getElementById('panel').getBoundingClientRect()
          return {
            block: chip.dataset.block,
            // A tick or a cross is an icon, read back as the mark it stands for.
            text: said(chip),
            attention: chip.classList.contains('attention') ? chip.dataset.attention : null,
            h: Math.round(box.height),
            below: Math.round(box.bottom - panel.bottom),
            above: Math.round(panel.top - box.top),
            over: chip.scrollWidth - chip.clientWidth,
          }
        }),
      // The Deck as lines: each block that is on, whether its detail is open,
      // what its line says, whether it asks for attention, and whether the
      // line reaches past its room.
      lines: [...document.querySelectorAll('.deck-block')]
        .filter((block) => block.getClientRects().length > 0)
        .map((block) => {
          const line = block.querySelector('.deck-line')
          const figures = block.querySelector('.deck-line-figures')
          const detail = block.querySelector('.deck-block-body')
          return {
            block: block.dataset.block,
            open: block.querySelector('.deck-line-toggle').getAttribute('aria-expanded') === 'true',
            detailShown: detail.getClientRects().length > 0,
            text: said(line),
            attention: block.classList.contains('attention') ? block.dataset.attention : null,
            h: Math.round(line.getBoundingClientRect().height),
            over: line.scrollWidth - line.clientWidth,
            // Against the page's own content box: a line is a Part of the
            // page now, not a row of the Deck's section.
            right: Math.round(line.getBoundingClientRect().right - (document.getElementById('body').getBoundingClientRect().right - parseFloat(getComputedStyle(document.getElementById('body')).paddingRight))),
            figuresOver: Math.max(0, figures.scrollWidth - figures.clientWidth),
          }
        }),
      // The Deck's words are in sentence case. Every piece of text it draws —
      // but what is shown exactly as Claude Code said it, and the section's
      // own label — that begins with a letter begins with a capital, and none of
      // the Deck's own is written all in capitals but the acronyms (words Claude
      // Code wrote, marked data-written, may hold acronyms of their own: "ADR
      // 0034"); and nothing sets text-transform.
      casing: (() => {
        const deck = document.getElementById('deck')
        const ACRONYMS = new Set(['PLN', 'CTX', 'AGT', 'LPS', 'EVT'])
        const wrong = []
        const walker = document.createTreeWalker(deck, NodeFilter.SHOW_TEXT)
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          const host = text.parentElement
          if (!host || host.closest('[data-verbatim], .label') || host.getClientRects().length === 0) continue
          const words = text.textContent.trim()
          if (words === '') continue
          if (/^[a-z]/.test(words)) wrong.push(words)
          // Capitals with nothing in lower case beside them are shouting, but for the acronyms.
          const shouted = /[a-z]/.test(words) || host.closest('[data-written]') ? [] : (words.match(/[A-Z]{2,}/g) ?? [])
          if (shouted.some((word) => !ACRONYMS.has(word))) wrong.push(words)
        }
        for (const node of deck.querySelectorAll('*')) {
          if (node.closest('.label')) continue
          if (getComputedStyle(node).textTransform !== 'none') wrong.push('text-transform on ' + node.className)
        }
        return wrong
      })(),
      headRoom: over(document.getElementById('head')),
      // Nothing in the page may spill past the pane it is drawn in.
      spill: {
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      },
    }
  })()`)

  seen.asked = asked.get(window.webContents.id) ?? []
  seen.dropMarks = dropMarks
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
      spine: seen.spineBox.w,
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
  report.terminalPaste = await pasteIntoTerminal()

  report.right = await measurePanel({ width: 316, height: 780, position: 'right' })
  // The Deck with its Events block on and a few entries in it, down a side and
  // along an edge.
  const deckOn = {
    deckBlocks: { gauge: true, agents: false, loops: false, events: true },
    deck: {
      events: [
        { id: 3, at: 1760000000000, kind: 'denied', label: 'Bash', detail: 'rm -rf C:\\Jarvis\\Resources', note: 'Not allowed in auto mode', inAgent: false },
        { id: 2, at: 1759999999000, kind: 'edit', label: 'Edit', detail: 'C:\\Jarvis\\.source\\src\\core\\deck.js', note: null, inAgent: true },
        { id: 1, at: 1759999998000, kind: 'prompt', label: 'Prompt', detail: 'diga apenas: ok', note: null, inAgent: false },
      ],
    },
  }
  report.deckRail = await measurePanel({ width: 316, height: 780, position: 'right', over: deckOn })
  report.deckBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: deckOn })
  // The Agents block, down the narrowest side, its line opened: three agents
  // and five, each a row of the list.
  const agent = (n, status, extra = {}) => ({
    id: `a${n}`,
    type: n % 2 ? 'Explore' : 'general-purpose',
    task: n === 2 ? null : `Find where the installer writes the hooks, number ${n}`,
    steps: 3 * n,
    startedAt: Date.now() - 60_000 * n,
    endedAt: status === 'running' ? null : Date.now() - 5_000,
    status,
    tokens: status === 'running' ? null : { input: 12, output: 4800, cacheRead: 52_000, cacheCreation: 3100, total: 59_912 },
    outOfOutput: status === 'running' ? null : n === 3,
    ...extra,
  })
  const agentsOn = (agents) => ({
    deckBlocks: { gauge: false, agents: true, loops: false, events: false },
    deck: {
      agents: {
        running: agents.filter((each) => each.status === 'running').length,
        done: agents.filter((each) => each.status === 'done').length,
        failed: agents.filter((each) => each.status === 'failed').length,
        agents,
      },
    },
  })
  const three = [agent(1, 'running'), agent(2, 'failed'), agent(3, 'done')]
  const five = [...three, agent(4, 'running'), agent(5, 'done')]
  report.agentList = await measurePanel({ width: 316, height: 780, position: 'right', over: agentsOn(three), openAll: true })
  report.agentLanes = await measurePanel({ width: 316, height: 780, position: 'right', over: agentsOn(five), openAll: true })
  report.agentBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: agentsOn(three) })
  // The Loops block: two compactions, one running; two strays, one seen just now.
  const loopsOn = {
    deckBlocks: { gauge: false, agents: false, loops: true, events: false },
    deck: {
      loops: {
        // Long enough that "seen just now" still holds when the later layouts
        // drawn from this same view are measured — they come a minute or more on.
        liveForMs: 300_000,
        compactions: [
          { trigger: 'manual', running: false, startedAt: Date.now() - 600_000, endedAt: Date.now() - 560_000 },
          { trigger: 'auto', running: true, startedAt: Date.now() - 12_000, endedAt: null },
        ],
        strays: [
          { id: 'a3f9c2e1b7d04e58', short: 'a3f9c2e', steps: 14, firstSeen: Date.now() - 300_000, lastSeen: Date.now() - 2_000 },
          { id: 'b81d77aa0c3e4f19', short: 'b81d77a', steps: 3, firstSeen: Date.now() - 900_000, lastSeen: Date.now() - 800_000 },
        ],
      },
    },
  }
  report.loopsRail = await measurePanel({ width: 316, height: 780, position: 'right', over: loopsOn, openAll: true })
  report.loopsBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: loopsOn })
  // Every block on at once: down a side in full, along an edge as five chips —
  // two of them asking for attention: context past 80% and a subagent failed.
  const allOn = {
    deckBlocks: { plan: true, gauge: true, agents: true, loops: true, events: true },
    deck: {
      plan: {
        rows: [
          { id: 'main', title: 'Main', done: 3, total: 8, current: 'Writing the reducer for the Plan block and its tests', finished: false, inAgent: false },
          { id: 'a1', title: 'Find where the installer writes the hooks, number 1', done: 1, total: 2, current: null, finished: false, inAgent: true },
        ],
        steps: [
          { label: 'Read the ticket', status: 'completed' },
          { label: 'Write the MCP server in Brain and test it as a process', status: 'completed' },
          { label: 'Register it on Connect', status: 'completed' },
          { label: 'Write the reducer for the Plan block and its tests', status: 'in_progress' },
          { label: 'ADR 0034', status: 'pending' },
        ],
      },
      gauge: {
        reported: true,
        context: { percent: 86, compactions: [{ percent: 71, trigger: 'auto', running: false }] },
        limits: { fiveHour: { percent: 40, resetsAt: Date.now() + 3_600_000 }, sevenDay: { percent: 12, resetsAt: Date.now() + 3 * 86_400_000 } },
        model: 'Opus 4.7',
        effort: 'high',
        permissionMode: 'default',
      },
      agents: agentsOn(three).deck.agents,
      loops: loopsOn.deck.loops,
      events: deckOn.deck.events,
    },
  }
  report.allRail = await measurePanel({ width: 316, height: 780, position: 'right', over: allOn })
  // Every line opened, so every detail can be read; and two clicks — the Plan
  // closed, the Events opened.
  report.allOpen = await measurePanel({ width: 316, height: 780, position: 'right', over: allOn, openAll: true })
  report.allToggled = await measurePanel({ width: 316, height: 780, position: 'right', over: allOn, clicks: ['plan', 'events'] })
  report.allBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: allOn })
  report.allTop = await measurePanel({ width: 1240, height: 148, position: 'top', over: allOn })
  // The same, at the Deck's smallest and largest type size.
  for (const size of [9, 14]) {
    const sized = { ...allOn, deckFontSize: size }
    report[`allRail${size}`] = await measurePanel({ width: 316, height: 780, position: 'right', over: sized, openAll: true })
    report[`allBand${size}`] = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: sized })
  }
  report.allMuted = await measurePanel({ width: 316, height: 780, position: 'right', over: { ...allOn, deckPlanMuted: true } })
  report.allBandMuted = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: { ...allOn, deckPlanMuted: true } })
  report.allShut = await measurePanel({ width: 1240, height: 52, position: 'bottom', collapsed: true, over: allOn })
  // The microphone open: Finish and Cancel in the microphone's place.
  report.listenRail = await measurePanel({ width: 316, height: 780, position: 'right', over: { isListening: true } })
  report.listenBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: { isListening: true } })
  report.listenTight = await measurePanel({ width: 924, height: 148, position: 'bottom', over: { isListening: true } })
  // The Spine's own cases. Everything off: the page holds nothing but what is
  // transient. An order of the user's, with a button hidden. Every Part
  // pressed on and off from the Spine itself, by clicks that go the whole way
  // round. Iron Man in English, for the foot's two faces.
  const sectionsOff = { parts: { commands: false, skills: false, readings: false, session: false } }
  report.spineEmpty = await measurePanel({ width: 316, height: 780, position: 'right', over: sectionsOff })
  const readings = [
    { id: 1, title: 'The answer about the hooks' },
    { id: 2, title: 'The plan for the Spine' },
  ]
  report.spineOrdered = await measurePanel({
    width: 316,
    height: 780,
    position: 'right',
    over: {
      ...allOn,
      recentReadings: readings,
      spineOrder: ['session', 'plan', 'commands', 'gauge', 'readings', 'skills', 'events', 'agents', 'loops'],
      spineHidden: ['loops'],
      deckBlocks: { ...allOn.deckBlocks, loops: false },
    },
  })
  report.spineOn = await measurePanel({
    width: 316,
    height: 780,
    position: 'right',
    over: { ...sectionsOff, recentReadings: readings, deck: allOn.deck },
    spineClicks: ['commands', 'skills', 'readings', 'session', 'gauge', 'events', 'plan', 'agents', 'loops'],
  })
  report.spineOff = await measurePanel({
    width: 316,
    height: 780,
    position: 'right',
    over: { ...allOn, recentReadings: readings },
    spineClicks: ['commands', 'skills', 'readings', 'session', 'gauge', 'events', 'plan', 'agents', 'loops'],
  })
  // Two drags down a side: Session dropped on Context's upper half, Context
  // then dropped on the Plan's lower half.
  report.spineDragged = await measurePanel({
    width: 316,
    height: 780,
    position: 'right',
    over: { ...allOn, recentReadings: readings },
    spineDrags: [
      { part: 'session', onto: 'gauge', after: false },
      { part: 'gauge', onto: 'plan', after: true },
    ],
  })
  // Session added last, at the foot of a page taller than the shortest window:
  // it is brought into view rather than left below the fold.
  report.spineScrolled = await measurePanel({
    width: 316,
    height: 420,
    position: 'right',
    over: { ...allOn, recentReadings: readings, parts: { commands: true, skills: true, readings: true, session: false } },
    spineClicks: ['session'],
  })
  report.spineIron = await measurePanel({ width: 316, height: 780, position: 'left', over: { theme: 'iron', languageLabel: 'EN' } })
  report.left = await measurePanel({ width: 316, height: 780, position: 'left' })
  report.wide = await measurePanel({ width: 520, height: 780, position: 'right' })
  report.bottom = await measurePanel({ width: 1240, height: 148, position: 'bottom' })
  report.top = await measurePanel({ width: 1240, height: 148, position: 'top' })
  // The width at which the dock reaches its own floor, and one well below it.
  report.bandFloor = await measurePanel({ width: 1000, height: 148, position: 'bottom' })
  report.bandTight = await measurePanel({ width: 924, height: 148, position: 'bottom' })
  // 140 rather than 52: Windows refuses a window narrower than about 120, so
  // the Spine is measured inside a window wider than it; what it is drawn at
  // is what counts.
  report.shutSide = await measurePanel({ width: 140, height: 780, position: 'right', collapsed: true })
  report.shutBand = await measurePanel({ width: 1240, height: 52, position: 'top', collapsed: true })
  // Every Deck block on, shut down a side: the figures stay on the Spine.
  report.shutSideAll = await measurePanel({ width: 140, height: 780, position: 'right', collapsed: true, over: allOn })
  // The microphone pressed while shut, and the microphone while listening.
  report.shutSpeak = await measurePanel({ width: 140, height: 780, position: 'left', collapsed: true, presses: ['spine-mic'] })
  report.shutListening = await measurePanel({ width: 140, height: 780, position: 'right', collapsed: true, over: { isListening: true } })
  // The shortest window the app allows. The Spine asks for more than this,
  // which is the case its scrolling is there for.
  report.shutShort = await measurePanel({ width: 140, height: 420, position: 'right', collapsed: true })

  // Last, since the Deck's fixtures above are read against the clock: the
  // cases that do not care how long ago they were made.
  // Along an edge, an order of the user's, and a drag along the Spine's row:
  // Session dropped on the left half of Context, Context on the right half of
  // the Plan.
  report.bandOrdered = await measurePanel({
    width: 1400,
    height: 148,
    position: 'bottom',
    over: {
      ...allOn,
      recentReadings: readings,
      spineOrder: ['session', 'plan', 'commands', 'gauge', 'readings', 'skills', 'events', 'agents', 'loops'],
    },
  })
  report.bandDragged = await measurePanel({
    width: 1400,
    height: 148,
    position: 'top',
    over: { ...allOn, recentReadings: readings },
    spineDrags: [
      { part: 'session', onto: 'gauge', after: false },
      { part: 'gauge', onto: 'plan', after: true },
    ],
  })
  // The Commands and the Skills the user's way: columns, sizes, and the
  // Spine's labels; and a button dragged in each list.
  const sized = { commandColumns: 2, skillColumns: 1, commandFontSize: 16, skillFontSize: 10, spineFontSize: 13 }
  report.buttonsSized = await measurePanel({ width: 316, height: 780, position: 'right', over: sized })
  report.buttonsBig = await measurePanel({ width: 316, height: 780, position: 'right', over: { commandFontSize: 16, skillFontSize: 16, commandColumns: 3, skillColumns: 3 } })
  report.buttonsBand = await measurePanel({ width: 1240, height: 148, position: 'bottom', over: sized })
  report.buttonsDragged = await measurePanel({
    width: 316,
    height: 780,
    position: 'right',
    buttonDrags: [
      { list: 'shortcuts', id: '7', onto: '1', after: false },
      { list: 'skills', id: 's1', onto: 's3', after: true },
    ],
  })
  // The same drags along an edge, where the lists flow down three rows column
  // by column: "after" is below. Each is held on the half that a row-reading
  // rule would get wrong — right of the middle but above it, then left but below.
  report.buttonsBandDragged = await measurePanel({
    width: 1240,
    height: 148,
    position: 'bottom',
    buttonDrags: [
      { list: 'shortcuts', id: '7', onto: '1', at: { x: 0.75, y: 0.25 } },
      { list: 'skills', id: 's1', onto: 's3', at: { x: 0.25, y: 0.75 } },
    ],
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  app.exit(0)
})
