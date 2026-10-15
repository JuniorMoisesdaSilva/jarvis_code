'use strict'

const el = (id) => document.getElementById(id)

const parts = {
  panel: el('panel'),
  body: el('body'),
  spine: el('spine'),
  spineParts: el('spine-parts'),
  commandsSection: el('commands-section'),
  sessionSection: el('session-section'),
  grip: el('grip'),
  collapse: el('collapse'),
  collapseLabel: el('collapse-label'),
  spineMic: el('spine-mic'),
  spineMicLabel: el('spine-mic-label'),
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

  memory: el('memory'),
  autoRead: el('auto-read'),

  deck: el('deck'),
  deckSilent: el('deck-silent'),
  deckChips: el('deck-chips'),

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
  themeLabel: el('theme-label'),
  language: el('language'),

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

/** A glyph alone, drawn like the reading controls; the word is its title. */
function iconButton({ label, glyph, quiet = false, onPress }) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = quiet ? 'icon-btn icon-btn-bare icon-btn-quiet' : 'icon-btn icon-btn-bare'
  node.title = label
  node.setAttribute('aria-label', label)
  node.append(icon(glyph))
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
  // Shut, the Panel is its Spine; the button that shut it opens it again.
  const shutWords = collapsed ? 'Open the panel' : 'Shut the panel'
  parts.collapse.title = shutWords
  parts.collapseLabel.textContent = shutWords

  // The handle separates two panes side by side or one above the other, and
  // which it is changes with the position — so it is set here rather than
  // written once into the page.
  parts.grip.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal')

  const next = nextPosition(position)
  const words = `Move the panel to ${WHERE[next]}`
  parts.movePanel.firstElementChild.className = `ph ph-${ARROW[next]}`
  parts.movePanel.title = words
  parts.moveLabel.textContent = words
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

  // The microphone heads the reading controls and is drawn like them. Finish
  // takes its place while listening, so the second press lands where the first
  // did, and Cancel the room beside it the slot keeps for it.
  if (listening) {
    fill(parts.speakActions, [
      iconButton({ label: 'Finish', glyph: 'check', onPress: () => act('micPressed') }),
      iconButton({ label: 'Cancel', glyph: 'x', quiet: true, onPress: () => act('cancelDictation') }),
    ])
    show(parts.speakNote, 'Nothing is submitted for you — Enter stays yours.')
  } else if (thinking) {
    // Nothing to press while the recogniser works, but the microphone stays in
    // its place, unpressable — as the shut Spine's does.
    const speak = iconButton({ label: 'Speak', glyph: 'microphone', onPress: () => act('micPressed') })
    speak.disabled = true
    fill(parts.speakActions, [speak])
    parts.speakNote.hidden = true
  } else {
    const speak = iconButton({ label: 'Speak', glyph: 'microphone', onPress: () => act('micPressed') })
    speak.disabled = !hasProject
    fill(parts.speakActions, [speak])
    parts.speakNote.hidden = hasProject
    if (!hasProject) show(parts.speakNote, 'Dictation needs a live session. Open one above.')
  }

  // The shut Spine's microphone is the same control and says the same thing —
  // including while the recogniser is working, when the open dock has nothing
  // to press. The Spine cannot show nothing, so it shows the button unpressable.
  parts.spineMic.disabled = thinking || !(hasProject || listening)
  parts.spineMic.classList.toggle('listening', listening)
  parts.spineMic.title = listening ? 'Finish' : 'Speak'
  parts.spineMicLabel.textContent = listening ? 'Finish' : 'Speak'
  parts.spineMic.firstElementChild.className = listening ? 'ph ph-check' : 'ph ph-microphone'

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

  // The row is always here, so with nothing being read it says so with a dash
  // rather than a zero — there is no number, not a number that is zero.
  parts.readingLabel.textContent = !state.voice
    ? '—'
    : preparing
      ? 'Preparing…'
      : left(state.voice.seconds - state.voice.at)
}

/**
 * The last few readings, each a button that plays its stored audio again.
 * Shown while its Part is on and there is something in it: with nothing read
 * yet the section stays out of the page, as it always did, and its button on
 * the Spine still says it is on.
 */
function drawReadingHistory(list, on) {
  parts.readingHistory.textContent = ''
  parts.recentReadings.hidden = !on || list.length === 0
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

/**
 * The core's button-look.js, loaded before this file as a plain script: the
 * ranges of the columns and the sizes, and the reordering a drop makes.
 */
const { COLUMNS, SPINE_FONT, BUTTON_FONT, within, reordered, dropsAfter } = window.buttonLook

/**
 * One list's buttons — Commands or Skills — each its icon (if it has one) and
 * its label, pressed by a click and dragged to reorder (see `dragInto`).
 */
function drawButtons(container, list, press, edit) {
  container.textContent = ''
  for (const item of list) {
    const node = button({ label: item.label, glyph: item.glyph, onPress: () => act(press, item.id) })
    // A right click opens Settings at this button's row, ready to edit.
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      act(edit, item.id)
    })
    node.dataset.id = item.id
    node.draggable = true
    node.title = item.submits ? item.command : `${item.command} (not submitted)`
    container.append(node)
  }
}

function drawShortcuts(list, on) {
  parts.commandsSection.hidden = !on
  drawButtons(parts.shortcuts, list, 'pressShortcut', 'editShortcut')
}

/** The Skills block: shown while its Part is on, once there is a skill to show. */
function drawSkills(list, on) {
  parts.skillsSection.hidden = !on || list.length === 0
  drawButtons(parts.skills, list, 'pressSkill', 'editSkill')
}

/**
 * How the Commands and the Skills look, and the Spine's text: the columns each
 * list stands in down a side, and the three text sizes, each refused to its
 * default when out of range. The stylesheet reckons the buttons' height from
 * their size.
 */
function drawLook(state) {
  const pick = (range, value) => (within(range, value) ? value : range.size)
  parts.panel.style.setProperty('--spine-font', `${pick(SPINE_FONT, state.spineFontSize)}px`)
  parts.shortcuts.style.setProperty('--button-font', `${pick(BUTTON_FONT, state.commandFontSize)}px`)
  parts.skills.style.setProperty('--button-font', `${pick(BUTTON_FONT, state.skillFontSize)}px`)
  parts.shortcuts.style.setProperty('--columns', String(pick(COLUMNS, state.commandColumns)))
  parts.skills.style.setProperty('--columns', String(pick(COLUMNS, state.skillColumns)))
}

/**
 * A list's buttons dragged onto one another to reorder it — the Spine's, the
 * Commands', the Skills'. Native drag and drop, so a drag is never also a
 * press. While held over a button, a line marks the side it will land on; which
 * side is "after" follows how the list flows (`flow()`, button-look.js
 * `dropsAfter`): right of the middle in a list read along a row, below it in
 * one read down a column. Only within its own list: a button from elsewhere
 * is not taken. The drop hands `drop` the id held, the id it landed on, and
 * whether it landed after it; a drop on itself does nothing.
 */
function dragToReorder(container, { selector, idOf, flow, drop }) {
  let held = null
  const clear = () => {
    for (const node of container.querySelectorAll('.drop-before, .drop-after')) node.classList.remove('drop-before', 'drop-after')
  }
  const target = (event) => {
    const node = event.target.closest?.(selector)
    if (!node || held === null || !container.contains(node)) return null
    const box = node.getBoundingClientRect()
    return { node, id: idOf(node), after: dropsAfter(flow(), { x: event.clientX, y: event.clientY }, box) }
  }
  container.addEventListener('dragstart', (event) => {
    const node = event.target.closest?.(selector)
    if (!node || !container.contains(node)) return
    held = idOf(node)
    node.classList.add('dragging')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', held)
    }
  })
  container.addEventListener('dragover', (event) => {
    const over = target(event)
    if (!over) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    clear()
    if (over.id !== held) over.node.classList.add(over.after ? 'drop-after' : 'drop-before')
  })
  container.addEventListener('dragleave', (event) => {
    if (!container.contains(event.relatedTarget)) clear()
  })
  container.addEventListener('drop', (event) => {
    const over = target(event)
    if (!over) return
    event.preventDefault()
    if (over.id !== held) drop(held, over.id, over.after)
    clear()
  })
  container.addEventListener('dragend', () => {
    held = null
    clear()
    for (const node of container.querySelectorAll('.dragging')) node.classList.remove('dragging')
  })
}

/**
 * A Command or a Skill dragged onto another reorders its list, and the drop
 * sends the list's whole new order. Down a side the grid reads along its rows,
 * so a drop lands left or right; in a Band it fills three rows column by
 * column, so a drop lands above or below.
 */
function dragInto(container, action) {
  dragToReorder(container, {
    selector: '.btn',
    idOf: (node) => node.dataset.id,
    flow: () => (document.body.dataset.axis === 'band' ? 'column' : 'row'),
    drop: (held, onto, after) => {
      const ids = [...container.querySelectorAll('.btn')].map((node) => node.dataset.id)
      act(action, reordered(ids, held, onto, after))
    },
  })
}

dragInto(parts.shortcuts, 'setShortcutOrder')
dragInto(parts.skills, 'setSkillOrder')

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
    // An answer that arrived while another window was reading can be played
    // from the notice itself, cutting that other reading off.
    const play = state.waitingReading
      ? [
          button({
            kind: 'primary',
            label: 'Play',
            onPress: () => act('replayReading', state.waitingReading),
          }),
        ]
      : []
    cards.push(
      noticeCard({
        mark: 'card-marked-quiet',
        body: state.message,
        actions: [...play, ...(state.notice ? [] : dismiss)],
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
  if (!state.hooksInstalled && state.hooksElsewhere) {
    // Another Jarvis folder's hooks, current and working: named, and taken over
    // only when asked.
    cards.push(
      noticeCard({
        mark: 'card-marked-quiet',
        title: `Claude Code is reporting to the Jarvis in ${state.hooksElsewhere}`,
        body: 'This Jarvis will not learn when an answer finishes.',
        link: { label: 'Connect this one', onPress: () => act('installHooks') },
      }),
    )
  } else if (!state.hooksInstalled) {
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

// --- The Spine ---------------------------------------------------------------

/**
 * The core's spine.js, loaded before this file as a plain script: the nine
 * Parts — id, abbreviation, name, glyph — and the default order.
 */
const { PARTS, cleanOrder, moved } = window.spine

/** The three themes, in the order one click on the Spine walks them. */
const THEMES = [
  { name: 'dark', word: 'Dark', glyph: 'moon' },
  { name: 'light', word: 'Light', glyph: 'sun' },
  { name: 'iron', word: 'Iron Man', glyph: 'shield-star' },
]

/** One button per Part, made once: a glyph and the abbreviation, and a Deck block's figure. */
const spineButton = new Map()

for (const part of PARTS) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = part.deck ? 'spine-part spine-deck' : 'spine-part'
  node.dataset.part = part.id
  node.setAttribute('aria-pressed', 'false')
  const glyph = icon(part.glyph)
  glyph.classList.add('spine-glyph')
  const short = document.createElement('small')
  short.className = 'spine-abbr'
  short.textContent = part.abbreviation
  short.setAttribute('aria-hidden', 'true')
  const figure = document.createElement('span')
  figure.className = 'spine-figure'
  figure.setAttribute('aria-hidden', 'true')
  figure.hidden = true
  // A Deck block reads abbreviation first, then its figure (its glyph while
  // off); a section reads glyph first, then its abbreviation.
  if (part.deck) node.append(short, glyph, figure)
  else node.append(glyph, short)
  node.draggable = true
  node.addEventListener('click', () => {
    const on = node.getAttribute('aria-pressed') !== 'true'
    // Added, it is brought into view once the page has it: see `stack`.
    if (on) justAdded = part.id
    act('setPart', { part: part.id, on })
  })
  parts.spineParts.append(node)
  spineButton.set(part.id, { node, figure })
}

/** Each section's head: its glyph, its name, and the cross that takes it off the Panel. */
for (const part of PARTS.filter((each) => !each.deck)) {
  const head = document.querySelector(`section[data-part="${part.id}"] > .part-head`)
  const glyph = icon(part.glyph)
  glyph.classList.add('part-glyph')
  const name = document.createElement('span')
  name.className = 'label'
  name.textContent = part.name
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'part-remove'
  remove.title = `Take ${part.name} off the Panel`
  remove.setAttribute('aria-label', `Take ${part.name} off the Panel`)
  remove.append(icon('x'))
  remove.addEventListener('click', () => act('setPart', { part: part.id, on: false }))
  head.append(glyph, name, remove)
}

/** The Part a click has just added, which the next `stack` scrolls the page to. */
let justAdded = null

// --- Dragging the Spine --------------------------------------------------------

/**
 * A Spine button is dragged onto another to reorder the Spine — and the page,
 * which stacks in the Spine's order (see `dragToReorder`). A drag never ends
 * in a click, so a button dragged is never also switched. Down a side the
 * Spine is a column, so a drop lands above or below; along a Band it is a row,
 * so left or right. The drop sends the whole new order.
 */
let lastState = null

dragToReorder(parts.spineParts, {
  selector: '.spine-part',
  idOf: (node) => node.dataset.part,
  flow: () => (document.body.dataset.axis === 'band' ? 'row' : 'column'),
  drop: (held, onto, after) => act('setSpineOrder', moved(lastState?.spineOrder, held, onto, after)),
})

/** The Spine's order as published, made whole should it come short. */
function orderOf(state) {
  return cleanOrder(state.spineOrder)
}

/** Whether a Part is on: the Deck's share is published as `deckBlocks`, the sections' as `parts`. */
function isOn(state, part) {
  return part.deck ? Boolean(state.deckBlocks?.[part.id]) : Boolean(state.parts?.[part.id])
}

/** `children` as `container`'s children, in that order — touched only when it differs. */
function arrange(container, children) {
  const now = [...container.children]
  if (now.length === children.length && now.every((child, at) => child === children[at])) return
  container.append(...children)
}

/**
 * The Spine's buttons: in its order, pressed while their Part is on, a hidden
 * one gone; and at its foot the theme, which one click moves on, and the
 * language, which one click flips.
 */
function drawSpine(state) {
  const hidden = Array.isArray(state.spineHidden) ? state.spineHidden : []
  for (const part of PARTS) {
    const { node, figure } = spineButton.get(part.id)
    const on = isOn(state, part)
    switched(node, on)
    node.hidden = hidden.includes(part.id)
    const words = `${part.name}: ${on ? 'take it off' : 'add it to'} the Panel`
    node.title = words
    node.setAttribute('aria-label', words)
    if (!on) figure.hidden = true
  }
  arrange(parts.spineParts, orderOf(state).map((id) => spineButton.get(id).node))

  const at = Math.max(0, THEMES.findIndex((theme) => theme.name === state.theme))
  const theme = THEMES[at]
  const next = THEMES[(at + 1) % THEMES.length]
  parts.theme.firstElementChild.className = `ph ph-${theme.glyph}`
  const themeWords = `Theme: ${theme.word}. Click for ${next.word}`
  parts.theme.title = themeWords
  parts.themeLabel.textContent = themeWords
  parts.theme.dataset.next = next.name

  const english = state.languageLabel === 'EN'
  parts.language.textContent = english ? 'EN' : 'PT'
  parts.language.title = `Answers in ${english ? 'English' : 'Portuguese'}. Click for ${english ? 'Portuguese' : 'English'}`
}

/** A Deck block's figure on its Spine button, while the block is on. */
function paintSpineFigure(id, view, now) {
  const { figure } = spineButton.get(id)
  const said = spineFigure(id, view, now)
  figure.hidden = said === null
  if (said !== null && figure.textContent !== said) figure.textContent = said
}

/**
 * The page, in the Spine's order: a model download and the notices first, on
 * their own whenever there are any; then each Part that is on. Down a side a
 * Deck block is a Part of its own, its line in the page, with the
 * not-reporting sentence just before the first of them. Along an edge the
 * Deck is one column of chips, standing where the first block that is on
 * falls, each Part a column of the row. What is not shown goes after what
 * is, so the page's spacing reads only what is on screen.
 */
function stack(state) {
  const shown = []
  const rest = []
  const place = (node) => (node.hidden ? rest : shown).push(node)
  place(parts.downloading)
  place(parts.notices)
  let deckPlaced = false
  for (const id of orderOf(state)) {
    const part = PARTS.find((each) => each.id === id)
    if (part.deck) {
      if (!deckPlaced && isOn(state, part)) {
        place(parts.deck)
        deckPlaced = true
      }
      place(deckNode.get(id).card)
    } else {
      place(document.querySelector(`section[data-part="${id}"]`))
    }
  }
  if (!deckPlaced) rest.push(parts.deck)
  arrange(parts.body, [...shown, ...rest])

  // A Part a click has just added is brought into view, so nothing is ever
  // added where it cannot be seen. Only once it is in the page: a section with
  // nothing in it yet stays out, and the scroll waits for nothing.
  if (justAdded !== null && isOn(state, PARTS.find((each) => each.id === justAdded))) {
    const part = PARTS.find((each) => each.id === justAdded)
    const node = part.deck ? deckNode.get(part.id).card : document.querySelector(`section[data-part="${part.id}"]`)
    if (!node.hidden) node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    justAdded = null
  }
}

// --- The Deck ----------------------------------------------------------------

/**
 * The core's deck-chips.js, loaded before this file as a plain script: the
 * five blocks in the order their switches stand, what each chip says, the
 * clock's words, and the rules by which time alone settles what was left
 * running. One list for the core and the Panel, so nothing here spells it again.
 */
const { BLOCKS: DECK, DECK_FONT, lineFor, spineFigure, elapsedText, percentText, sentenceCase, typeCase, settled, tokensText } = window.deckChips

/**
 * How each block draws its detail: handed its node's body, its own view from
 * the Deck state (published under its id) and the whole state. A block with no
 * drawer here is switched like the rest but kept out of view until it has one.
 */
const DECK_DRAWERS = {
  plan: drawDeckPlan,
  gauge: drawDeckGauge,
  agents: drawDeckAgents,
  loops: drawDeckLoops,
  events: drawDeckEvents,
}

/** What a block's detail does when it goes out of view: one with a clock stops it. */
const DECK_HIDERS = {
  agents: () => agentsClock.stop(),
  loops: () => loopsClock.stop(),
}

/**
 * The lines whose detail is open. This window's own, never stored: the Plan
 * and the Gauge open to start, the rest a click away.
 */
const deckOpen = new Set(['plan', 'gauge'])

/** The state the Deck was last drawn from, so a click can draw it again. */
let deckState = null

/**
 * The Plan block's mute, at the end of its line, and again on its chip in a
 * Band, where there is no line: a speaker, struck through while the two sounds
 * are silenced. One state for every window, like the switches; the two buttons
 * are two views of it, and only one is ever shown.
 */
const planMutes = []

function makePlanMute() {
  const mute = document.createElement('button')
  mute.type = 'button'
  mute.className = 'deck-plan-mute'
  mute.title = 'Mute plan sounds'
  mute.setAttribute('aria-label', 'Mute plan sounds')
  mute.setAttribute('aria-pressed', 'false')
  mute.append(icon('speaker-high'))
  mute.addEventListener('click', () => {
    act('setDeckPlanMuted', mute.getAttribute('aria-pressed') !== 'true')
  })
  planMutes.push(mute)
  return mute
}

function drawPlanMute(muted) {
  for (const mute of planMutes) {
    if (mute.getAttribute('aria-pressed') === String(muted)) continue
    switched(mute, muted)
    mute.firstElementChild.className = `ph ph-${muted ? 'speaker-slash' : 'speaker-high'}`
  }
}

/**
 * The five blocks (a line and its detail) and the five Band chips, made once,
 * in DECK's order. A block's card is a Part of the page down a side, so it
 * lives in the page itself and `stack` puts it where the Spine says.
 */
const deckNode = new Map()
const deckChip = new Map()

for (const block of DECK) {
  // The block: its line — abbreviation, figures, chevron — and its detail under it.
  const card = document.createElement('div')
  card.className = 'deck-block'
  card.dataset.block = block.id
  card.hidden = true
  const line = document.createElement('div')
  line.className = 'deck-line'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'deck-line-toggle'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', `deck-detail-${block.id}`)
  const chevron = icon('caret-right')
  chevron.classList.add('deck-line-chevron')
  const figures = span('deck-line-figures', '')
  toggle.append(span('deck-line-abbr', block.abbreviation), figures, chevron)
  toggle.addEventListener('click', () => {
    if (deckOpen.has(block.id)) deckOpen.delete(block.id)
    else deckOpen.add(block.id)
    if (deckState) drawDeck(deckState)
  })
  line.append(toggle)
  if (block.id === 'plan') line.append(makePlanMute())
  const body = document.createElement('div')
  body.className = 'deck-block-body'
  body.id = `deck-detail-${block.id}`
  body.hidden = true
  card.append(line, body)
  parts.body.append(card)
  deckNode.set(block.id, { card, toggle, chevron, figures, body })

  const chip = document.createElement('div')
  chip.className = 'deck-chip'
  chip.dataset.block = block.id
  chip.hidden = true
  const chipFigures = span('deck-chip-figures', '')
  chip.append(span('deck-chip-abbr', block.abbreviation), chipFigures)
  if (block.id === 'plan') chip.append(makePlanMute())
  parts.deckChips.append(chip)
  deckChip.set(block.id, { chip, figures: chipFigures })
}

/**
 * The tick and the cross, as Phosphor icons: the panel's font draws ✓ and ✗
 * as a root sign and a plain X.
 */
const MARKS = { '✓': 'check', '✗': 'x' }

/** `text` into `node`, each ✓ and ✗ in it drawn as its icon. */
function marked(node, text) {
  node.textContent = ''
  for (const part of text.split(/([✓✗])/)) {
    if (part === '') continue
    if (MARKS[part]) {
      const mark = icon(MARKS[part])
      mark.classList.add('deck-mark')
      node.append(mark)
    } else {
      node.append(part)
    }
  }
  return node
}

/** A span of `text`, its ticks and crosses drawn as icons. */
function markedSpan(className, text) {
  return marked(span(className, ''), text)
}

/**
 * One part of a line, as the core describes it (deck-chips.js `lineFor`):
 * words or a figure, a tiny bar, a segment per step, a glyph.
 * What is shown exactly as Claude Code said it — a tool, a path — is marked
 * so, being no part of the Deck's own wording.
 */
function linePart(part) {
  if (typeof part.text === 'string') {
    const node = markedSpan(`deck-part${part.figure ? ' figure' : ''}${part.fill ? ' fill' : ''}`, part.text)
    if (part.tone) node.classList.add(`tone-${part.tone}`)
    if (part.verbatim) node.dataset.verbatim = ''
    if (part.written) node.dataset.written = ''
    return node
  }
  if (part.bar !== undefined) {
    const bar = span('deck-part-bar', '')
    const fill = span('', '')
    fill.style.width = `${part.bar}%`
    bar.append(fill)
    return bar
  }
  if (part.steps) {
    const steps = span('deck-part-steps', '')
    for (const status of part.steps) {
      const step = document.createElement('i')
      step.className = status
      steps.append(step)
    }
    return steps
  }
  const glyph = icon(part.glyph)
  glyph.classList.add('deck-part-glyph')
  if (part.tone) glyph.classList.add(`tone-${part.tone}`)
  return glyph
}

/**
 * A line's figures into `figures`, its attention onto `frame` and its detail
 * onto `tip` — the figures rebuilt only when they changed.
 */
function paintLine(frame, figures, tip, line) {
  const said = JSON.stringify(line.parts)
  if (figures.dataset.said !== said) {
    figures.dataset.said = said
    figures.replaceChildren(...line.parts.map(linePart))
  }
  // Figures that still do not fit once the filling part has given way fade
  // out at the edge rather than stop mid-letter.
  figures.classList.toggle('clipped', figures.scrollWidth > figures.clientWidth + 1)
  tip.title = line.title
  frame.classList.toggle('attention', line.attention !== null)
  if (line.attention) frame.dataset.attention = line.attention
  else delete frame.dataset.attention
}

/**
 * The blocks shown as lines (down a side) or chips (along an edge), with
 * their views, and the one clock that ticks them while one moves with time
 * alone — an agent's clock, a loop at work — open or not.
 */
let linesShown = []
let linesInBand = false
const linesClock = blockClock()

function paintLines() {
  const now = Date.now()
  for (const [id, view] of linesShown) {
    paintSpineFigure(id, view, now)
    const line = lineFor(id, view, now)
    if (linesInBand) {
      const { chip, figures } = deckChip.get(id)
      paintLine(chip, figures, chip, line)
    } else {
      // The detail goes on the toggle, where the pointer rests, not over the open detail.
      const { card, toggle, figures } = deckNode.get(id)
      paintLine(card, figures, toggle, line)
    }
  }
}

/** A line whose figures move with time alone. */
function linesLive() {
  const now = Date.now()
  return linesShown.some(([id, view]) => lineFor(id, view, now).live)
}

/**
 * The switches' state, then every block that is on and has a drawer: down a
 * side as its line, with its detail under it while open; along an edge as one
 * chip. The section is hidden while none is on: a Deck that shows nothing
 * costs no room. A detail's own clock runs only while it is open; the lines
 * and the chips share one, and only while one of them moves with time.
 */
function drawDeck(state) {
  deckState = state
  const on = state.deckBlocks ?? {}
  const views = state.deck ?? {}
  const band = document.body.dataset.axis === 'band'
  // The Deck's own type size, which every size in its part of the stylesheet
  // is reckoned from — lines, details and chips alike.
  const size = Number.isInteger(state.deckFontSize) ? state.deckFontSize : DECK_FONT.size
  parts.panel.style.setProperty('--deck-font', `${size}px`)
  drawPlanMute(state.deckPlanMuted === true)

  let drawn = 0
  linesShown = []
  linesInBand = band
  for (const block of DECK) {
    const { card, toggle, chevron, body } = deckNode.get(block.id)
    const draw = DECK_DRAWERS[block.id]
    const showing = Boolean(on[block.id]) && typeof draw === 'function'
    const open = showing && !band && deckOpen.has(block.id)
    card.hidden = !showing || band
    deckChip.get(block.id).chip.hidden = !showing || !band
    card.classList.toggle('open', open)
    toggle.setAttribute('aria-expanded', String(open))
    chevron.className = `ph ph-${open ? 'caret-down' : 'caret-right'} deck-line-chevron`
    body.hidden = !open
    if (!open) DECK_HIDERS[block.id]?.()
    if (!showing) continue
    drawn += 1
    linesShown.push([block.id, views[block.id]])
    if (open) draw(body, views[block.id], state)
  }

  paintLines()
  linesClock.keep(linesLive, paintLines)

  // Down a side the section holds only the not-reporting sentence, so it is
  // out of the page while there is nothing to say; along an edge it is the
  // chips' column.
  parts.deckSilent.hidden = Boolean(state.hooksInstalled)
  parts.deck.hidden = drawn === 0 || (!band && parts.deckSilent.hidden)
}

/** The glyph and the word for each kind of entry in the Events block. */
const EVENT_KIND = {
  prompt: { glyph: 'chat-text', word: 'Prompt' },
  spawn: { glyph: 'robot', word: 'Spawned' },
  done: { glyph: 'check-circle', word: 'Finished' },
  edit: { glyph: 'pencil-simple', word: 'Edited' },
  error: { glyph: 'warning', word: 'Failed' },
  denied: { glyph: 'prohibit', word: 'Denied' },
}

function clockTime(at) {
  const when = new Date(at)
  return [when.getHours(), when.getMinutes(), when.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a plan window resets: the time today, or the day and time beyond it. */
function resetText(at) {
  const when = new Date(at)
  const time = [when.getHours(), when.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
  return at - Date.now() < 24 * 60 * 60 * 1000 ? time : `${WEEKDAYS[when.getDay()]} ${time}`
}

function span(className, text) {
  const node = document.createElement('span')
  node.className = className
  node.textContent = text
  return node
}

/**
 * Marks a node as shown exactly as Claude Code said it — a tool's name, a
 * path, a command — and so no part of the Deck's own wording, which is in
 * sentence case.
 */
function verbatim(node) {
  node.dataset.verbatim = ''
  return node
}

/**
 * Marks a node as words Claude Code wrote — a plan's step, a subagent's task —
 * shown in sentence case, its first letter raised and nothing lowered: the
 * capitals in it may be acronyms ("MCP API").
 */
function written(node) {
  node.dataset.written = ''
  return node
}

/** The kinds of Events entry whose label is a subagent's type rather than a tool's name. */
const TYPED_EVENTS = new Set(['spawn', 'done'])

/** What was last drawn, so an unchanged Gauge is not rebuilt on every publish. */
let gaugeDrawn = ''

/**
 * The Gauge: the folder and its branch, the context bar with a mark where each
 * compaction began, the plan's two windows with their resets, and how
 * Claude Code is set — what the status line under the terminal used to print.
 * Before the status line's first reading it says so, rather than show a bar
 * that would read as empty. A window the plan does not report is left out.
 */
function drawDeckGauge(body, gauge) {
  const key = JSON.stringify(gauge ?? null)
  if (key === gaugeDrawn && body.firstChild) return
  gaugeDrawn = key
  body.textContent = ''
  if (!gauge) return

  const setting = [gauge.model, gauge.effort, gauge.permissionMode].filter(Boolean)

  if (!gauge.reported) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'No figures yet. They arrive with Claude Code’s next answer.'
    body.append(empty)
  } else {
    // Where Claude Code is working: the folder, and the branch when it is a repository.
    if (gauge.folder) {
      const place = document.createElement('div')
      place.className = 'deck-gauge-place'
      place.title = gauge.branch ? `${gauge.folder} (${gauge.branch})` : gauge.folder
      place.append(icon('folder'), verbatim(span('deck-gauge-folder', gauge.folder)))
      if (gauge.branch) place.append(icon('git-branch'), verbatim(span('deck-gauge-branch', gauge.branch)))
      body.append(place)
    }

    const row = document.createElement('div')
    row.className = 'deck-gauge-context'
    const track = document.createElement('div')
    track.className = 'bar deck-gauge-bar'
    const fill = document.createElement('div')
    fill.className = 'bar-fill'
    fill.style.width = `${Math.min(100, Math.max(0, gauge.context.percent ?? 0))}%`
    track.append(fill)
    for (const mark of gauge.context.compactions) {
      if (mark.percent === null) continue
      const tick = document.createElement('span')
      tick.className = mark.running ? 'deck-gauge-mark running' : 'deck-gauge-mark'
      tick.style.left = `${Math.min(100, Math.max(0, mark.percent))}%`
      tick.title = `${mark.running ? 'Compacting' : 'Compacted'} at ${percentText(mark.percent)}%${mark.trigger ? ` (${mark.trigger})` : ''}`
      track.append(tick)
    }
    const compacted = gauge.context.compactions.length
    row.title = compacted > 0 ? `Context used. Compacted ${compacted} time${compacted === 1 ? '' : 's'}.` : 'Context used'
    row.append(
      track,
      span('bar-time', gauge.context.percent === null ? '—' : `${percentText(gauge.context.percent)}%`),
    )
    body.append(row)

    // The plan's two windows, a row each: a bar, how full, when it resets.
    const windows = document.createElement('div')
    windows.className = 'deck-gauge-windows'
    for (const [label, window] of [
      ['5H', gauge.limits.fiveHour],
      ['7D', gauge.limits.sevenDay],
    ]) {
      if (!window) continue
      const bar = span('deck-part-bar deck-gauge-window-bar', '')
      const fill = span('', '')
      fill.style.width = `${Math.min(100, Math.max(0, window.percent))}%`
      bar.append(fill)
      const figure = span('deck-gauge-figure', `${percentText(window.percent)}%`)
      if (window.resetsAt !== null) {
        figure.append(span('deck-gauge-reset', ` ↻ ${resetText(window.resetsAt)}`))
        figure.title = `Resets ${new Date(window.resetsAt).toLocaleString()}`
      }
      windows.append(span('deck-gauge-window', label), bar, figure)
    }
    if (windows.firstChild) body.append(windows)
  }

  // How Claude Code is set.
  const foot = document.createElement('div')
  foot.className = 'deck-gauge-foot'
  if (setting.length > 0) foot.append(written(span('deck-gauge-setting', sentenceCase(setting.join(' · ')))))
  if (foot.firstChild) body.append(foot)
}

const AGENT_STATUS = {
  running: { glyph: 'circle-notch', word: 'Running' },
  done: { glyph: 'check-circle', word: 'Done' },
  failed: { glyph: 'x-circle', word: 'Failed' },
}

/** The Agents view last handed in, what was drawn from it, and the clock that redraws it each second. */
let agentsShown = null
let agentsDrawn = ''
const agentsClock = blockClock()

/** How long an agent has run, or ran; blank when its start was never heard. */
function agentElapsed(agent, now) {
  if (agent.startedAt === null) return '—'
  return elapsedText((agent.endedAt ?? now) - agent.startedAt)
}

function agentTitle(agent, now) {
  const tokens = agent.tokens
  return [
    `${agent.type ?? 'Subagent'} · ${AGENT_STATUS[agent.status]?.word ?? agent.status}`,
    agent.task,
    `${agent.steps} step${agent.steps === 1 ? '' : 's'} · ${agentElapsed(agent, now)}`,
    tokens
      ? `${tokensText(tokens.total)} tokens: ${tokensText(tokens.input)} in, ${tokensText(tokens.output)} out, ${tokensText(tokens.cacheRead)} cache read, ${tokensText(tokens.cacheCreation)} cache written`
      : null,
    agent.outOfOutput ? 'Ran out of output room: its answer was cut short' : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The red flag of an agent cut short, when it was. */
function outOfOutputFlag(agent) {
  if (!agent.outOfOutput) return null
  const flag = icon('flag')
  flag.classList.add('deck-agent-flag')
  return flag
}

/**
 * A subagent's task as Claude Code wrote it, or — when none was told — its
 * type, which is a name.
 */
function agentTask(agent) {
  return agent.task
    ? written(span('deck-agent-task', sentenceCase(agent.task)))
    : span('deck-agent-task', typeCase(agent.type ?? 'Subagent'))
}

/**
 * The lengths a time line rounds up to while something on it runs. A line that
 * always ended at now would keep a running bar pinned to its right edge, full
 * and still, however long it ran; on a line of a set length the bar grows
 * towards the end, and the line steps to the next length when it gets there.
 */
const LINE_SPANS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 960].map((minutes) => minutes * 60_000)

/**
 * One time line for things with a start and an end — the agents: from the
 * first start (or, when no start was heard, the first end). While one runs it
 * reaches the next of LINE_SPANS past now; once none does, it ends at the last
 * end. `place` sets a mark's left edge and width, from its start (or the
 * line's beginning) to its end (or now).
 */
function timeLine(items, now) {
  const starts = items.map((item) => item.startedAt).filter((at) => at !== null)
  const ends = items.map((item) => item.endedAt ?? now)
  const from = starts.length > 0 ? Math.min(...starts) : Math.min(...ends)
  const live = items.some((item) => item.status === 'running')
  const reached = (live ? now : Math.max(...ends)) - from
  const length = live
    ? (LINE_SPANS.find((each) => each > reached) ?? Math.ceil(reached / 3_600_000 + 1) * 3_600_000)
    : Math.max(1000, reached)
  const at = (time) => `${Math.min(100, Math.max(0, ((time - from) / length) * 100))}%`
  const place = (mark, item) => {
    const left = item.startedAt ?? from
    mark.style.left = at(left)
    mark.style.width = `calc(${at(item.endedAt ?? now)} - ${at(left)})`
  }
  const covered = live ? `${elapsedText(reached)} of ${elapsedText(length)}` : elapsedText(reached)
  return { place, span: `From ${clockTime(from)} · ${covered}` }
}

/**
 * Agents as a list on one time line: each a row with its status, its task, a
 * bar from its start to its end (or to now, growing while it runs), its steps
 * and clock. An agent whose start was never heard is drawn from the line's
 * beginning.
 */
function agentLanes(agents, now) {
  const line = timeLine(agents, now)

  const list = document.createElement('ol')
  list.className = 'deck-agent-lanes'
  for (const agent of agents) {
    const row = document.createElement('li')
    row.className = `deck-agent-lane ${agent.status}`
    if (agent.outOfOutput) row.classList.add('cut-short')
    row.title = agentTitle(agent, now)
    const task = agentTask(agent)
    if (agent.task === null) task.classList.add('untold')
    const status = icon(AGENT_STATUS[agent.status]?.glyph ?? 'circle')
    status.classList.add('deck-agent-status')
    const label = document.createElement('span')
    label.className = 'deck-agent-label'
    label.append(status, task)
    const track = document.createElement('div')
    track.className = 'deck-agent-track'
    const bar = document.createElement('span')
    bar.className = 'deck-agent-bar'
    line.place(bar, agent)
    track.append(bar)
    const figures = span('deck-agent-clock', `${agent.steps} st · ${agentElapsed(agent, now)}`)
    // The flag keeps its column when there is none, so every track is as wide.
    row.append(label, track, figures, outOfOutputFlag(agent) ?? span('deck-agent-noflag', ''))
    list.append(row)
  }

  // Under the tracks: when the line begins, and how long it covers.
  const axis = document.createElement('div')
  axis.className = 'deck-agent-axis'
  axis.append(span('', ''), span('deck-agent-axis-span', line.span))
  const lanes = document.createDocumentFragment()
  lanes.append(list, axis)
  return lanes
}

/**
 * The Agents block: how many run, are done and failed, then each subagent as
 * a row of a list on one shared time line. The clocks tick once a second only while an agent
 * runs and the block is in view; an idle Deck sets no timer.
 */
function drawDeckAgents(body, agents) {
  agentsShown = agents ?? null
  // Running as the clock judges it: one quiet past its limit has stopped.
  const running = () => (settled('agents', agentsShown, Date.now())?.running ?? 0) > 0
  // Only a running clock makes time itself a reason to draw again.
  const key = running() ? null : JSON.stringify(agents ?? null)
  if (key !== null && key === agentsDrawn && body.firstChild) {
    agentsClock.stop()
    return
  }
  agentsDrawn = key ?? ''
  paintAgents(body)
  agentsClock.keep(running, () => paintAgents(body))
}

function paintAgents(body) {
  const now = Date.now()
  const agents = settled('agents', agentsShown, now)
  const scrolled = body.querySelector('.deck-agent-lanes')?.scrollTop ?? 0
  body.textContent = ''
  if (!agents) return

  if (agents.agents.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'No subagents yet. Each one Claude Code starts appears here.'
    body.append(empty)
    return
  }

  const summary = document.createElement('div')
  summary.className = 'deck-agent-counts'
  summary.append(
    span(`deck-agent-count running${agents.running > 0 ? ' on' : ''}`, `${agents.running}▶`),
    markedSpan('deck-agent-count done', `${agents.done}✓`),
    markedSpan(`deck-agent-count failed${agents.failed > 0 ? ' on' : ''}`, `${agents.failed}✗`),
  )
  summary.title = `${agents.running} running, ${agents.done} done, ${agents.failed} failed`
  body.append(summary)

  body.append(agentLanes(agents.agents, now))
  // The list is drawn afresh each second; a reader scrolled down it stays put.
  const list = body.querySelector('.deck-agent-lanes')
  if (list) list.scrollTop = scrolled
}

/**
 * A block's once-a-second redraw, set only while something in it runs and
 * cleared the moment nothing does — or when the block goes out of view.
 */
function blockClock() {
  let timer = null
  const clock = {
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    /** Keeps `paint` ticking while `live()` holds; stops it otherwise. */
    keep(live, paint) {
      if (!live()) {
        clock.stop()
        return
      }
      if (timer !== null) return
      timer = setInterval(() => {
        paint()
        if (!live()) clock.stop()
      }, 1000)
    },
  }
  return clock
}

/** The Loops view last handed in, what was drawn from it, and its clock. */
let loopsShown = null
let loopsDrawn = ''
const loopsClock = blockClock()

/** A stray is live while its last call is younger than the view says. */
function strayLive(stray, liveForMs, now) {
  return now - stray.lastSeen < liveForMs
}

/**
 * A stray is shown only once it has gone `graceMs` unadopted since first seen:
 * its SubagentStart may still be on the way, the tool hooks being async.
 */
function strayShown(stray, graceMs, now) {
  return now - stray.firstSeen >= (graceMs ?? 0)
}

/** A compaction running — past its limit it no longer is — or a stray seen lately. */
function loopsLive(loops, now) {
  const settledLoops = settled('loops', loops, now)
  if (!settledLoops) return false
  return (
    settledLoops.compactions.some((each) => each.running) ||
    settledLoops.strays.some((each) => strayLive(each, settledLoops.liveForMs, now))
  )
}

/**
 * The Loops block: model work no agent card owns — each compaction, with what
 * set it off and how long it ran, and each stray agent id, with its steps and
 * when it was first and last seen. A row is live while its compaction runs or
 * its stray was seen lately; the clock ticks only while one is.
 */
function drawDeckLoops(body, loops) {
  loopsShown = loops ?? null
  const live = () => loopsLive(loopsShown, Date.now())
  const key = live() ? null : JSON.stringify(loops ?? null)
  if (key !== null && key === loopsDrawn && body.firstChild) {
    loopsClock.stop()
    return
  }
  loopsDrawn = key ?? ''
  paintLoops(body)
  loopsClock.keep(live, () => paintLoops(body))
}

function paintLoops(body) {
  const now = Date.now()
  const loops = settled('loops', loopsShown, now)
  body.textContent = ''
  if (!loops) return
  const strays = loops.strays.filter((stray) => strayShown(stray, loops.graceMs, now))

  if (loops.compactions.length === 0 && strays.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'Nothing loose. Compactions, and work by agents no card owns, appear here.'
    body.append(empty)
    return
  }

  const list = document.createElement('ol')
  list.className = 'deck-loops'
  for (const compaction of loops.compactions) {
    const row = document.createElement('li')
    row.className = `deck-loop${compaction.running ? ' live' : ''}`
    // Its start never heard, or its end never: how long it took is unknown.
    const took =
      compaction.startedAt === null || (!compaction.running && compaction.endedAt === null)
        ? '—'
        : elapsedText((compaction.endedAt ?? now) - compaction.startedAt)
    row.title = [
      `Compaction${compaction.trigger ? ` (${compaction.trigger})` : ''} · ${compaction.running ? 'Running' : 'Done'}`,
      compaction.startedAt === null ? 'Its start was not heard' : `Started ${clockTime(compaction.startedAt)}`,
      compaction.endedAt === null ? null : `Ended ${clockTime(compaction.endedAt)}`,
    ]
      .filter(Boolean)
      .join('\n')
    row.append(
      icon('arrows-in'),
      span('deck-loop-name', 'Compaction'),
      span('deck-loop-note', typeCase(compaction.trigger ?? '')),
      span('deck-loop-clock', compaction.running ? `▶ ${took}` : `Took ${took}`),
    )
    list.append(row)
  }
  for (const stray of strays) {
    const live = strayLive(stray, loops.liveForMs, now)
    const row = document.createElement('li')
    row.className = `deck-loop${live ? ' live' : ''}`
    row.title = [
      `Agent ${stray.id} · no subagent start was heard for it`,
      `${stray.steps} step${stray.steps === 1 ? '' : 's'}`,
      `First seen ${clockTime(stray.firstSeen)} · last seen ${clockTime(stray.lastSeen)}`,
      live ? 'Still at work' : 'Quiet since',
    ].join('\n')
    row.append(
      icon('ghost'),
      verbatim(span('deck-loop-name', stray.short)),
      span('deck-loop-note', `${stray.steps} st · ${clockTime(stray.firstSeen)}–${clockTime(stray.lastSeen)}`),
      span('deck-loop-clock', `${live ? '▶ ' : ''}${elapsedText((live ? now : stray.lastSeen) - stray.firstSeen)}`),
    )
    list.append(row)
  }
  body.append(list)
}

/** The glyph for each status a plan's step can have: done, under way, still to come. */
const STEP_GLYPH = { completed: 'check-circle', in_progress: 'circle-half', pending: 'circle' }

/** What the Plan block last drew, so an unchanged plan is not rebuilt on every publish. */
let planDrawn = ''

/**
 * A plan's progress as the line draws it: a segment per step — done, the one
 * under way, still to come — or, for a long plan, a plain bar.
 */
function planProgress(row) {
  if (row.total === 0 || row.total > 16) {
    const bar = span('deck-part-bar deck-plan-bar', '')
    const fill = span('', '')
    fill.style.width = `${row.total === 0 ? 0 : Math.round((row.done / row.total) * 100)}%`
    bar.append(fill)
    return bar
  }
  const steps = span('deck-part-steps deck-plan-bar', '')
  for (let n = 0; n < row.total; n += 1) {
    const step = document.createElement('i')
    step.className = n < row.done ? 'completed' : n === row.done && row.current ? 'in_progress' : 'pending'
    steps.append(step)
  }
  return steps
}

/**
 * The Plan block: one row per plan - the main conversation's, then each
 * subagent's own - with its title, a segment per step and done of total, and
 * under a subagent's the step under way; then the main plan's steps,
 * numbered, each marked done, under way or to come.
 */
function drawDeckPlan(body, plan) {
  const key = JSON.stringify(plan ?? null)
  if (key === planDrawn && body.firstChild) return
  planDrawn = key
  body.textContent = ''

  const rows = plan?.rows ?? []
  if (rows.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'No plan yet. When Claude Code works through three steps or more, they appear here.'
    body.append(empty)
    return
  }

  const steps = plan?.steps ?? []
  const list = document.createElement('div')
  list.className = 'deck-plan-rows'
  for (const row of rows) {
    const line = document.createElement('div')
    line.className = `deck-plan-row${row.finished ? ' finished' : ''}${row.inAgent ? ' in-agent' : ''}`
    const title = sentenceCase(row.title)
    const doing = row.finished ? 'Done' : sentenceCase(row.current ?? 'Waiting')
    line.append(written(span('deck-plan-title', title)), planProgress(row), span('deck-plan-count', `${row.done}/${row.total}`))
    // The main plan's step under way is among its steps below; a subagent's is said here.
    if (row.inAgent || steps.length === 0) line.append(written(span('deck-plan-current', doing)))
    line.title = `${title} · ${row.done} of ${row.total} steps done · ${doing}`
    list.append(line)
  }
  body.append(list)

  if (steps.length === 0) return
  const listed = document.createElement('ol')
  listed.className = 'deck-plan-steps'
  steps.forEach((step, n) => {
    const item = document.createElement('li')
    item.className = `deck-plan-step ${step.status}`
    const label = sentenceCase(step.label)
    item.append(span('deck-plan-number', String(n + 1)), icon(STEP_GLYPH[step.status] ?? 'circle'), written(span('', label)))
    item.title = label
    listed.append(item)
  })
  body.append(listed)
}

/** What was last drawn, so an unchanged list is not rebuilt on every publish. */
let eventsDrawn = ''

/** The Events block: what happened, newest first, one line each. */
function drawDeckEvents(body, entries = []) {
  const key = `${entries.length}:${entries[0]?.id ?? 0}:${entries[0]?.at ?? 0}`
  if (key === eventsDrawn && body.firstChild) return
  eventsDrawn = key

  body.textContent = ''
  if (entries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'Nothing yet. Prompts, subagents, edits, errors and denials appear here.'
    body.append(empty)
    return
  }

  const list = document.createElement('ol')
  list.className = 'deck-events'
  for (const entry of entries) {
    const kind = EVENT_KIND[entry.kind] ?? { glyph: 'dot', word: entry.kind }
    const row = document.createElement('li')
    row.className = `deck-event deck-event-${entry.kind}`
    if (entry.inAgent) row.classList.add('in-agent')
    row.title = [
      `${clockTime(entry.at)} · ${kind.word} · ${entry.label}`,
      entry.detail,
      entry.note,
      entry.inAgent ? 'Inside a subagent' : null,
    ]
      .filter(Boolean)
      .join('\n')

    row.append(icon(kind.glyph))
    // A subagent's type, or a word of Jarvis's own, in sentence case; a tool's
    // name and the detail exactly as Claude Code said them.
    const label = TYPED_EVENTS.has(entry.kind) || !entry.kind || ['Prompt', 'Turn'].includes(entry.label)
      ? span('deck-event-label', typeCase(entry.label))
      : verbatim(span('deck-event-label', entry.label))
    const detail = verbatim(
      span('deck-event-detail', entry.note ? `${entry.detail ?? ''} — ${entry.note}` : (entry.detail ?? '')),
    )
    const time = document.createElement('span')
    time.className = 'deck-event-time'
    time.textContent = clockTime(entry.at)
    row.append(label, detail, time)
    list.append(row)
  }
  body.append(list)
}

// --- The whole panel ---------------------------------------------------------

function draw(state) {
  lastState = state
  document.documentElement.dataset.theme = state.theme ?? 'dark'

  drawPlacement(state)
  drawSession(state)

  parts.asked.hidden = !show(parts.permission, state.lastPermissionDetail)

  drawDock(state)
  drawSpine(state)
  drawDeck(state)
  drawReadingHistory(state.recentReadings ?? [], Boolean(state.parts?.readings))

  const downloading = typeof state.downloading === 'number'
  parts.downloading.hidden = !downloading
  if (downloading) {
    parts.downloadFill.style.width = `${state.downloading}%`
    parts.downloadLabel.textContent = `${state.downloading}%`
  }

  drawLook(state)
  drawShortcuts(state.shortcuts ?? [], Boolean(state.parts?.commands))
  drawSkills(state.skills ?? [], Boolean(state.parts?.skills))
  parts.sessionSection.hidden = !state.parts?.session
  drawNotices(state)
  stack(state)
  measure()
}

// --- What the room allows ----------------------------------------------------

/**
 * Nothing here is hidden by a breakpoint. This reads a real measurement,
 * because a window is not the thing being measured — the row is.
 *
 * The edit group carries its labels while all three fit. Down a side that is
 * guaranteed by construction: the Spine leaves the pane 264 of the Rail's 316
 * floor, the row 214 of that, and the three words need 187 — measured in the
 * panes test, which is what holds this promise. Along an edge the row is
 * measured, against the width a band's labelled row needs.
 *
 * There used to be a second measurement beside it, hiding the Session block in
 * a band under a width it was the reason for exceeding. It went when the block
 * moved into the band's first column: it costs the row of buttons nothing from
 * there, so hiding it bought nothing back.
 */
const EDIT_LABELS_NEED = 240

function measure() {
  if (document.body.dataset.axis === 'side') {
    document.body.dataset.edit = 'wide'
    return
  }
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
parts.openSession.addEventListener('click', () => act('openSession'))
parts.reopenProject.addEventListener('click', () => act('reopenLastProject'))
parts.endSession.addEventListener('click', () => act('closeSession'))
// The reading controls in the dock; the hold reads its own face to know which
// of the two it is.
parts.repeat.addEventListener('click', () => act('repeatLast'))
parts.stopSpeech.addEventListener('click', () => act('stopSpeech'))
parts.pauseSpeech.addEventListener('click', () => {
  act(parts.pauseSpeech.dataset.mode === 'resume' ? 'resumeSpeech' : 'pauseSpeech')
})
// The shut Spine's microphone: the Dock's Speak, and Finish while listening.
parts.spineMic.addEventListener('click', () => act('micPressed'))

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

parts.memory.addEventListener('click', () => act('recallConversations'))
parts.autoRead.addEventListener('click', () => {
  act('setAutoRead', parts.autoRead.getAttribute('aria-pressed') !== 'true')
})

// Moving and shutting, from the Spine's foot open and shut alike — the same
// buttons in both states, since shut, the Panel is its Spine.
parts.movePanel.addEventListener('click', () => act('movePanel'))
parts.collapse.addEventListener('click', () => act('togglePanelCollapsed'))

// The theme and the language at the Spine's foot: one click moves the theme on
// to the next of the three, and flips the language — two languages, so the core
// has a toggle rather than a setter.
parts.theme.addEventListener('click', () => act('setTheme', parts.theme.dataset.next))
parts.language.addEventListener('click', () => act('toggleLanguage'))

window.jarvis.onState(draw)
window.jarvis.onSound(playSound)
window.jarvis.onChime(playChime)
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

// --- The Plan block's two sounds ---------------------------------------------

/**
 * Their own context, apart from the reading's: holding a reading suspends that
 * one, and a step finishing meanwhile still sounds. Nothing waits for them.
 */
let chimes = null

/** A step done or a plan done: a Windows sound's bytes, sent by the main process. */
async function playChime(wav) {
  try {
    chimes = chimes ?? new AudioContext()
    if (chimes.state === 'suspended') await chimes.resume()
    const source = chimes.createBufferSource()
    source.buffer = await chimes.decodeAudioData(wav)
    source.connect(chimes.destination)
    source.start()
  } catch {
    // A sound that cannot be decoded is silence, never an error.
  }
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
