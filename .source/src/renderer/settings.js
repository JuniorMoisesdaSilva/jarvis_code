'use strict'

// The Settings sheet: the whole window while it is open, every section in one
// view of four columns in a window wide enough for them (ADR 0036). The
// terminal runs on underneath it.
//
// It loads three of the core's tables as plain scripts before this file — the
// Deck's (deck-chips.js), the Spine's (spine.js) and the buttons' look
// (button-look.js) — so the ranges, the Parts and the icons it offers are the
// ones the Panel and the preferences read, never a copy.

const el = (id) => document.getElementById(id)

const { DECK_FONT } = window.deckChips
const { PARTS, cleanOrder, cleanHidden, hiding } = window.spine
const { GLYPHS, COMMAND_GLYPH, SKILL_GLYPH, COLUMNS, SPINE_FONT, BUTTON_FONT, TERMINAL_FONT, settle, reordered, dropsAfter, inOrder } =
  window.buttonLook

const parts = {
  hooksText: el('hooks-text'),
  installHooks: el('install-hooks'),
  removeHooks: el('remove-hooks'),
  theme: el('theme'),
  language: el('language'),
  sizes: el('sizes'),
  sides: el('sides'),
  spineList: el('spine-list'),
  commandColumns: el('command-columns'),
  skillColumns: el('skill-columns'),
  shell: el('shell'),
  model: el('model'),
  modelNote: el('model-note'),
  modelField: el('model-field'),
  voicePt: el('voice-pt'),
  voiceEn: el('voice-en'),
  rate: el('rate'),
  rateValue: el('rate-value'),
  voiceNote: el('voice-note'),
  voiceNoteText: el('voice-note-text'),
  rows: el('shortcut-rows'),
  addShortcut: el('add-shortcut'),
  resetShortcuts: el('reset-shortcuts'),
  skillRows: el('skill-rows'),
  addSkill: el('add-skill'),
  picker: el('picker'),
  pickerTitle: el('picker-title'),
  pickerGrid: el('picker-grid'),
  pickerClose: el('picker-close'),
  saved: el('saved'),
  failed: el('failed'),
}

const PORTUGUESE = 'pt-BR'
const ENGLISH = 'en-US'

/** Only for the case where the settings themselves cannot be read. */
const DEFAULTS = Object.freeze({
  theme: 'dark',
  language: PORTUGUESE,
  shell: 'powershell.exe',
  terminalFontSize: TERMINAL_FONT.size,
  spineFontSize: SPINE_FONT.size,
  deckFontSize: DECK_FONT.size,
  commandFontSize: BUTTON_FONT.size,
  skillFontSize: BUTTON_FONT.size,
  commandColumns: COLUMNS.size,
  skillColumns: COLUMNS.size,
  panelPosition: 'right',
  model: 'medium',
  voices: {},
  speechRate: 0,
})

/** What is stored, as last read or written from here. */
let stored = { ...DEFAULTS }
let models = {}
let voices = []
let shortcuts = []
let skills = []
let announcing = null

function announce(node, message) {
  parts.saved.hidden = true
  parts.failed.hidden = true
  node.textContent = message
  node.hidden = false
  clearTimeout(announcing)
  announcing = setTimeout(() => {
    node.hidden = true
  }, 2600)
}

async function save(patch) {
  stored = { ...stored, ...patch }
  try {
    const written = await window.jarvis.writePreferences(patch)
    announce(parts.saved, 'Saved')
    return written
  } catch {
    announce(parts.failed, 'Could not save. Check that Jarvis can write to your AppData folder.')
    return null
  }
}

function icon(name) {
  const node = document.createElement('i')
  node.className = `ph ph-${name}`
  node.setAttribute('aria-hidden', 'true')
  return node
}

// --- Segmented choices -------------------------------------------------------

/**
 * A row of choices, one of them marked, built into `group`. `options` are
 * [value, words, glyph?]; `choose` is called with the value of a choice that
 * was not already the one marked.
 */
function segments(group, options, choose) {
  group.textContent = ''
  for (const [value, words, glyph] of options) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'seg-opt'
    option.setAttribute('role', 'radio')
    option.dataset.value = String(value)
    if (glyph) option.append(icon(glyph))
    option.append(words)
    option.addEventListener('click', () => {
      if (option.getAttribute('aria-checked') === 'true') return
      mark(group, value)
      choose(value)
    })
    group.append(option)
  }
}

function mark(group, value) {
  for (const option of group.children) option.setAttribute('aria-checked', String(option.dataset.value === String(value)))
}

// --- Appearance --------------------------------------------------------------

// The theme and the language go through the Panel's own actions — the ones the
// Spine's foot uses — so every window, the terminal and Claude Code follow
// exactly as they do from there.
segments(
  parts.theme,
  [
    ['dark', 'Dark', 'moon'],
    ['light', 'Light', 'sun'],
    ['iron', 'Iron Man', 'shield-star'],
  ],
  (name) => window.jarvis.act('setTheme', name),
)

segments(
  parts.language,
  [
    [PORTUGUESE, 'Português'],
    [ENGLISH, 'English'],
  ],
  (language) => {
    stored = { ...stored, language }
    window.jarvis.act('toggleLanguage')
  },
)

/**
 * The sheet is a third renderer, so it is told the theme like the other two,
 * whoever changed it.
 */
function applyTheme(name) {
  const theme = ['dark', 'light', 'iron'].includes(name) ? name : 'dark'
  document.documentElement.dataset.theme = theme
  mark(parts.theme, theme)
}

window.jarvis.onTheme(applyTheme)

// --- Text sizes --------------------------------------------------------------

/** The five sizes, each with the range the preferences keep it in. */
const SIZES = [
  { id: 'terminal-font', key: 'terminalFontSize', label: 'Terminal', range: TERMINAL_FONT, unit: 'pt' },
  { id: 'spine-font', key: 'spineFontSize', label: 'Spine', range: SPINE_FONT, unit: 'px' },
  { id: 'deck-font', key: 'deckFontSize', label: 'Deck', range: DECK_FONT, unit: 'px' },
  { id: 'command-font', key: 'commandFontSize', label: 'Command buttons', range: BUTTON_FONT, unit: 'px' },
  { id: 'skill-font', key: 'skillFontSize', label: 'Skill buttons', range: BUTTON_FONT, unit: 'px' },
]

/** How long the typing in a size box pauses before what it holds is written. */
const TYPING_PAUSE_MS = 400

/**
 * A number box per size. A number typed inside the range, on its step, is
 * applied once the typing pauses — the Panel or the terminal changes behind
 * the sheet — so a size typed a key at a time is one write, and every window
 * redraws once rather than at each key. On leaving the box (or Enter) whatever
 * is there is settled into the range and written at once; something that is
 * not a number goes back to what is stored.
 */
function buildSizes() {
  parts.sizes.textContent = ''
  for (const size of SIZES) {
    const row = document.createElement('div')
    row.className = 'size'
    const label = document.createElement('label')
    label.htmlFor = size.id
    label.textContent = size.label
    const box = document.createElement('input')
    box.type = 'number'
    box.id = size.id
    box.min = String(size.range.min)
    box.max = String(size.range.max)
    box.step = String(size.range.step ?? 1)
    box.title = `${size.range.min} to ${size.range.max}`
    const unit = document.createElement('span')
    unit.className = 'unit'
    unit.textContent = size.unit
    row.append(label, box, unit)
    parts.sizes.append(row)

    const take = (value) => {
      if (value === stored[size.key]) return
      save({ [size.key]: value })
    }
    let pausing = null
    box.addEventListener('input', () => {
      clearTimeout(pausing)
      const value = settle(size.range, box.value)
      if (value !== null && value === Number(box.value)) pausing = setTimeout(() => take(value), TYPING_PAUSE_MS)
    })
    box.addEventListener('change', () => {
      clearTimeout(pausing)
      const value = settle(size.range, box.value)
      if (value === null) {
        box.value = String(stored[size.key])
        return
      }
      box.value = String(value)
      take(value)
    })
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') box.blur()
    })
  }
}

function fillSizes() {
  for (const size of SIZES) el(size.id).value = String(stored[size.key] ?? DEFAULTS[size.key])
}

buildSizes()

// --- Panel side --------------------------------------------------------------

/** Four drawings of a window, the Panel's bar on one edge of each. */
function buildSides() {
  for (const side of ['left', 'top', 'right', 'bottom']) {
    const pick = document.createElement('button')
    pick.type = 'button'
    pick.className = 'side'
    pick.dataset.value = side
    pick.setAttribute('role', 'radio')
    pick.title = `The panel on the ${side}`
    const bar = document.createElement('i')
    bar.className = 'bar'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = side.toUpperCase()
    pick.append(bar, name)
    pick.addEventListener('click', () => {
      if (pick.getAttribute('aria-checked') === 'true') return
      mark(parts.sides, side)
      window.jarvis.act('placePanel', side)
    })
    parts.sides.append(pick)
  }
}

buildSides()

// --- The Spine's buttons -----------------------------------------------------

/**
 * The nine buttons in the Spine's order, a tick on each one shown. Unticking
 * hides the button and turns its Part off; ticking shows it again and leaves
 * the Part off, for a click on the Spine to turn on (spine.js `hiding`).
 */
function drawSpineList() {
  const hidden = cleanHidden(stored.spineHidden)
  parts.spineList.textContent = ''
  for (const id of cleanOrder(stored.spineOrder)) {
    const part = PARTS.find((each) => each.id === id)
    const row = document.createElement('label')
    row.dataset.part = id
    row.classList.toggle('off', hidden.includes(id))
    const abbreviation = document.createElement('span')
    abbreviation.className = 'abbreviation'
    abbreviation.textContent = part.abbreviation
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = part.name
    const kind = document.createElement('span')
    kind.className = 'kind'
    kind.textContent = part.deck ? 'Deck' : 'Section'
    const tick = document.createElement('input')
    tick.type = 'checkbox'
    tick.checked = !hidden.includes(id)
    tick.title = 'Show this button on the Spine'
    tick.addEventListener('change', async () => {
      row.classList.toggle('off', !tick.checked)
      // Worked out from the file as it is now, not as it was when the sheet
      // opened: another window may have hidden a button since.
      const now = await window.jarvis.readPreferences().catch(() => null)
      if (now) stored = { ...stored, spineHidden: now.spineHidden }
      save(hiding(stored, id, !tick.checked))
    })
    row.append(icon(part.glyph), abbreviation, name, kind, tick)
    parts.spineList.append(row)
  }
}

// --- Columns -----------------------------------------------------------------

const COUNTS = Array.from({ length: COLUMNS.max - COLUMNS.min + 1 }, (_, at) => [COLUMNS.min + at, String(COLUMNS.min + at)])
segments(parts.commandColumns, COUNTS, (count) => save({ commandColumns: count }))
segments(parts.skillColumns, COUNTS, (count) => save({ skillColumns: count }))

// --- Voices ------------------------------------------------------------------

function voicesFor(language) {
  const prefix = language.slice(0, 2).toLowerCase()
  return voices.filter((each) => (each.culture ?? '').toLowerCase().startsWith(prefix))
}

function fillVoices(select, language, chosen) {
  const available = voicesFor(language)
  select.textContent = ''

  if (available.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'No voice for this language'
    select.append(option)
    select.disabled = true
    return false
  }

  select.disabled = false
  const automatic = document.createElement('option')
  automatic.value = ''
  automatic.textContent = 'Let Jarvis choose'
  select.append(automatic)

  // One flat list, with no heading: every voice here is one Jarvis carries, so
  // there is no second kind to tell them apart from.
  for (const voice of available) {
    const option = document.createElement('option')
    option.value = voice.name
    option.textContent = `${voice.label ?? voice.name} (${voice.culture})`
    select.append(option)
  }

  select.value = chosen ?? ''
  return true
}

/**
 * What these voices are, which has now changed three times.
 *
 * It first said they came with the speech model and were downloaded on first
 * use, about 88 MB — untrue: Jarvis read with whatever Windows already had. It
 * then said Windows' own were offered underneath Jarvis' — untrue since 8
 * September 2026, when that switch was removed. Rewritten each time rather than
 * left half right.
 */
function describeVoices({ portuguese, english }) {
  const missing = [!portuguese && 'Portuguese', !english && 'English'].filter(Boolean)
  parts.voiceNote.classList.toggle('warn', missing.length > 0)

  if (missing.length > 0) {
    parts.voiceNoteText.textContent =
      `Nothing here can read ${missing.join(' or ')}. The voices Jarvis carries ` +
      'are missing from this folder — they live in Resources, and are put back ' +
      'by fetching the assets again.'
    return
  }

  // Worth saying, because the obvious assumption is wrong in both directions:
  // people expect an app that reads aloud to have brought its own voice, and
  // people who looked for a Portuguese voice in another application often
  // concluded they had none.
  parts.voiceNoteText.textContent =
    'Jarvis brings its own voices and they need no setting up. Everything is ' +
    'spoken on this machine — nothing you say or hear leaves it.'
}

function describeRate(value) {
  const number = Number(value)
  if (number === 0) return 'normal'
  return number < 0 ? `${-number} slower` : `${number} faster`
}

// --- Models ------------------------------------------------------------------

/**
 * The sizes as one segmented control rather than a drop-down: a menu you have to
 * open hides the very thing the choice is about, which is what each one costs.
 *
 * There is one model now, so the control is hidden and the note under it says
 * what Jarvis listens with. A radio group of one is not a choice; the note still
 * is worth reading, because it says the model is already here rather than a
 * download waiting to happen.
 */
function fillModels(chosen) {
  parts.modelField.hidden = Object.keys(models).length < 2
  segments(
    parts.model,
    Object.entries(models).map(([name]) => [name, name]),
    (name) => {
      describeModel(name)
      save({ model: name })
    },
  )
  for (const option of parts.model.children) {
    const model = models[option.dataset.value]
    option.title = `${model.label}, ${sizeOf(model)}`
  }
  mark(parts.model, chosen)
  describeModel(chosen)
}

/**
 * What the size means, which is not the same for every model. One that travels
 * with the app is already on the disk; one that does not is a wait, and a plain
 * "940 MB" reads as a download for both.
 */
function sizeOf(model) {
  return model.shipped
    ? `about ${model.megabytes} MB, already here`
    : `about ${model.megabytes} MB to download`
}

function describeModel(name) {
  const model = models[name]
  parts.modelNote.textContent = model ? `${model.label} — ${sizeOf(model)}. ${model.note ?? ''}` : ''
}

// --- Command and Skill rows --------------------------------------------------

/**
 * The two tables, which differ only in the list they edit, how it is saved,
 * and what a new row carries. Rows are edited in place: an icon, the name, the
 * command, Enter, remove; dragged by their handle (so typing never starts a
 * drag) to reorder.
 */
const TABLES = {
  shortcuts: {
    body: parts.rows,
    get: () => shortcuts,
    set: (list) => {
      shortcuts = list
    },
    write: (list) => window.jarvis.writeShortcuts(list),
    failure: 'Could not save the buttons.',
    fresh: () => ({ id: `new-${Date.now()}`, label: 'New', command: '', submits: true, glyph: COMMAND_GLYPH }),
  },
  skills: {
    body: parts.skillRows,
    get: () => skills,
    set: (list) => {
      skills = list
    },
    write: (list) => window.jarvis.writeSkills(list),
    failure: 'Could not save the skills.',
    // A skill does not submit by default: its command is often typed with an
    // argument after it, so pressing Enter is left to you.
    fresh: () => ({ id: `new-${Date.now()}`, label: 'New skill', command: '', submits: false, glyph: SKILL_GLYPH }),
  },
}

function isFinished(item) {
  return item.label.trim() !== '' && item.command.trim() !== ''
}

/**
 * Saves the rows that are finished, and leaves the one being filled in alone.
 *
 * Storing a button with no command would put a dead button in the Panel; but
 * pruning it here would make the half-typed row disappear the moment the label
 * loses focus, so a new button could only ever be made command-first.
 */
async function persist(kind, { redraw = true } = {}) {
  const table = TABLES[kind]
  const finished = table.get().filter(isFinished)
  const unfinished = table.get().filter((each) => !isFinished(each))

  try {
    const written = await table.write(finished)
    // The store answers with the built-in seven when handed an empty list, which
    // would wipe a row still being typed. Only take its answer when it is ours,
    // and keep the order on screen: a row being filled in stays where it is.
    if (finished.length === 0) table.set(unfinished)
    else {
      const byId = new Map(written.map((each) => [each.id, each]))
      const kept = table.get().map((each) => (isFinished(each) ? byId.get(each.id) : each)).filter(Boolean)
      table.set([...kept, ...written.filter((each) => !kept.includes(each))])
    }
    if (redraw) drawRows(kind)
    announce(parts.saved, 'Saved')
  } catch {
    announce(parts.failed, table.failure)
  }
}

/**
 * One editable row. Every handler looks the item up fresh by its id through
 * the table's getter: a save with redraw:false replaces the module array with
 * a stored one, so a captured reference would edit the old array while persist
 * reads the new, silently dropping the edit — and a captured index would edit
 * whichever row had come to stand there.
 */
function buildRow(kind, index) {
  const table = TABLES[kind]
  const item = table.get()[index]
  const id = item.id
  const current = () => table.get().find((each) => each.id === id) ?? {}
  const row = document.createElement('tr')
  row.dataset.id = item.id

  const handle = document.createElement('span')
  handle.className = 'handle'
  handle.draggable = true
  handle.title = 'Drag to reorder'
  handle.append(icon('dots-six-vertical'))
  const number = document.createElement('span')
  number.textContent = String(index + 1)
  const order = document.createElement('span')
  order.append(handle, ' ', number)

  const pick = document.createElement('button')
  pick.type = 'button'
  pick.className = 'iconpick'
  pick.title = 'Choose an icon'
  pick.dataset.glyph = item.glyph ?? ''
  pick.setAttribute('aria-expanded', 'false')
  if (item.glyph) pick.append(icon(item.glyph))
  else {
    const none = document.createElement('span')
    none.className = 'none'
    none.textContent = '—'
    pick.append(none)
  }
  pick.append(icon('caret-down'))
  pick.addEventListener('click', () => openPicker(kind, id, pick))

  const field = (key, className) => {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = `cell ${className}`
    input.spellcheck = false
    input.value = item[key]
    input.addEventListener('change', () => {
      current()[key] = input.value
      persist(kind, { redraw: false })
    })
    return input
  }
  const name = field('label', 'name')
  name.setAttribute('aria-label', kind === 'skills' ? 'Skill' : 'Button')
  const command = field('command', 'command')
  command.setAttribute('aria-label', 'Command')

  const submits = document.createElement('input')
  submits.type = 'checkbox'
  submits.checked = item.submits
  submits.title = 'Press Enter after typing the command'
  submits.addEventListener('change', () => {
    current().submits = submits.checked
    persist(kind, { redraw: false })
  })

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.title = 'Remove'
  remove.append(icon('x'))
  remove.addEventListener('click', () => {
    table.set(table.get().filter((each) => each.id !== id))
    persist(kind)
  })

  for (const [child, middle] of [
    [order, false],
    [pick, true],
    [name, false],
    [command, false],
    [submits, true],
    [remove, true],
  ]) {
    const cell = document.createElement('td')
    if (middle) cell.className = 'middle'
    cell.append(child)
    row.append(cell)
  }
  return row
}

function drawRows(kind) {
  const table = TABLES[kind]
  table.body.textContent = ''
  table.get().forEach((_, index) => table.body.append(buildRow(kind, index)))
}

/**
 * A row dragged by its handle onto another: a line on the side it will land,
 * above or below the row held over, and the drop reorders the list and saves
 * it — the Panel's buttons follow, as they do when dragged there.
 */
function dragRows(kind) {
  const { body, get, set } = TABLES[kind]
  let held = null
  const clear = () => {
    for (const node of body.querySelectorAll('.drop-before, .drop-after')) node.classList.remove('drop-before', 'drop-after')
  }
  const target = (event) => {
    const row = event.target.closest?.('tr')
    if (!row || !held || !body.contains(row)) return null
    const box = row.getBoundingClientRect()
    return { row, id: row.dataset.id, after: dropsAfter('column', { x: event.clientX, y: event.clientY }, box) }
  }
  body.addEventListener('dragstart', (event) => {
    const handle = event.target.closest?.('.handle')
    if (!handle) return
    const row = handle.closest('tr')
    held = row.dataset.id
    row.classList.add('dragging')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', held)
      event.dataTransfer.setDragImage?.(row, 12, 12)
    }
  })
  body.addEventListener('dragover', (event) => {
    const over = target(event)
    if (!over) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    clear()
    if (over.id !== held) over.row.classList.add(over.after ? 'drop-after' : 'drop-before')
  })
  body.addEventListener('dragleave', (event) => {
    if (!body.contains(event.relatedTarget)) clear()
  })
  body.addEventListener('drop', (event) => {
    const over = target(event)
    if (!over) return
    event.preventDefault()
    clear()
    if (over.id === held) return
    const ids = get().map((each) => each.id)
    set(inOrder(get(), reordered(ids, held, over.id, over.after)))
    persist(kind)
  })
  body.addEventListener('dragend', () => {
    held = null
    clear()
    for (const node of body.querySelectorAll('.dragging')) node.classList.remove('dragging')
  })
}

dragRows('shortcuts')
dragRows('skills')

/** A row asked for by name — a new one, or one right-clicked in the Panel. */
function focusRow(kind, id) {
  const body = TABLES[kind]?.body
  const row = body?.querySelector(`tr[data-id="${CSS.escape(String(id))}"]`)
  if (!row) return
  for (const each of document.querySelectorAll('tr.editing')) each.classList.remove('editing')
  row.classList.add('editing')
  row.scrollIntoView({ block: 'nearest' })
  const name = row.querySelector('input.name')
  name.focus()
  name.select()
}

// --- The icon picker ---------------------------------------------------------

let picking = null

/** The picker, opened under a row's icon button: none, then the fifty. */
function openPicker(kind, id, anchor) {
  if (picking && picking.anchor === anchor) {
    closePicker()
    return
  }
  closePicker()
  const item = TABLES[kind].get().find((each) => each.id === id)
  if (!item) return
  picking = { kind, id, anchor }
  anchor.setAttribute('aria-expanded', 'true')
  parts.pickerTitle.textContent = `Icon for ${item.label || 'this button'}`
  parts.pickerGrid.textContent = ''
  for (const glyph of ['', ...GLYPHS]) {
    const choice = document.createElement('button')
    choice.type = 'button'
    choice.dataset.glyph = glyph
    choice.title = glyph || 'No icon'
    choice.setAttribute('aria-pressed', String((item.glyph ?? '') === glyph))
    if (glyph) choice.append(icon(glyph))
    else {
      const none = document.createElement('span')
      none.className = 'none'
      none.textContent = 'none'
      choice.append(none)
    }
    choice.addEventListener('click', () => {
      const chosen = TABLES[kind].get().find((each) => each.id === id)
      if (chosen) chosen.glyph = glyph || null
      closePicker()
      persist(kind)
    })
    parts.pickerGrid.append(choice)
  }
  parts.picker.hidden = false
  // Under the button, held inside the window.
  const at = anchor.getBoundingClientRect()
  const box = parts.picker.getBoundingClientRect()
  const left = Math.max(8, Math.min(at.left, innerWidth - box.width - 8))
  const below = at.bottom + 4
  const top = below + box.height + 8 > innerHeight ? Math.max(8, at.top - box.height - 4) : below
  parts.picker.style.left = `${left}px`
  parts.picker.style.top = `${top}px`
}

function closePicker() {
  if (!picking) return
  picking.anchor.setAttribute('aria-expanded', 'false')
  picking = null
  parts.picker.hidden = true
}

parts.pickerClose.addEventListener('click', closePicker)
document.addEventListener('mousedown', (event) => {
  if (picking && !parts.picker.contains(event.target) && !picking.anchor.contains(event.target)) closePicker()
})
// It stands where its button was: once a column scrolls or the window changes
// size, the button has moved and the picker would point at another row.
document.addEventListener(
  'scroll',
  (event) => {
    if (picking && !parts.picker.contains(event.target)) closePicker()
  },
  true,
)
window.addEventListener('resize', closePicker)

// --- Hooks -------------------------------------------------------------------

// `state` carries both halves: { hooks, config }. Connected means both are in
// place; Disconnect is offered whenever either is, so a half-done Connect — or
// one left behind by a folder that moved — can still be undone.
//
// `stale` is hooks of ours an older Jarvis wrote — the five from before the
// Deck, say. They are not "connected" (the Deck hears nothing through them),
// and they are not "nothing" either: Connect brings them up to date, and
// Disconnect takes them out. `problem` is why the last press failed; Connect
// takes back what it did when it fails, so the sheet is the only place left
// to say so.
//
// `elsewhere` is the folder of another Jarvis whose hooks — current ones —
// Claude Code carries: the Jarvis the user keeps, seen from a checkout, say.
// That one is connected and working, so it is named rather than called old,
// and Connect is offered as what it would do: take Claude Code over for this one.
function drawHooks(state) {
  const { hooks = false, config = false, stale = false, elsewhere = null, problem = null } = state || {}
  const both = hooks && config
  const either = hooks || config || stale || Boolean(elsewhere)
  const standing = both
    ? 'Connected — hooks, voice style and status line applied'
    : elsewhere
      ? `Connected to the Jarvis in ${elsewhere} — press Connect this one to use this Jarvis instead`
      : stale
        ? 'Out of date — an older Jarvis connected this machine; press Connect to bring it up to date'
        : either
          ? 'Half connected — press Disconnect, then Connect again'
          : 'Not connected — Jarvis is told nothing'
  parts.hooksText.textContent = problem ? `Couldn't finish: ${problem} (${standing})` : standing
  parts.installHooks.textContent = elsewhere && !both ? 'Connect this one' : 'Connect'
  parts.installHooks.disabled = both
  parts.removeHooks.disabled = !either
}

// --- Loading -----------------------------------------------------------------

/**
 * Reads everything and draws it. Run when the page loads and again each time
 * the sheet is opened, since the Spine, the theme or the side may have changed
 * meanwhile. A row still being typed survives a reload: it is in no store.
 */
async function load() {
  // Every one of these can fail: the settings file may be locked, and the speech
  // host may have died. A window that throws here would show a form full of
  // blanks with nothing to say for itself.
  try {
    stored = { ...DEFAULTS, ...(await window.jarvis.readPreferences()) }
  } catch {
    announce(parts.failed, 'Could not read your settings. Showing the defaults.')
  }

  models = await window.jarvis.readModels().catch(() => ({}))
  voices = await window.jarvis.readVoices().catch(() => [])
  const unfinished = (list) => list.filter((each) => !isFinished(each))
  shortcuts = [...(await window.jarvis.readShortcuts().catch(() => [])), ...unfinished(shortcuts)]
  skills = [...(await window.jarvis.readSkills().catch(() => [])), ...unfinished(skills)]

  applyTheme(stored.theme)
  mark(parts.language, stored.language)
  mark(parts.sides, stored.panelPosition)
  mark(parts.commandColumns, stored.commandColumns)
  mark(parts.skillColumns, stored.skillColumns)
  fillSizes()
  drawSpineList()
  parts.shell.value = stored.shell
  parts.rate.value = String(stored.speechRate ?? 0)
  parts.rateValue.textContent = describeRate(parts.rate.value)

  fillModels(stored.model ?? DEFAULTS.model)
  describeVoices({
    portuguese: fillVoices(parts.voicePt, PORTUGUESE, stored.voices?.[PORTUGUESE]),
    english: fillVoices(parts.voiceEn, ENGLISH, stored.voices?.[ENGLISH]),
  })
  closePicker()
  drawRows('shortcuts')
  drawRows('skills')
  drawHooks(await window.jarvis.hooksState().catch(() => false))
}

let ready = load()

// Opened again: read everything afresh. The side is this window's own, which
// the main process sends with the opening.
window.jarvis.onShown((shape) => {
  ready = ready.then(load).then(() => {
    if (shape?.position) mark(parts.sides, shape.position)
  })
})

// A right click on a Command or a Skill in the Panel: open at its row.
window.jarvis.onEdit(({ list, id } = {}) => {
  ready.then(() => focusRow(list, id))
})

// --- Wiring ------------------------------------------------------------------

parts.shell.addEventListener('change', async () => {
  const written = await save({ shell: parts.shell.value })
  if (written) parts.shell.value = written.shell
})

async function saveVoice(language, select) {
  const voicesByLanguage = { ...stored.voices }
  if (select.value === '') delete voicesByLanguage[language]
  else voicesByLanguage[language] = select.value
  save({ voices: voicesByLanguage })
}

parts.voicePt.addEventListener('change', () => saveVoice(PORTUGUESE, parts.voicePt))
parts.voiceEn.addEventListener('change', () => saveVoice(ENGLISH, parts.voiceEn))

parts.rate.addEventListener('input', () => {
  parts.rateValue.textContent = describeRate(parts.rate.value)
})
parts.rate.addEventListener('change', () => save({ speechRate: Number(parts.rate.value) }))

parts.addShortcut.addEventListener('click', () => {
  const fresh = TABLES.shortcuts.fresh()
  shortcuts.push(fresh)
  drawRows('shortcuts')
  focusRow('shortcuts', fresh.id)
})

parts.resetShortcuts.addEventListener('click', async () => {
  shortcuts = await window.jarvis.writeShortcuts([])
  drawRows('shortcuts')
  announce(parts.saved, 'Back to the defaults')
})

parts.addSkill.addEventListener('click', () => {
  const fresh = TABLES.skills.fresh()
  skills.push(fresh)
  drawRows('skills')
  focusRow('skills', fresh.id)
})

parts.installHooks.addEventListener('click', async () => {
  drawHooks(await window.jarvis.installHooks())
})

parts.removeHooks.addEventListener('click', async () => {
  drawHooks(await window.jarvis.removeHooks())
})

el('mic-settings').addEventListener('click', (event) => {
  event.preventDefault()
  window.jarvis.act('openWindowsMicrophoneSettings')
})

/**
 * Closes the sheet, keeping what is half typed: the box being typed in is left
 * first, so its change — a size, a name, a command — is saved as it would be
 * on a click elsewhere.
 */
function closeSheet() {
  const typing = document.activeElement
  if (typing instanceof HTMLInputElement) typing.blur()
  window.jarvis.close()
}

el('close').addEventListener('click', closeSheet)

// Escape closes the picker if it is open, and the sheet if it is not.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (picking) closePicker()
  else closeSheet()
})
