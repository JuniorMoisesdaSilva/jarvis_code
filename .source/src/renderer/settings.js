'use strict'

const el = (id) => document.getElementById(id)

const parts = {
  hooksText: el('hooks-text'),
  installHooks: el('install-hooks'),
  removeHooks: el('remove-hooks'),
  shell: el('shell'),
  terminalFont: el('terminal-font'),
  terminalFontValue: el('terminal-font-value'),
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
  saved: el('saved'),
  failed: el('failed'),
}

const PORTUGUESE = 'pt-BR'
const ENGLISH = 'en-US'

/** Where this machine keeps the switch or the list, named as the user knows it. */
const SETTINGS_APP = window.jarvis?.platform === 'darwin' ? 'System Settings' : 'Windows settings'

// The link out to the system names the place the user actually has to go, which
// is not the same place on both. Written here rather than in the markup so there
// is one platform check and not two copies of the sentence.
el('mic-settings').textContent = `Open the microphone switch in ${SETTINGS_APP}`

/** Only for the case where the settings themselves cannot be read. */
const DEFAULTS = Object.freeze({
  theme: 'dark',
  shell: window.jarvis?.platform === 'win32' ? 'powershell.exe' : '/bin/zsh',
  terminalFontSize: 13.5,
  model: 'medium',
  voices: {},
  speechRate: 0,
})

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
  try {
    const written = await window.jarvis.writePreferences(patch)
    announce(parts.saved, 'Saved')
    return written
  } catch {
    announce(parts.failed, 'Could not save. Check that Jarvis can write to your AppData folder.')
    return null
  }
}

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
  parts.model.textContent = ''
  parts.modelField.hidden = Object.keys(models).length < 2
  for (const [name, model] of Object.entries(models)) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'seg-opt'
    option.setAttribute('role', 'radio')
    option.textContent = name
    option.title = `${model.label}, ${sizeOf(model)}`
    option.addEventListener('click', () => {
      if (option.getAttribute('aria-checked') === 'true') return
      markModel(name)
      save({ model: name })
    })
    parts.model.append(option)
  }
  markModel(chosen)
}

function markModel(chosen) {
  for (const option of parts.model.children) {
    option.setAttribute('aria-checked', String(option.textContent === chosen))
  }
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
  parts.modelNote.textContent = model ? `${model.label} — ${sizeOf(model)}. ${model.note}` : ''
}

// --- Command buttons ---------------------------------------------------------

function describeRate(value) {
  const number = Number(value)
  if (number === 0) return 'normal'
  return number < 0 ? `${-number} slower` : `${number} faster`
}

/**
 * One editable row of a button table. Shared by the Command and Skill editors,
 * which differ only in the list they edit and how it is saved — the row itself
 * is the same three inputs and a Remove.
 */
function buildRow(getList, index, persist) {
  const item = getList()[index]
  const row = document.createElement('tr')

  // Every handler looks the list up fresh through getList(): a save with
  // redraw:false replaces the module array with a stored one, so a captured
  // reference would edit the old array while persist reads the new, silently
  // dropping the edit. Reading it live keeps the two the same array.
  const label = document.createElement('input')
  label.type = 'text'
  label.className = 'input'
  label.value = item.label
  label.addEventListener('change', () => {
    getList()[index].label = label.value
    persist({ redraw: false })
  })

  const command = document.createElement('input')
  command.type = 'text'
  command.className = 'input command'
  command.spellcheck = false
  command.value = item.command
  command.addEventListener('change', () => {
    getList()[index].command = command.value
    persist({ redraw: false })
  })

  const submits = document.createElement('input')
  submits.type = 'checkbox'
  submits.checked = item.submits
  submits.title = 'Press Enter after typing the command'
  submits.addEventListener('change', () => {
    getList()[index].submits = submits.checked
    persist({ redraw: false })
  })

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'btn btn-secondary'
  remove.textContent = 'Remove'
  remove.addEventListener('click', () => {
    getList().splice(index, 1)
    persist()
  })

  for (const [child, middle] of [
    [label, false],
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

function drawShortcuts() {
  parts.rows.textContent = ''
  shortcuts.forEach((_, index) =>
    parts.rows.append(buildRow(() => shortcuts, index, persistShortcuts)),
  )
}

function drawSkills() {
  parts.skillRows.textContent = ''
  skills.forEach((_, index) => parts.skillRows.append(buildRow(() => skills, index, persistSkills)))
}

/** Saves the finished skills, leaving a half-typed row alone, like commands. */
async function persistSkills({ redraw = true } = {}) {
  const finished = skills.filter(isFinished)
  const unfinished = skills.filter((each) => !isFinished(each))

  try {
    const stored = await window.jarvis.writeSkills(finished)
    skills = finished.length === 0 ? unfinished : [...stored, ...unfinished]
    if (redraw) drawSkills()
    announce(parts.saved, 'Saved')
  } catch {
    announce(parts.failed, 'Could not save the skills.')
  }
}

/**
 * Saves the buttons that are finished, and leaves the one being filled in alone.
 *
 * Storing a button with no command would put a dead button in the Panel; but
 * pruning it here would make the half-typed row disappear the moment the label
 * loses focus, so a new button could only ever be made command-first.
 */
async function persistShortcuts({ redraw = true } = {}) {
  const finished = shortcuts.filter(isFinished)
  const unfinished = shortcuts.filter((each) => !isFinished(each))

  try {
    const stored = await window.jarvis.writeShortcuts(finished)
    // The store answers with the built-in seven when handed an empty list, which
    // would wipe a row still being typed. Only take its answer when it is ours.
    shortcuts = finished.length === 0 ? unfinished : [...stored, ...unfinished]
    if (redraw) drawShortcuts()
    announce(parts.saved, 'Saved')
  } catch {
    announce(parts.failed, 'Could not save the buttons.')
  }
}

function isFinished(shortcut) {
  return shortcut.label.trim() !== '' && shortcut.command.trim() !== ''
}

// --- Hooks -------------------------------------------------------------------

// `state` carries both halves: { hooks, config }. Connected means both are in
// place; Disconnect is offered whenever either is, so a half-done Connect — or
// one left behind by a folder that moved — can still be undone.
function drawHooks(state) {
  const { hooks = false, config = false } = state || {}
  const both = hooks && config
  const either = hooks || config
  parts.hooksText.textContent = both
    ? 'Connected — hooks, voice style and status line applied'
    : either
      ? 'Half connected — press Disconnect, then Connect again'
      : 'Not connected — Jarvis is told nothing'
  parts.installHooks.disabled = both
  parts.removeHooks.disabled = !either
}

// --- Loading -----------------------------------------------------------------

async function load() {
  // Every one of these can fail: the settings file may be locked, and the speech
  // host may have died. A window that throws here would show a form full of
  // blanks with nothing to say for itself.
  let stored = DEFAULTS
  try {
    stored = await window.jarvis.readPreferences()
  } catch {
    announce(parts.failed, 'Could not read your settings. Showing the defaults.')
  }

  models = await window.jarvis.readModels().catch(() => ({}))
  voices = await window.jarvis.readVoices().catch(() => [])
  shortcuts = await window.jarvis.readShortcuts().catch(() => [])
  skills = await window.jarvis.readSkills().catch(() => [])

  applyTheme(stored.theme)
  parts.shell.value = stored.shell
  parts.terminalFont.value = String(stored.terminalFontSize ?? DEFAULTS.terminalFontSize)
  parts.terminalFontValue.textContent = parts.terminalFont.value
  parts.rate.value = String(stored.speechRate ?? 0)
  parts.rateValue.textContent = describeRate(parts.rate.value)

  fillModels(stored.model ?? DEFAULTS.model)
  describeVoices({
    portuguese: fillVoices(parts.voicePt, PORTUGUESE, stored.voices?.[PORTUGUESE]),
    english: fillVoices(parts.voiceEn, ENGLISH, stored.voices?.[ENGLISH]),
  })
  drawShortcuts()
  drawSkills()
  drawHooks(await window.jarvis.hooksState().catch(() => false))
}

// --- Theme -------------------------------------------------------------------

/**
 * The sheet is a third renderer, so it has to be told the theme like the other
 * two. It is only ever changed from the rail — there is no control here — but
 * it can be open when that happens.
 */
function applyTheme(name) {
  document.documentElement.dataset.theme = ['dark', 'light', 'iron'].includes(name) ? name : 'dark'
}

window.jarvis.onTheme(applyTheme)

// --- Wiring ------------------------------------------------------------------

parts.shell.addEventListener('change', async () => {
  const written = await save({ shell: parts.shell.value })
  if (written) parts.shell.value = written.shell
})

async function saveVoice(language, select) {
  const stored = await window.jarvis.readPreferences()
  const voicesByLanguage = { ...stored.voices }
  if (select.value === '') delete voicesByLanguage[language]
  else voicesByLanguage[language] = select.value
  save({ voices: voicesByLanguage })
}

parts.voicePt.addEventListener('change', () => saveVoice(PORTUGUESE, parts.voicePt))
parts.voiceEn.addEventListener('change', () => saveVoice(ENGLISH, parts.voiceEn))

// The number follows the thumb, but nothing is written until it is let go: a
// drag from 9 to 24 would otherwise be thirty saves and thirty reflows of the
// shell.
parts.terminalFont.addEventListener('input', () => {
  parts.terminalFontValue.textContent = parts.terminalFont.value
})
parts.terminalFont.addEventListener('change', () =>
  save({ terminalFontSize: Number(parts.terminalFont.value) }),
)

parts.rate.addEventListener('input', () => {
  parts.rateValue.textContent = describeRate(parts.rate.value)
})
parts.rate.addEventListener('change', () => save({ speechRate: Number(parts.rate.value) }))

parts.addShortcut.addEventListener('click', () => {
  shortcuts.push({ id: `new-${Date.now()}`, label: 'New', command: '', submits: true })
  drawShortcuts()
})

parts.resetShortcuts.addEventListener('click', async () => {
  shortcuts = await window.jarvis.writeShortcuts([])
  drawShortcuts()
  announce(parts.saved, 'Back to the defaults')
})

parts.addSkill.addEventListener('click', () => {
  // A skill does not submit by default: its command is often typed with an
  // argument after it, so pressing Enter is left to you.
  skills.push({ id: `new-${Date.now()}`, label: 'New skill', command: '', submits: false })
  drawSkills()
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

load()

document.getElementById('close').addEventListener('click', () => window.jarvis.close())
