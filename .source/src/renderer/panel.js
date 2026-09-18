'use strict'

const el = (id) => document.getElementById(id)

const parts = {
  panel: el('panel'),
  head: el('head'),
  body: el('body'),
  sessionSection: el('session-section'),
  grip: el('grip'),
  bar: el('bar'),
  collapse: el('collapse'),
  movePanel: el('move-panel'),
  moveLabel: el('move-label'),

  projectWhere: el('project-where'),
  projectName: el('project-name'),
  live: el('live'),
  hooks: el('hooks'),
  openSession: el('open-session'),
  reopenProject: el('reopen-project'),
  reopenLabel: el('reopen-label'),
  endSession: el('end-session'),

  memoryToggle: el('memory-toggle'),
  autoRead: el('auto-read'),

  dock: el('dock'),
  dockState: el('dock-state'),
  wave: el('wave'),
  speakActions: el('speak-actions'),
  speakNote: el('speak-note'),
  dockEdit: el('dock-edit'),

  asked: el('asked'),
  permission: el('permission'),

  pauseSpeech: el('pause-speech'),
  pauseLabel: el('pause-label'),
  repeat: el('repeat'),
  stopSpeech: el('stop-speech'),
  copyAnswer: el('copy-answer'),
  pasteTerminal: el('paste-terminal'),
  openFolder: el('open-folder'),
  readingFill: el('reading-fill'),
  readingLabel: el('reading-label'),
  recentReadings: el('recent-readings'),
  readingHistory: el('reading-history'),

  downloading: el('downloading'),
  downloadFill: el('download-fill'),
  downloadLabel: el('download-label'),

  shortcuts: el('shortcuts'),
  skillsSection: el('skills-section'),
  skills: el('skills'),
  notices: el('notices'),
  noticeList: el('notice-list'),

  settings: el('settings'),
  theme: el('theme'),
  language: el('language'),

  barOpen: el('bar-open'),
  barSession: el('bar-session'),
  barCommands: el('bar-commands'),
  barSkills: el('bar-skills'),
  barMic: el('bar-mic'),
  barPause: el('bar-pause'),
  barPauseLabel: el('bar-pause-label'),
  barRepeat: el('bar-repeat'),
  barStop: el('bar-stop'),
  barCopy: el('bar-copy'),
  barPaste: el('bar-paste'),
  barFolder: el('bar-folder'),
  barSettings: el('bar-settings'),
  barMove: el('bar-move'),
  barMoveLabel: el('bar-move-label'),
}

const act = (name, argument) => window.jarvis.act(name, argument)

function show(node, text) {
  const has = typeof text === 'string' && text !== ''
  node.hidden = !has
  if (has) node.textContent = text
  return has
}

function icon(name) {
  const node = document.createElement('i')
  node.className = `ph ph-${name}`
  node.setAttribute('aria-hidden', 'true')
  return node
}

function button({ kind = 'secondary', label, glyph, onPress }) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = `btn btn-${kind}`
  if (glyph) node.append(icon(glyph))
  const text = document.createElement('span')
  text.textContent = label
  node.append(text)
  node.addEventListener('click', onPress)
  return node
}

function fill(container, buttons) {
  container.textContent = ''
  for (const each of buttons) container.append(each)
}

/** A switch that reads its own state: on is the tint, off is an outline. */
function switched(node, on) {
  node.setAttribute('aria-pressed', String(on))
}

function left(seconds) {
  const remaining = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(remaining / 60)
  const rest = String(remaining % 60).padStart(2, '0')
  return minutes > 0 ? `${minutes}:${rest} left` : `${remaining}s left`
}

function shortName(projectPath) {
  return String(projectPath).split(/[\\/]/).filter(Boolean).pop()
}

// --- Where the panel is ------------------------------------------------------

/**
 * The cycle the mover walks, and the arrow for each step.
 *
 * Spelt again here rather than imported: a renderer runs under
 * `default-src 'self'` with no module loader, so it cannot reach the core's
 * `geometry.js` — which is the file this has to agree with. The order is the
 * one thing that must match, and `nextPosition` there is where it is decided.
 */
const ORDER = ['left', 'top', 'right', 'bottom']
const ARROW = { left: 'caret-double-left', top: 'caret-double-up', right: 'caret-double-right', bottom: 'caret-double-down' }
const WHERE = { left: 'the left', top: 'the top', right: 'the right', bottom: 'the foot' }

function nextPosition(position) {
  const at = ORDER.indexOf(position)
  return ORDER[(at + 1) % ORDER.length]
}

/**
 * Which side the panel is on, whether it is shut, and where the mover points.
 *
 * Both attributes go on <body> because that is what the whole stylesheet reads;
 * `data-axis` is derived rather than sent, since left and right differ from top
 * and bottom only in which measure is the scarce one.
 */
function drawPlacement(state) {
  const position = ORDER.includes(state.panelPosition) ? state.panelPosition : 'right'
  const collapsed = Boolean(state.panelCollapsed)
  const side = position === 'left' || position === 'right'

  document.body.dataset.position = position
  document.body.dataset.axis = side ? 'side' : 'band'
  document.body.dataset.collapsed = String(collapsed)
  parts.bar.hidden = !collapsed

  // The Session pair has two homes: the page, down a side, where it is the
  // third block and scrolls with the rest; and under the session strip in a
  // band, where it makes the first column everything about the session and
  // leaves the middle to what you press. CSS cannot move a node between
  // parents, so the one function that knows the axis does it — and only when
  // the answer has changed, since this runs on every published state.
  const home = side ? parts.body : parts.head
  if (parts.sessionSection.parentElement !== home) {
    if (side) parts.body.insertBefore(parts.sessionSection, parts.downloading)
    else parts.head.append(parts.sessionSection)
  }
  // The handle separates two panes side by side or one above the other, and
  // which it is changes with the position — so it is set here rather than
  // written once into the page.
  parts.grip.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal')

  const next = nextPosition(position)
  const words = `Move the panel to ${WHERE[next]}`
  for (const [node, label] of [
    [parts.movePanel, parts.moveLabel],
    [parts.barMove, parts.barMoveLabel],
  ]) {
    node.firstElementChild.className = `ph ph-${ARROW[next]}`
    node.title = words
    label.textContent = words
  }
}

// --- Right now ---------------------------------------------------------------

/**
 * Which of the five things Jarvis can be doing is happening now.
 *
 * The order matters: dictation outranks a reading, because pressing the
 * microphone while an answer is being read stops the reading — so the two are
 * never both true for longer than one event.
 */
function phaseOf(state) {
  if (state.isListening && !state.isFinishingDictation) return 'listening'
  if (state.isFinishingDictation) return 'thinking'
  if (state.voice) return 'reading'
  // Whether there is a terminal to dictate into — not `hasLiveSession`, which
  // asks whether Claude Code has reported in. Open a project and you can speak
  // straight away; Claude Code only exists once you have typed `claude`, and
  // reading that as "no session" left the microphone unavailable in the state
  // people spend most of their time in.
  if (!state.projectName) return 'ready'
  return 'idle'
}

/**
 * The session strip: what is open, how it is doing, and the two switches that
 * outlast it. The two marks after the name are what the terminal's own header
 * used to carry, moved up over the thing they describe.
 */
function drawSession(state) {
  const hasProject = Boolean(state.projectName)
  parts.projectName.textContent = hasProject ? state.projectName : 'No session'
  parts.endSession.disabled = !hasProject

  // A band has nowhere to put the name or the path, so the glyph carries both.
  const where = state.projectPath ? `${state.projectPath} · ${state.shell ?? ''}`.trim() : ''
  parts.projectWhere.title = hasProject ? `${state.projectName}\n${where}` : 'No session'
  parts.projectWhere.className = hasProject ? 'ph ph-folder-open strip-glyph' : 'ph ph-folder strip-glyph'

  // Two different things, and both worth saying: a shell is open here, and
  // Claude Code is set up to tell Jarvis what happens in it.
  parts.live.hidden = !hasProject
  parts.hooks.hidden = !state.hooksInstalled

  // The one the button offers is this window's own last project, so it is named
  // rather than left as a generic "reopen".
  const last = state.lastProject ? shortName(state.lastProject) : ''
  parts.reopenProject.hidden = last === ''
  if (last !== '') {
    parts.reopenProject.title = `Reopen ${last}`
    parts.reopenLabel.textContent = `Reopen ${last}`
  }

  switched(parts.memoryToggle, Boolean(state.useMemory))
  switched(parts.autoRead, Boolean(state.autoRead))
  // Cut through when it is off, so the switch reads from the glyph alone in a
  // band where the word is gone.
  parts.autoRead.firstElementChild.className = state.autoRead
    ? 'ph ph-speaker-high'
    : 'ph ph-speaker-slash'
}

/**
 * The dock: what Jarvis is doing with your voice, the microphone, the reading,
 * and what the answer can be used for. One card, tinted while your voice is
 * being worked on and plain while it is waiting for you — that tint is the
 * whole signal.
 */
function drawDock(state) {
  const phase = phaseOf(state)
  const hasProject = Boolean(state.projectName)
  const listening = phase === 'listening'
  const thinking = phase === 'thinking'
  const reading = Boolean(state.voice)
  const preparing = state.voice?.phase === 'preparing'

  parts.dock.classList.toggle('tinted', listening || thinking || reading)
  parts.wave.hidden = !listening
  parts.dockState.textContent = listening
    ? 'Listening to you'
    : thinking
      ? 'Working out what you said'
      : reading
        ? preparing
          ? 'Preparing…'
          : 'Reading the answer'
        : state.lastPermissionDetail
          ? 'Waiting on your answer'
          : hasProject
            ? 'Ready to listen'
            : 'No session yet'

  if (listening) {
    fill(parts.speakActions, [
      button({ kind: 'primary', label: 'Finish', glyph: 'check', onPress: () => act('micPressed') }),
      button({ label: 'Cancel', onPress: () => act('cancelDictation') }),
    ])
    show(parts.speakNote, 'Nothing is submitted for you — Enter stays yours.')
  } else if (thinking) {
    fill(parts.speakActions, [])
    parts.speakNote.hidden = true
  } else {
    const speak = button({
      kind: 'primary',
      label: 'Speak',
      glyph: 'microphone',
      onPress: () => act('micPressed'),
    })
    speak.disabled = !hasProject
    fill(parts.speakActions, [speak])
    parts.speakNote.hidden = hasProject
    if (!hasProject) show(parts.speakNote, 'Dictation needs a live session. Open one above.')
  }

  // The shut bar's microphone is the same control and says the same thing —
  // including while the recogniser is working, when the open dock has nothing to
  // press. The bar cannot show nothing, so it shows the button unpressable.
  parts.barMic.disabled = thinking || !(hasProject || listening)
  parts.barMic.classList.toggle('listening', listening)
  parts.barMic.title = listening ? 'Finish' : 'Speak'
  parts.barMic.firstElementChild.className = listening ? 'ph ph-check' : 'ph ph-microphone'

  drawReading(state, preparing)
}

/** The reading in progress: how far through it is, and the four controls. */
function drawReading(state, preparing) {
  parts.stopSpeech.disabled = !state.isSpeaking
  // Nothing to press while the voice is still being made: there is no sound to
  // read again until there is a sound.
  parts.repeat.disabled = !state.lastAssistantText || preparing

  // Hold and let-go: the same button, its face and action following the state.
  // Only a reading actually playing can be held — not one still being made.
  const playing = state.isSpeaking && state.voice?.phase === 'playing'
  const paused = Boolean(state.isPaused)
  parts.pauseSpeech.disabled = !playing
  parts.pauseSpeech.title = paused ? 'resume' : 'pause'
  parts.pauseLabel.textContent = paused ? 'resume' : 'pause'
  parts.pauseSpeech.firstElementChild.className = paused ? 'ph ph-play' : 'ph ph-pause'
  parts.pauseSpeech.dataset.mode = paused ? 'resume' : 'pause'

  // The shut bar carries the same three, so a reading can be held, heard again
  // or ended without opening the panel. They are read off the dock's own
  // buttons rather than worked out a second time: one answer, two faces.
  parts.barStop.disabled = parts.stopSpeech.disabled
  parts.barRepeat.disabled = parts.repeat.disabled
  parts.barPause.disabled = parts.pauseSpeech.disabled
  parts.barPause.title = parts.pauseSpeech.title
  parts.barPauseLabel.textContent = parts.pauseLabel.textContent
  parts.barPause.firstElementChild.className = parts.pauseSpeech.firstElementChild.className
  parts.barPause.dataset.mode = parts.pauseSpeech.dataset.mode

  const share =
    state.voice && !preparing && state.voice.seconds > 0
      ? Math.min(1, state.voice.at / state.voice.seconds)
      : 0
  parts.readingFill.style.width = preparing ? '100%' : `${Math.round(share * 100)}%`
  parts.readingFill.classList.toggle('waiting', preparing)

  // The edit group shares the dock but does not follow the reading. What can be
  // copied is whatever was last said, read aloud or not; pasting and opening the
  // folder only ever needed somewhere to paste into and a folder to open.
  const hasAnswer = Boolean(state.lastAssistantText)
  const hasProject = Boolean(state.projectName)
  parts.copyAnswer.disabled = !hasAnswer
  parts.pasteTerminal.disabled = !hasProject
  parts.openFolder.disabled = !hasProject
  parts.barCopy.disabled = !hasAnswer
  parts.barPaste.disabled = !hasProject
  parts.barFolder.disabled = !hasProject

  // The row is always here, so with nothing being read it says so with a dash
  // rather than a zero — there is no number, not a number that is zero.
  parts.readingLabel.textContent = !state.voice
    ? '—'
    : preparing
      ? 'Preparing…'
      : left(state.voice.seconds - state.voice.at)
}

/** The last few readings, each a button that plays its stored audio again. */
function drawReadingHistory(list) {
  parts.readingHistory.textContent = ''
  parts.recentReadings.hidden = list.length === 0
  for (const item of list) {
    const entry = document.createElement('li')
    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'history-item'
    play.title = 'Play this reading again'
    play.innerHTML = '<i class="ph ph-play" aria-hidden="true"></i>'
    const text = document.createElement('span')
    text.className = 'history-text'
    text.textContent = item.title || 'A reading'
    play.append(text)
    play.addEventListener('click', () => act('replayReading', item.id))
    entry.append(play)
    parts.readingHistory.append(entry)
  }
}

function drawShortcuts(list) {
  parts.shortcuts.textContent = ''
  for (const shortcut of list) {
    const node = button({
      label: shortcut.label,
      onPress: () => act('pressShortcut', shortcut.id),
    })
    node.title = shortcut.submits ? shortcut.command : `${shortcut.command} (not submitted)`
    parts.shortcuts.append(node)
  }
}

/** The Skills block, shown only once there is a skill to show. */
function drawSkills(list) {
  parts.skillsSection.hidden = list.length === 0
  parts.barSkills.disabled = list.length === 0
  parts.skills.textContent = ''
  for (const item of list) {
    const node = button({
      label: item.label,
      onPress: () => act('pressSkill', item.id),
    })
    node.title = item.submits ? item.command : `${item.command} (not submitted)`
    parts.skills.append(node)
  }
}

/**
 * A card per notice, each with a 3px mark down its left edge: the accent for
 * something worth knowing, grey for something that went wrong. It replaced four
 * differently coloured paragraphs that each had to be read to find out which
 * kind they were.
 */
function noticeCard({ mark, title, body, link, actions = [] }) {
  const card = document.createElement('div')
  card.className = `card ${mark}`

  if (title) {
    const heading = document.createElement('div')
    heading.className = 'notice-title'
    heading.textContent = title
    card.append(heading)
  }

  if (body || link) {
    const text = document.createElement('div')
    text.className = 'notice-body'
    if (body) text.append(body)
    if (link) {
      const anchor = document.createElement('a')
      anchor.href = '#'
      anchor.textContent = link.label
      anchor.addEventListener('click', (event) => {
        event.preventDefault()
        link.onPress()
      })
      text.append(' ', anchor)
    }
    card.append(text)
  }

  if (actions.length > 0) {
    const row = document.createElement('div')
    row.className = 'notice-actions'
    for (const each of actions) row.append(each)
    card.append(row)
  }

  return card
}

function drawNotices(state) {
  const cards = []
  const dismiss = [
    button({ kind: 'ghost', label: 'Dismiss', onPress: () => act('dismissMessage') }),
  ]

  if (state.notice) {
    cards.push(noticeCard({ mark: 'card-marked', title: state.notice, actions: dismiss }))
  }
  if (state.message) {
    cards.push(
      noticeCard({
        mark: 'card-marked-quiet',
        body: state.message,
        actions: state.notice ? [] : dismiss,
      }),
    )
  }
  if (state.problem) {
    cards.push(
      noticeCard({
        mark: 'card-marked-neutral',
        title: state.problem,
        actions: state.notice || state.message ? [] : dismiss,
      }),
    )
  }
  if (!state.hooksInstalled) {
    cards.push(
      noticeCard({
        mark: 'card-marked-quiet',
        title: 'Claude Code is not reporting',
        body: 'Jarvis will not learn when an answer finishes.',
        link: { label: 'Connect it', onPress: () => act('installHooks') },
      }),
    )
  }
  // Put once per machine. Answered either way, it does not come back — the
  // Maestro carries its own copies of these skills, so this is only ever an
  // offer of a newer set.
  if (state.maestroOffer) {
    cards.push(
      noticeCard({
        mark: 'card-marked-quiet',
        title: 'The Maestro can read a newer set of skills',
        body:
          'It works without them, from the copies Jarvis carries. Install runs ' +
          `${state.maestroInstallCommand ?? ''} in this project's terminal.`,
        actions: [
          button({ kind: 'primary', label: 'Install', onPress: () => act('installSkillsPackage') }),
          button({ kind: 'ghost', label: 'No thanks', onPress: () => act('declineSkillsPackage') }),
        ],
      }),
    )
  }

  parts.noticeList.textContent = ''
  for (const card of cards) parts.noticeList.append(card)
  parts.notices.hidden = cards.length === 0
}

function drawSegments(state) {
  for (const option of parts.theme.children) {
    option.setAttribute('aria-checked', String(option.dataset.themeName === state.theme))
  }
  for (const option of parts.language.children) {
    option.setAttribute('aria-checked', String(option.dataset.language === state.languageLabel))
  }
}

// --- The whole panel ---------------------------------------------------------

function draw(state) {
  document.documentElement.dataset.theme = state.theme ?? 'dark'

  drawPlacement(state)
  drawSession(state)

  parts.asked.hidden = !show(parts.permission, state.lastPermissionDetail)

  drawDock(state)
  drawReadingHistory(state.recentReadings ?? [])

  const downloading = typeof state.downloading === 'number'
  parts.downloading.hidden = !downloading
  if (downloading) {
    parts.downloadFill.style.width = `${state.downloading}%`
    parts.downloadLabel.textContent = `${state.downloading}%`
  }

  drawShortcuts(state.shortcuts ?? [])
  drawSkills(state.skills ?? [])
  drawNotices(state)
  drawSegments(state)
  measure()
}

// --- What the room allows ----------------------------------------------------

/**
 * Nothing here is hidden by a breakpoint. This reads a real measurement,
 * because a window is not the thing being measured — the row is.
 *
 * The edit group carries its labels while all three fit, and down a side that
 * is guaranteed by construction, the panel never being narrower than 316.
 *
 * There used to be a second measurement beside it, hiding the Session block in
 * a band under a width it was the reason for exceeding. It went when the block
 * moved into the band's first column: it costs the row of buttons nothing from
 * there, so hiding it bought nothing back.
 */
const EDIT_LABELS_NEED = 240

function measure() {
  const edit = parts.dockEdit.clientWidth
  // While the panel is shut it measures zero, and the answer then is whatever
  // it will be when it opens — which is measured again the moment it does.
  if (edit > 0) document.body.dataset.edit = edit >= EDIT_LABELS_NEED ? 'wide' : 'tight'
}

new ResizeObserver(measure).observe(parts.panel)
new ResizeObserver(measure).observe(parts.dockEdit)

// --- The two sounds ----------------------------------------------------------

let audio = null

/**
 * Made here rather than shipped as files: two clean tones need no assets, and a
 * permission request has to be told from an answer by ear alone.
 */
function playSound(sound) {
  audio = audio ?? new AudioContext()
  const notes =
    sound === 'permissionNeeded'
      ? [
          { at: 0, frequency: 880, length: 0.16 },
          { at: 0.22, frequency: 587, length: 0.28 },
        ]
      : sound === 'listeningStarted'
        ? [{ at: 0, frequency: 660, length: 0.12 }]
        : [{ at: 0, frequency: 440, length: 0.12 }]

  for (const note of notes) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = note.frequency
    // A hard start and stop clicks; a short ramp does not.
    gain.gain.setValueAtTime(0, audio.currentTime + note.at)
    gain.gain.linearRampToValueAtTime(0.16, audio.currentTime + note.at + 0.015)
    gain.gain.linearRampToValueAtTime(0, audio.currentTime + note.at + note.length)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(audio.currentTime + note.at)
    oscillator.stop(audio.currentTime + note.at + note.length + 0.02)
  }
}

// --- Wiring ------------------------------------------------------------------

parts.settings.addEventListener('click', () => window.jarvis.openSettings())
parts.barSettings.addEventListener('click', () => window.jarvis.openSettings())
parts.openSession.addEventListener('click', () => act('openSession'))
parts.barSession.addEventListener('click', () => act('openSession'))
parts.reopenProject.addEventListener('click', () => act('reopenLastProject'))
parts.endSession.addEventListener('click', () => act('closeSession'))
// The reading controls, in the dock and on the shut bar: the same three
// actions, and the hold reads its own face to know which of the two it is.
for (const node of [parts.repeat, parts.barRepeat]) {
  node.addEventListener('click', () => act('repeatLast'))
}
for (const node of [parts.stopSpeech, parts.barStop]) {
  node.addEventListener('click', () => act('stopSpeech'))
}
for (const node of [parts.pauseSpeech, parts.barPause]) {
  node.addEventListener('click', () => {
    act(node.dataset.mode === 'resume' ? 'resumeSpeech' : 'pauseSpeech')
  })
}
parts.barMic.addEventListener('click', () => act('micPressed'))

/**
 * The answer to "did that work?" is the button itself, for a moment.
 *
 * A notice card would have to be dismissed, and these are things you do all day.
 * A line of text beside the button was the other option and it does not fit in a
 * band, so the confirmation is the glyph turning into a tick and back.
 */
const TICK = 1400
const ticking = new WeakMap()

function confirms(node, glyph, onPress) {
  node.addEventListener('click', () => {
    onPress()
    clearTimeout(ticking.get(node))
    node.firstElementChild.className = 'ph ph-check'
    ticking.set(
      node,
      setTimeout(() => {
        node.firstElementChild.className = `ph ph-${glyph}`
      }, TICK),
    )
  })
}

confirms(parts.copyAnswer, 'copy', () => act('copyAnswer'))
confirms(parts.pasteTerminal, 'clipboard', () => act('pasteIntoTerminal'))
confirms(parts.openFolder, 'arrow-square-out', () => act('openProjectFolder'))
confirms(parts.barCopy, 'copy', () => act('copyAnswer'))
confirms(parts.barPaste, 'clipboard', () => act('pasteIntoTerminal'))
confirms(parts.barFolder, 'arrow-square-out', () => act('openProjectFolder'))

parts.memoryToggle.addEventListener('click', () => {
  act('setUseMemory', parts.memoryToggle.getAttribute('aria-pressed') !== 'true')
})
parts.autoRead.addEventListener('click', () => {
  act('setAutoRead', parts.autoRead.getAttribute('aria-pressed') !== 'true')
})

// Moving and shutting, from the footer and from the shut bar alike — the same
// button in both states, which is what makes the pair one control rather than
// two that have to be told apart.
parts.movePanel.addEventListener('click', () => act('movePanel'))
parts.barMove.addEventListener('click', () => act('movePanel'))
parts.collapse.addEventListener('click', () => act('togglePanelCollapsed'))
parts.barOpen.addEventListener('click', () => act('togglePanelCollapsed'))

// Shut, Commands and Skills open the panel rather than growing a menu of their
// own: nothing in here goes behind a disclosure.
parts.barCommands.addEventListener('click', () => act('togglePanelCollapsed'))
parts.barSkills.addEventListener('click', () => act('togglePanelCollapsed'))

for (const option of parts.theme.children) {
  option.addEventListener('click', () => act('setTheme', option.dataset.themeName))
}

for (const option of parts.language.children) {
  option.addEventListener('click', () => {
    // Two languages, so the core has a toggle rather than a setter. Pressing the
    // one already chosen must not swap it for the other.
    if (option.getAttribute('aria-checked') !== 'true') act('toggleLanguage')
  })
}

window.jarvis.onState(draw)
window.jarvis.onSound(playSound)
window.jarvis.readState().then(draw)

// One window, two panes: clicking in here takes the cursor out of the terminal,
// which is never what the user meant. It goes back as soon as the click is done.
document.addEventListener('mouseup', () => window.jarvis.releaseFocus())

// --- Dragging the panel ------------------------------------------------------

// The new measure is taken from how far the pointer has moved, not from where it
// is: this pane's own coordinates shift as the panel resizes underneath it, so a
// pointer position would fight the edge it is dragging. Which way is "bigger"
// depends on which edge is being held — the panel always grows away from the
// terminal. The main process clamps whatever arrives; the renderer does not know
// the terminal's floor.
const GROWS = { left: 1, top: 1, right: -1, bottom: -1 }

let drag = null

parts.grip.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  const position = document.body.dataset.position
  const side = position === 'left' || position === 'right'
  drag = {
    from: side ? window.innerWidth : window.innerHeight,
    moved: 0,
    side,
    way: GROWS[position] ?? -1,
  }
  parts.grip.setPointerCapture(event.pointerId)
  event.preventDefault()
})

parts.grip.addEventListener('pointermove', (event) => {
  if (!drag) return
  drag.moved += drag.side ? event.movementX : event.movementY
  act('resizePanel', drag.from + drag.way * drag.moved)
})

for (const ending of ['pointerup', 'pointercancel']) {
  parts.grip.addEventListener(ending, () => {
    if (!drag) return
    drag = null
    // Written down once, at the end. The pointer reports every few
    // milliseconds, and a preferences file rewritten at that rate is a file
    // being rewritten while it is being read.
    act('rememberPanelMeasure')
  })
}

// --- Playing the reading -----------------------------------------------------

let playing = null
let watching = null

/**
 * The reading arrives as a WAV and is played here, where the AudioContext
 * already lives for the two alert sounds. Position is reported back four times
 * a second: often enough for the bar to move smoothly, seldom enough not to
 * flood the main process.
 */
async function playVoice(wav) {
  stopVoice({ quietly: true })
  audio = audio ?? new AudioContext()
  // A previous reading may have been paused, which suspends the whole context.
  // A new reading must always sound, so the hold is lifted before it starts.
  if (audio.state === 'suspended') audio.resume()

  let buffer
  try {
    buffer = await audio.decodeAudioData(wav)
  } catch {
    window.jarvis.voiceEnded()
    return
  }

  const source = audio.createBufferSource()
  source.buffer = buffer
  source.connect(audio.destination)

  const startedAt = audio.currentTime
  const seconds = buffer.duration
  source.onended = () => {
    if (playing !== source) return
    stopVoice({ quietly: true })
    window.jarvis.voiceEnded()
  }
  source.start()
  playing = source
  window.jarvis.voiceAt({ at: 0, seconds })

  watching = setInterval(() => {
    if (!playing) return
    // While held, the clock is frozen and the position cannot have moved, so
    // there is nothing to report — and reporting it anyway republishes the whole
    // state four times a second for the length of the pause.
    if (audio.state === 'suspended') return
    window.jarvis.voiceAt({ at: audio.currentTime - startedAt, seconds })
  }, 250)
}

function stopVoice({ quietly = false } = {}) {
  clearInterval(watching)
  watching = null
  // Stopping while held would otherwise leave the context suspended, and the
  // next reading silent; lift the hold so a stop always lands the context clean.
  if (audio && audio.state === 'suspended') audio.resume()
  if (!playing) return
  const source = playing
  playing = null
  try {
    source.onended = null
    source.stop()
  } catch {
    // Already finished; nothing left to stop.
  }
  if (!quietly) window.jarvis.voiceEnded()
}

window.jarvis.onVoicePlay(playVoice)
window.jarvis.onVoiceStop(() => stopVoice({ quietly: true }))

// Pause and resume hold the whole audio context. The reading is the only
// sustained sound, so suspending it freezes the playback exactly where it is,
// and the position bar — driven by the context clock — stops with it. The
// reading is never torn down, so resuming carries straight on from the hold.
window.jarvis.onVoicePause(() => {
  if (audio && playing) audio.suspend()
})
window.jarvis.onVoiceResume(() => {
  if (audio && playing) audio.resume()
})
