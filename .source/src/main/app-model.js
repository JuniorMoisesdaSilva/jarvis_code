'use strict'

// Where the core meets the machine — one instance per Session.
//
// The core decides; this carries the decisions out and reports back. Everything
// here is adapter work: no rule about how Jarvis behaves belongs in this file.
//
// A Session owns its own window, terminal, transcript, core and surface, so
// several projects run at once without crossing wires. The resources there is
// only one of — the voice, the microphone, the hook channel — are shared, and
// the `sessions` registry hands them to one Session at a time; this file asks
// for them through the `deps` it is created with.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { clipboard, dialog, shell: systemShell } = require('electron')

const { JarvisCore } = require('../core/jarvis-core')
const { user } = require('../core/events')
const { normalize, samePath, within } = require('../core/paths')
const languages = require('../core/language')
const { defaultShell } = require('../core/platform')
const connection = require('../core/connection')
const { DECK_FONT } = require('../core/deck-chips')
const { TERMINAL_FONT } = require('../core/button-look')

const { createTerminal } = require('./terminal')
const { createTranscript } = require('./transcript')
const speech = require('./speech')
const dictation = require('./dictation')
const sounds = require('./sounds')
const hooks = require('./hooks')
const claudeConfig = require('./claude-config')
const maestro = require('./maestro')
const preferences = require('./preferences')
const models = require('./models')
const geometry = require('../core/geometry')
const deckCore = require('../core/deck')
const spine = require('../core/spine')
const { createDeckFeed, hearAgentEvent, hearStatus } = require('./deck-feed')

const HISTORY_LIMIT = 3

/**
 * What the Spine says, from the stored preferences: which Parts are on (a
 * hidden one never is), their order, and which buttons are hidden. `deckBlocks`
 * is the Deck's share of `parts`, which the Deck and the plan sounds read.
 */
function spineChoices(stored) {
  const parts = spine.partsOn(stored)
  return {
    parts,
    deckBlocks: Object.fromEntries(deckCore.BLOCKS.map((block) => [block.id, parts[block.id]])),
    spineOrder: spine.cleanOrder(stored.spineOrder),
    spineHidden: spine.cleanHidden(stored.spineHidden),
  }
}

/**
 * @param win  the window handle (src/main/workspace.js createWindow).
 * @param deps the shared-resource broker (src/main/sessions.js): acquireVoice,
 *             acquireMic, broadcastHookState.
 */
function createSession({ win, deps }) {
  const core = new JarvisCore()
  const term = createTerminal(win.terminalContents)
  const scribe = createTranscript()

  /** What the Panel needs to draw itself, beyond the core's own state. */
  const surface = {
    projectName: null,
    projectPath: null,
    message: null,
    problem: null,
    voice: null,
    downloading: null,
    hooksInstalled: false,
    claudeApplied: false,
    /** Hooks of ours that an older Jarvis wrote and Connect would write differently. */
    hooksStale: false,
    /** The folder of another Jarvis whose current hooks Claude Code carries; null when none does. */
    hooksElsewhere: null,
    /** Why the last Connect or Disconnect failed, for the Settings sheet; null once one succeeds. */
    connectionProblem: null,
    /** Whether to offer this machine the skills package the Maestro prefers. */
    maestroOffer: false,
    /** Named on the card, so nobody has to take on trust what Install runs. */
    maestroInstallCommand: maestro.INSTALL_COMMAND,
    modelPresent: false,
    voiceAvailable: true,
    shortcuts: [],
    skills: [],
    lastProject: null,
    theme: 'dark',
    model: 'medium',
    shell: defaultShell(),
    terminalFontSize: TERMINAL_FONT.size,
    speechRate: 0,
    readingVoice: null,
    recentReadings: [],
    /** The answer the message is about, when it arrived while another window read. */
    waitingReading: null,
    /** Whether new Sessions open already caught up from past conversations. */
    /** Which side the panel is on, and whether it is retracted. The window is
     * what applies these; the panel is told so it can draw itself the right way
     * round and point the mover at the edge it is going to next. */
    panelPosition: 'right',
    panelCollapsed: false,
    /** Which Parts are on and in what order, the Deck blocks among them; see spineChoices. */
    ...spineChoices(preferences.DEFAULTS),
    /** Whether the Plan block's two sounds are silenced; one for every window. */
    deckPlanMuted: false,
    /** The Deck's own type size, in pixels; one for every window. */
    deckFontSize: DECK_FONT.size,
    /** How the Commands and the Skills look, and the Spine's text; one for every window. */
    commandColumns: preferences.DEFAULTS.commandColumns,
    skillColumns: preferences.DEFAULTS.skillColumns,
    spineFontSize: preferences.DEFAULTS.spineFontSize,
    commandFontSize: preferences.DEFAULTS.commandFontSize,
    skillFontSize: preferences.DEFAULTS.skillFontSize,
  }

  let readingHistory = []
  let nextReadingId = 1
  let pendingTitles = []
  let speaking = { text: '', at: 0 }
  let queuedReading = null

  function settings() {
    try {
      return preferences.read()
    } catch (error) {
      report(error?.message ?? 'Could not read your settings; using the defaults.')
      return preferences.DEFAULTS
    }
  }

  // --- Talking to this Session's panes ---------------------------------------

  /** Everything the Panel draws from, the Deck's block views included. */
  function panelState() {
    return {
      ...core.state,
      hasLiveSession: core.hasLiveSession,
      ...surface,
      deck: deck.view(),
      languageLabel: languages.shortLabel(core.state.language),
    }
  }

  function publish() {
    // Whatever the reason for this publish, it carries the Deck as it is now,
    // so a Deck publish still waiting has nothing left to say.
    deck.sent()
    const contents = win.panelContents()
    if (contents) contents.send('state', panelState())
  }

  /**
   * What the Claude Code in this Session is doing — the Deck. Its changes go
   * out at most once every 250 ms; see deck-feed.js.
   */
  const deck = createDeckFeed({
    publish,
    holds: (sessionId) => core.state.activeSessionId === sessionId,
    // A plan's sounds play in this window, the one the plan belongs to, and
    // never while muted or while the Plan block is off.
    chime: (sound) => sounds.planSounds.play(sound, win.panelContents()),
    muted: () => surface.deckPlanMuted || !surface.deckBlocks.plan,
  })

  function broadcastAppearance() {
    win.paintGround(surface.theme)
    for (const contents of [win.terminalContents(), win.settingsContents()]) {
      if (contents) contents.send('theme', surface.theme)
    }
    const terminalPane = win.terminalContents()
    if (terminalPane) terminalPane.send('terminal:font-size', surface.terminalFontSize)
  }

  function say(message) {
    surface.message = message
    surface.waitingReading = null
    surface.problem = null
    publish()
  }

  function report(problem) {
    surface.problem = problem
    publish()
  }

  /**
   * Text onto the clipboard. The clipboard is a promise in Electron 44; nothing
   * waits on the write, but a rejection nobody catches ends the whole main
   * process.
   */
  function toClipboard(text) {
    clipboard.writeText(text).catch(() => report('Could not reach the clipboard.'))
  }

  function sendToPanel(channel, payload) {
    const contents = win.panelContents()
    if (contents) contents.send(channel, payload)
  }

  // --- Running the core's effects --------------------------------------------

  function run(effects) {
    let waitFor = 0

    for (const effect of effects) {
      switch (effect.type) {
        case 'sendTextToTerminal':
          if (!term.insert(effect.text)) report('There is no terminal open to send that to.')
          break

        case 'runInTerminal':
          if (!term.run(effect.command)) report('There is no terminal open to run that in.')
          break

        case 'speak':
          startReading(effect.text, effect.language, waitFor)
          break

        case 'stopSpeaking':
          cancelQueuedReading()
          speech.stop()
          pendingTitles = []
          stopPlayback()
          surface.voice = null
          break

        case 'pauseSpeaking':
          sendToPanel('voice:pause')
          break

        case 'resumeSpeaking':
          sendToPanel('voice:resume')
          break

        case 'replayReading':
          replayReading(effect.id)
          break

        case 'startListening':
          beginDictation(effect.language)
          break

        case 'stopListening':
          dictation.finish()
          break

        case 'cancelListening':
          dictation.cancel()
          break

        case 'play':
          waitFor += sounds.play(effect.sound, win.panelContents())
          break

        case 'log':
          try {
            scribe.append(effect.entry)
          } catch {
            report('Could not write to the transcript.')
          }
          break

        default:
          break
      }
    }

    publish()
  }

  function dispatch(event) {
    run(core.dispatch(event))
  }

  // --- Reading aloud ---------------------------------------------------------

  /**
   * `takeOver` is for a reading the user asked for by name: it stops whatever
   * another window is reading instead of waiting behind it.
   */
  function startReading(text, language, delay, { takeOver = false } = {}) {
    cancelQueuedReading()

    if (speech.installedVoices().length === 0) {
      queuedReading = { text, language, delay, waitingForVoices: true }
      return
    }

    const stored = settings()
    const voice = chooseVoice(stored.voices[language], language)

    if (voice === '') {
      surface.voiceAvailable = false
      report(speech.howToInstallVoice(language))
      dispatch(user.speechFinished())
      return
    }

    // One voice at a time across every window. If another window is already
    // reading, this answer does not cut it off: it waits in this window's
    // reading list, with a notice, to be read on request instead.
    if (!takeOver && deps.isVoiceBusy(session)) {
      deferReading(text)
      return
    }

    // The voice is free: take it. The audio and its progress route back to
    // whoever is holding it now — this Session.
    deps.acquireVoice(session)

    surface.voiceAvailable = true
    const chosen = speech.voicesFor(language).find((each) => each.name === voice)
    surface.readingVoice = chosen?.label ?? chosen?.name ?? null
    surface.speechRate = stored.speechRate ?? 0
    speaking = { text, at: 0 }
    surface.voice = { phase: 'preparing', at: 0, seconds: 0 }

    const begin = () => {
      pendingTitles.push(readingTitle(text))
      speech.speak(text, { voice, rate: stored.speechRate ?? 0 })
    }
    if (delay > 0) {
      queuedReading = { timer: setTimeout(begin, delay) }
    } else {
      begin()
    }
  }

  function stopPlayback() {
    sendToPanel('voice:stop')
  }

  function readingTitle(text) {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim()
    return line.length > 80 ? `${line.slice(0, 79)}…` : line
  }

  function pushReading(entry) {
    readingHistory.unshift(entry)
    readingHistory = readingHistory.slice(0, HISTORY_LIMIT)
    surface.recentReadings = readingHistory.map(({ id, title }) => ({ id, title }))
  }

  function rememberReading(arrayBuffer, title) {
    pushReading({
      id: `reading-${nextReadingId++}`,
      title: title || readingTitle(speaking.text),
      voiceLabel: surface.readingVoice,
      wav: arrayBuffer,
    })
  }

  /**
   * An answer that arrived while another window held the voice. It is not read;
   * it waits in the list as text, and is synthesised only if the user plays it.
   */
  function deferReading(text) {
    const id = `reading-${nextReadingId++}`
    pushReading({ id, title: readingTitle(text), text, wav: null })
    surface.voice = null
    surface.message = languages.newAnswerNotice(core.state.language)
    surface.waitingReading = id
    surface.problem = null
    // The core marked a reading as started; undo that, since nothing is reading.
    dispatch(user.speechFinished())
  }

  function replayReading(id) {
    // Played, from the notice or the list: the notice about it has done its job.
    if (surface.waitingReading === id) {
      surface.message = null
      surface.waitingReading = null
    }
    const entry = readingHistory.find((each) => each.id === id)
    if (!entry) {
      surface.voice = null
      dispatch(user.speechFinished())
      return
    }
    // A deferred answer kept only as text: read it now, from scratch. The user
    // asked for this one, so it stops another window's reading rather than
    // waiting behind it.
    if (!entry.wav && entry.text) {
      startReading(entry.text, core.state.language, 0, { takeOver: true })
      return
    }
    deps.acquireVoice(session)
    cancelQueuedReading()
    speech.stop()
    pendingTitles = []
    surface.readingVoice = entry.voiceLabel
    surface.voice = { phase: 'playing', at: 0, seconds: 0 }
    sendToPanel('voice:play', entry.wav)
    publish()
  }

  /** The synthesised reading, handed to this Session's panel to play. */
  function playAudio(file) {
    let wav
    try {
      wav = fs.readFileSync(file)
    } catch (error) {
      surface.voice = null
      dispatch(user.speechFinished())
      report(`Could not play the reading: ${error?.message ?? 'the audio went missing'}.`)
      return
    }
    try {
      fs.unlinkSync(file)
    } catch {
      // Left behind in the temporary folder; Windows will see to it.
    }

    const contents = win.panelContents()
    if (!contents) {
      dispatch(user.speechFinished())
      return
    }
    const arrayBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)
    rememberReading(arrayBuffer, pendingTitles.shift())
    contents.send('voice:play', arrayBuffer)
    publish()
  }

  /**
   * Told by the registry that another Session has taken the voice: stop the
   * sound here and let the core know this reading is over.
   */
  function stopReadingLocally() {
    cancelQueuedReading()
    pendingTitles = []
    stopPlayback()
    surface.voice = null
    if (core.state.isSpeaking) dispatch(user.speechFinished())
    else publish()
  }

  function chooseVoice(stored, language) {
    const available = speech.voicesFor(language)
    if (available.length === 0) return ''
    if (typeof stored !== 'string' || stored === '') return available[0].name

    const exact = available.find((each) => each.name === stored)
    if (exact) return exact.name
    const renamed = available.find((each) => each.name.startsWith(stored))
    return (renamed ?? available[0]).name
  }

  function cancelQueuedReading() {
    if (!queuedReading) return
    if (queuedReading.timer) clearTimeout(queuedReading.timer)
    queuedReading = null
  }

  /** The voice list arrived: pick up a reading that was waiting for it. */
  function voicesArrived() {
    surface.voiceAvailable = speech.canRead(core.state.language)
    const waiting = queuedReading
    if (waiting?.waitingForVoices) {
      queuedReading = null
      startReading(waiting.text, waiting.language, 0)
    } else {
      const language = core.state.language
      speech.warmUp(chooseVoice(settings().voices[language], language))
    }
    publish()
  }

  function speechFinished() {
    surface.voice = null
    dispatch(user.speechFinished())
  }

  function voiceError(message) {
    report(`The voice stopped working: ${message}`)
  }

  /** The registry took the microphone for another Session: end listening here. */
  function stopListeningLocally() {
    if (core.state.isListening) dispatch(user.cancelDictationPressed())
  }

  // --- Dictation (the microphone is shared; this Session must hold it) --------

  function beginDictation(language) {
    deps.acquireMic(session)
    const stored = settings()
    const modelName = stored.model ?? models.DEFAULT

    if (!dictation.isModelPresent(modelName)) {
      say(models.downloadNotice(modelName))
    }

    dictation.start({
      modelName,
      languageCode: language === languages.PORTUGUESE ? 'portuguese' : 'english',
    })
  }

  function dictationPreview(text) {
    dispatch(user.dictationPartial(text))
  }
  function dictationFinal(text) {
    surface.downloading = null
    dispatch(user.dictationFinal(text))
  }
  function dictationDownloading(progress) {
    surface.downloading = Math.round(progress)
    publish()
  }
  function dictationReady() {
    surface.downloading = null
    surface.modelPresent = true
    publish()
  }
  function dictationFailed(message) {
    surface.downloading = null
    dispatch(user.dictationFinal(''))
    report(`Could not transcribe: ${message}`)
  }

  // --- Sessions --------------------------------------------------------------

  async function openSession() {
    const chosen = await dialog.showOpenDialog(win.window(), {
      title: 'Choose the project folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (chosen.canceled || chosen.filePaths.length === 0) return
    openProject(chosen.filePaths[0])
  }

  function openProject(projectPath) {
    const stored = settings()

    try {
      scribe.begin(projectPath)
    } catch {
      report('Could not create the transcript in that folder.')
    }

    // Each shell gets a name of its own: a session started in it is recognised
    // by it, even while Jarvis still holds one that ended without saying so.
    const terminal = crypto.randomUUID()
    deck.clear()
    dispatch(user.projectOpened(normalize(projectPath), terminal))

    try {
      term.open({
        projectPath,
        shell: stored.shell,
        terminal,
        onExit: () => {
          forgetOpenProject()
          dispatch(user.sessionLost())
        },
      })
    } catch (error) {
      report(`Could not start ${stored.shell}: ${error?.message ?? 'unknown reason'}.`)
      return
    }

    surface.projectName = path.basename(projectPath)
    surface.projectPath = projectPath
    surface.lastProject = projectPath
    surface.shell = stored.shell
    win.nameProject(surface.projectName)
    try {
      preferences.store().rememberSession(projectPath, String(Date.now()))
    } catch {
      // Only costs a slower start next time.
    }
    say(null)
  }

  function forgetOpenProject() {
    surface.projectName = null
    surface.projectPath = null
    win.nameProject(null)
  }

  function closeProject() {
    term.close()
    scribe.end()
    forgetOpenProject()
    try {
      preferences.store().forgetSession()
    } catch {
      // Nothing worth stopping for.
    }
    deck.clear()
    dispatch(user.projectClosed())
  }

  // --- Hooks -----------------------------------------------------------------

  /**
   * True when a hook event came from this Session's project, or a folder inside
   * it. `exactly` asks for the project folder itself, so the registry can prefer
   * a window open on that very folder over one open on a folder above it.
   */
  function matchesProject(workingDirectory, { exactly = false } = {}) {
    if (surface.projectPath === null) return false
    return exactly
      ? samePath(workingDirectory, surface.projectPath)
      : within(workingDirectory, surface.projectPath)
  }

  /** True when the event came from the terminal this Session opened. */
  function ownsTerminal(terminal) {
    return terminal !== null && core.state.terminal === terminal
  }

  /** True when this Session's core has already adopted this Claude Code session. */
  function ownsClaudeSession(sessionId) {
    return core.state.activeSessionId === sessionId
  }

  function hasActiveSession() {
    return core.state.activeSessionId !== null
  }

  /** Handle a hook event the registry has already decoded and routed here. */
  function receive(incoming) {
    hearAgentEvent(incoming, {
      core,
      deck,
      remember: (sessionId) => preferences.store().rememberClaudeSession(sessionId),
      run,
    })
  }

  /** A status-line reading the registry has routed here: for the Deck alone. */
  function receiveStatus(reading) {
    hearStatus(reading, { core, deck })
  }

  function refreshHookState() {
    // The switch is one choice for the whole app, and every window is refreshed
    // whenever one of them changes the connection. So a window that did not
    // press the switch catches up here, before it asks whether the host is
    // already saying what Jarvis wants it to say — otherwise it would answer
    // for a language nobody is showing any more.
    const stored = settings()
    if (stored.language !== core.state.language) dispatch(user.languageToggled())

    try {
      surface.hooksInstalled = hooks.installer().isInstalled()
    } catch {
      surface.hooksInstalled = false
    }
    try {
      surface.hooksStale = hooks.installer().isStale()
    } catch {
      surface.hooksStale = false
    }
    try {
      surface.hooksElsewhere = hooks.installer().elsewhere()
    } catch {
      surface.hooksElsewhere = null
    }
    try {
      surface.claudeApplied = claudeConfig.configurator(core.state.language).isApplied()
    } catch {
      surface.claudeApplied = false
    }
    try {
      surface.maestroOffer = maestro.shouldOffer()
    } catch {
      surface.maestroOffer = false
    }
    publish()
  }

  /** The two writers Connect and Disconnect order between them (src/core/connection.js). */
  function connectionParts() {
    return { personality: claudeConfig.configurator(core.state.language), hooks: hooks.installer() }
  }

  function installHooks() {
    try {
      connection.connect(connectionParts())
      surface.connectionProblem = null
      say('Jarvis is connected: it hears Claude Code, and reads its answers aloud.')
    } catch (error) {
      // Connect takes back what it did when it fails, so without this the sheet
      // would simply go on saying what it said before, as if nothing was pressed.
      surface.connectionProblem = error?.message ?? 'Could not write to Claude Code’s configuration.'
      report(surface.connectionProblem)
    }
    deps.broadcastHookState()
  }

  /**
   * The panel's PT/EN switch is what Claude Code answers in, so pressing it has
   * to reach the host's settings as well as the microphone and the voice.
   *
   * Only while Jarvis is connected: a machine Jarvis was never plugged into is
   * one it writes nothing to, and Connect will carry the language over anyway.
   * Claude Code reads the setting when a session starts, so the new language
   * arrives with the next session rather than mid-answer.
   *
   * The settings only: the plan server's entry does not depend on the language,
   * and ~/.claude.json, which Claude Code keeps rewriting, is touched by Connect
   * and Disconnect alone.
   */
  function followLanguage() {
    if (!surface.claudeApplied) return
    try {
      claudeConfig.configurator(core.state.language).apply({ servers: false })
    } catch (error) {
      report(error?.message ?? 'Could not write to Claude Code’s configuration.')
    }
    deps.broadcastHookState()
  }

  function removeHooks() {
    try {
      connection.disconnect(connectionParts())
      surface.connectionProblem = null
      say('Jarvis is disconnected, and Claude Code is back the way it was.')
    } catch (error) {
      surface.connectionProblem = error?.message ?? 'Could not write to Claude Code’s configuration.'
      report(surface.connectionProblem)
    }
    deps.broadcastHookState()
  }

  // --- Lifecycle -------------------------------------------------------------

  function begin() {
    const stored = settings()
    surface.shortcuts = preferences.store().shortcuts()
    surface.skills = preferences.store().skills()
    surface.modelPresent = dictation.isModelPresent(stored.model ?? models.DEFAULT)
    rememberAppearance(stored)
    broadcastAppearance()

    if (stored.autoRead !== core.state.autoRead) dispatch(user.autoReadSet(stored.autoRead))
    // Before the hook state is read: what Claude Code should answer in is the
    // remembered language, so asking whether the host already says so has to
    // come after the language is back.
    if (stored.language !== core.state.language) dispatch(user.languageToggled())
    refreshHookState()

    // A project left open last time is offered, not reopened: a shell Jarvis
    // started does not outlive Jarvis, so there is nothing to reattach to.
    if (stored.projectPath) {
      say(`Last time you had ${path.basename(stored.projectPath)} open. Reopen it?`)
      surface.lastProject = stored.projectPath
    }

    publish()
  }

  /** Where the panel sits, written down. A failed write is said out loud
   * rather than swallowed: the panel has already moved, and the thing that
   * failed is the promise that it will still be there tomorrow. */
  function storeShape(patch) {
    try {
      preferences.write(patch)
    } catch (error) {
      report(error?.message ?? 'Could not remember where the panel goes.')
    }
  }

  function rememberAppearance(stored) {
    surface.theme = stored.theme ?? 'dark'
    surface.terminalFontSize = stored.terminalFontSize ?? TERMINAL_FONT.size
    surface.model = stored.model ?? models.DEFAULT
    surface.shell = stored.shell
    surface.speechRate = stored.speechRate ?? 0
    Object.assign(surface, spineChoices(stored))
    surface.deckPlanMuted = stored.deckPlanMuted === true
    surface.deckFontSize = stored.deckFontSize ?? DECK_FONT.size
    // How the Commands and the Skills look, and the Spine's text: stored with
    // the rest, so every window draws them alike.
    for (const key of ['commandColumns', 'skillColumns', 'spineFontSize', 'commandFontSize', 'skillFontSize']) {
      surface[key] = stored[key]
    }
    rememberPanelShape()
  }

  /** What the window ended up doing with the stored shape, copied onto the
   * surface so the panel draws from the same answer the panes were laid out
   * from — never from the preferences file, which the window may have had to
   * refuse for want of room. */
  function rememberPanelShape(shape = win.panelShape()) {
    surface.panelPosition = shape.position
    surface.panelCollapsed = shape.collapsed
  }

  /** Tears the Session down: its shell, its log. The window is destroyed by the
   * registry. */
  function close() {
    deck.stop()
    cancelQueuedReading()
    term.close()
    scribe.end()
  }

  /** One list's order stored by the preferences' `setter`, and every window redrawn. */
  function storeOrder(setter, ids) {
    if (!Array.isArray(ids)) return
    try {
      preferences.store()[setter](ids)
    } catch (error) {
      report(error?.message ?? 'Could not remember that order.')
    }
    deps.broadcastShortcuts?.()
  }

  // --- What the panes can ask for --------------------------------------------

  const actions = {
    openSession,
    closeSession: closeProject,
    openProject,
    reopenLastProject: () => {
      // The one the button offers — this window's own last project. Not the
      // globally-stored one, which a different window, or closing a session,
      // can change out from under the button that is still showing this name.
      if (surface.lastProject) openProject(surface.lastProject)
    },
    micPressed: () => dispatch(user.micPressed()),
    cancelDictation: () => dispatch(user.cancelDictationPressed()),
    stopSpeech: () => dispatch(user.stopSpeechPressed()),
    repeatLast: () => dispatch(user.repeatLastPressed()),
    pauseSpeech: () => dispatch(user.pauseSpeechPressed()),
    resumeSpeech: () => dispatch(user.resumeSpeechPressed()),
    replayReading: (id) => dispatch(user.replayReadingPressed(id)),
    toggleLanguage: () => {
      dispatch(user.languageToggled())
      try {
        preferences.write({ language: core.state.language })
      } catch (error) {
        report(error?.message ?? 'Could not remember that setting.')
      }
      followLanguage()
    },
    setAutoRead: (enabled) => {
      try {
        preferences.write({ autoRead: Boolean(enabled) })
      } catch (error) {
        report(error?.message ?? 'Could not remember that setting.')
      }
      dispatch(user.autoReadSet(Boolean(enabled)))
    },
    /**
     * One Part of the page, on or off, by its id — a Deck block or a section.
     * Stored for every window, and every other window catches up at once.
     */
    setPart: (choice) => {
      const part = spine.PARTS.find((each) => each.id === choice?.part)
      if (!part) return
      try {
        preferences.write({ [part.preference]: Boolean(choice.on) })
      } catch (error) {
        report(error?.message ?? 'Could not remember that setting.')
      }
      Object.assign(surface, spineChoices(settings()))
      publish()
      deps.broadcastSpine?.()
    },
    /**
     * The Spine's order, which is the page's, as a drop on the Spine sends it:
     * made whole by spine.js (unknown ids dropped, missing ones appended) and
     * stored for every window, every other window catching up at once.
     */
    setSpineOrder: (ids) => {
      if (!Array.isArray(ids)) return
      try {
        preferences.write({ spineOrder: spine.cleanOrder(ids) })
      } catch (error) {
        report(error?.message ?? 'Could not remember that order.')
      }
      Object.assign(surface, spineChoices(settings()))
      publish()
      deps.broadcastSpine?.()
    },
    /** The Plan block's mute. Stored for every window, and every other window catches up at once. */
    setDeckPlanMuted: (muted) => {
      try {
        preferences.write({ deckPlanMuted: Boolean(muted) })
      } catch (error) {
        report(error?.message ?? 'Could not remember that setting.')
      }
      surface.deckPlanMuted = settings().deckPlanMuted === true
      publish()
      deps.broadcastSpine?.()
    },
    /** Another window changed the Spine or the Plan's mute: catch up, if anything moved. */
    reloadSpine: () => {
      const stored = settings()
      const now = spineChoices(stored)
      const muted = stored.deckPlanMuted === true
      const was = { parts: surface.parts, spineOrder: surface.spineOrder, spineHidden: surface.spineHidden }
      const is = { parts: now.parts, spineOrder: now.spineOrder, spineHidden: now.spineHidden }
      if (JSON.stringify(was) === JSON.stringify(is) && muted === surface.deckPlanMuted) return
      Object.assign(surface, now)
      surface.deckPlanMuted = muted
      publish()
    },
    /**
     * The Commands, or the Skills, in the order a drop in the Panel gives, by
     * id. Stored for every window, and every window redraws.
     */
    setShortcutOrder: (ids) => storeOrder('setShortcutOrder', ids),
    setSkillOrder: (ids) => storeOrder('setSkillOrder', ids),
    pressShortcut: (id) => {
      const found = surface.shortcuts.find((each) => each.id === id)
      if (found) dispatch(user.shortcutPressed(found))
    },
    pressSkill: (id) => {
      const found = surface.skills.find((each) => each.id === id)
      if (found) dispatch(user.shortcutPressed(found))
    },
    /**
     * The Memory button. Sends Claude Code a short request to read the
     * project's latest conversations in its .jarvis folder, and submits it —
     * pressed when Claude Code is the one listening, which the user can see.
     */
    recallConversations: () => {
      if (!term.run(languages.recallConversationsPrompt(core.state.language))) {
        report('There is no terminal open to send that to.')
      }
    },
    /**
     * The last answer, on the clipboard.
     *
     * It is the text Claude Code reported, not what the terminal drew, so it
     * arrives as prose rather than as a screenful of box-drawing and colour
     * codes that has to be cleaned up before it can be pasted anywhere.
     *
     * Nothing is said back. The Rail marks the button itself for a moment, and
     * a notice card for something done several times an hour would only be a
     * card to dismiss several times an hour.
     */
    copyAnswer: () => {
      const text = core.state.lastAssistantText
      if (typeof text !== 'string' || text.trim() === '') {
        report('There is no answer to copy yet.')
        return
      }
      toClipboard(text)
    },

    /**
     * What the user selected in the terminal pane, on the clipboard — Ctrl+C
     * with a selection, as in any Windows terminal.
     */
    copySelection: (text) => {
      if (typeof text !== 'string' || text === '') return
      toClipboard(text)
    },

    /**
     * What is on the clipboard, pasted into the input line and left there.
     *
     * Handed to the pane rather than typed from here, so the button follows the
     * same rule as Ctrl+V: whole where the program in front asked for bracketed
     * paste, flattened where it did not. Never submitted either way, for the
     * same reason dictation is not: pressing Enter is the user's act, and
     * Claude Code has tools that delete files. The cursor goes back to the
     * terminal so the next thing typed lands after it.
     */
    pasteIntoTerminal: async () => {
      let text = ''
      try {
        text = await clipboard.readText()
      } catch {
        report('Could not read the clipboard.')
        return
      }
      if (text === '') {
        report('There is nothing on the clipboard to paste.')
        return
      }
      if (!term.offerPaste(text)) {
        report('Open a project first — there is no terminal to paste into.')
        return
      }
      win.focusTerminal()
    },

    /**
     * A paste made in the terminal pane itself — Ctrl+V, Cmd+V, the Edit menu,
     * a right click. The pane read the clipboard and knows whether the program
     * in front asked for bracketed paste; `typed-text.js` decides what that
     * makes of the text.
     *
     * An empty paste only arrives where the program asked for bracketed paste,
     * and is sent on: it is how Claude Code is told to take an image from the
     * clipboard. Nothing is said for it either way.
     */
    pasteFromTerminal: (paste) => {
      const text = paste?.text
      if (typeof text !== 'string') return
      if (!term.paste(text, paste.bracketed === true)) {
        report('Open a project first — there is no terminal to paste into.')
      }
    },
    /**
     * The project's own folder, in the machine's file browser.
     *
     * `shell.openPath` and never a command line: handing a path Jarvis did not
     * write to a shell is how a folder name with a quote in it becomes an
     * instruction. Electron asks the operating system to open it, which is the
     * same thing double-clicking it does.
     */
    openProjectFolder: () => {
      if (!surface.projectPath) {
        report('Open a project first — there is no folder to show.')
        return
      }
      systemShell.openPath(surface.projectPath).then((problem) => {
        if (problem) report(`Could not open the project folder: ${problem}`)
      })
    },
    focusTerminal: () => win.focusTerminal(),
    openSettings: () => win.showSettings(),
    /**
     * A right click on a Command, or a Skill, in the Panel: Settings opened at
     * its row, ready to edit.
     */
    editShortcut: (id) => {
      if (surface.shortcuts.some((each) => each.id === id)) win.editRow('shortcuts', id)
    },
    editSkill: (id) => {
      if (surface.skills.some((each) => each.id === id)) win.editRow('skills', id)
    },
    closeSettings: () => win.hideSettings(),
    toggleSettings: () => win.toggleSettings(),
    releaseFocus: () => win.focusTerminal(),
    /**
     * The panel dragged from its inner edge. Live and not written down: the
     * pointer reports every few milliseconds, and a preferences file rewritten
     * at that rate is a file being rewritten while it is being read.
     */
    resizePanel: (measure) => win.resizePanel(measure),

    /** Once, when the drag ends. This is the number worth keeping. */
    rememberPanelMeasure: () => {
      const shape = win.panelShape()
      const field = geometry.isSide(shape.position) ? 'railWidth' : 'bandHeight'
      storeShape({ [field]: shape.measure })
    },

    /**
     * One button, walking the four sides. The arrow on its face points at where
     * it is going, so the cycle has to be the one the core names — see
     * `nextPosition`, and ADR 0009 for why this is a button and not a key
     * combination.
     */
    movePanel: () => actions.placePanel(geometry.nextPosition(surface.panelPosition)),

    /** The Panel put on one side by name — from Settings' four drawings. */
    placePanel: (position) => {
      if (!geometry.isPosition(position)) return
      const shape = win.setPanelPosition(position)
      rememberPanelShape(shape)
      storeShape({ panelPosition: shape.position })
      publish()
    },

    togglePanelCollapsed: () => {
      const shape = win.setPanelCollapsed(!surface.panelCollapsed)
      rememberPanelShape(shape)
      storeShape({ panelCollapsed: shape.collapsed })
      publish()
    },
    setTheme: (name) => {
      try {
        preferences.write({ theme: name })
      } catch (error) {
        report(error?.message ?? 'Could not remember that theme.')
      }
      surface.theme = settings().theme
      broadcastAppearance()
      publish()
    },
    dismissMessage: () => {
      core.clearNotice()
      surface.message = null
      surface.waitingReading = null
      surface.problem = null
      publish()
    },
    installHooks,
    removeHooks,
    refreshHookState,
    // The Maestro carries its own copies of the skills it reads, so this is an
    // offer and never a requirement. Only a no is written down: whether the
    // install worked is answered by looking for the package afterwards, not by
    // whether the command was typed, so an install that failed is offered again.
    installSkillsPackage: () => {
      if (!term.run(maestro.INSTALL_COMMAND)) {
        report('Open a project first — the install runs in its terminal.')
        return
      }
      deps.broadcastHookState()
    },
    declineSkillsPackage: () => {
      maestro.rememberRefusalHere()
      deps.broadcastHookState()
    },
    reloadShortcuts: () => {
      surface.shortcuts = preferences.store().shortcuts()
      surface.skills = preferences.store().skills()
      publish()
    },
    reloadSettings: () => {
      const before = `${surface.theme}/${surface.terminalFontSize}`
      rememberAppearance(settings())
      if (`${surface.theme}/${surface.terminalFontSize}` !== before) broadcastAppearance()
      publish()
    },
    reloadVoices: () => {
      surface.voiceAvailable = speech.canRead(core.state.language)
      publish()
    },
    voiceAt: ({ at, seconds }) => {
      if (!surface.voice) return
      surface.voice = { phase: 'playing', at, seconds }
      publish()
    },
    voiceEnded: () => {
      surface.voice = null
      dispatch(user.speechFinished())
    },
    openWindowsMicrophoneSettings: () => systemShell.openExternal('ms-settings:privacy-microphone'),
    collectAudio: (buffer) => dictation.collect(buffer),
    microphoneDenied: () => {
      dispatch(user.cancelDictationPressed())
      report(
        'Windows is blocking the microphone. Turn it on in Settings → Privacy & security → ' +
          'Microphone, including "Let desktop apps access your microphone".',
      )
    },
    microphoneReady: () => dictation.markReady(),
    terminalReady: () => {
      term.markReady()
      broadcastAppearance()
      publish()
    },
    terminalInput: (data) => term.typeFromUser(data),
    terminalResize: ({ cols, rows }) => term.resize(cols, rows),
    state: panelState,
    voices: () => speech.installedVoices(),
    voicesWhenKnown: async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const found = speech.installedVoices()
        if (found.length > 0) return found
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      return speech.installedVoices()
    },
    models: () => models.MODELS,
    publish,
  }

  const session = {
    win,
    core,
    actions,
    begin,
    close,
    dispatch,
    run,
    publish,
    refreshHookState,
    // Registry-facing:
    ownsContents: (webContents) => win.ownsContents(webContents),
    matchesProject,
    ownsTerminal,
    ownsClaudeSession,
    hasActiveSession,
    receive,
    receiveStatus,
    playAudio,
    speechFinished,
    stopReadingLocally,
    voicesArrived,
    voiceError,
    stopListeningLocally,
    dictationPreview,
    dictationFinal,
    dictationDownloading,
    dictationReady,
    dictationFailed,
    isReading: () => core.state.isSpeaking,
    isListening: () => core.state.isListening,
  }

  return session
}

module.exports = { createSession }
