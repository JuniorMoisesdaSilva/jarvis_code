'use strict'

// Jarvis's core: an event goes in, a list of effects comes out.
//
// Nothing here knows about the terminal, the microphone, the synthesizer or the
// disk — those are all effects the adapters carry out. That shape is what makes
// it possible to test the app's whole behaviour, conflict rules included, by
// feeding it real events captured from Claude Code and checking what comes out.

const language = require('./language')
const { Sound, EntryKind, entry, effect } = require('./effects')
const filter = require('./speech-text-filter')
const announcement = require('./permission-announcement')
const { samePath } = require('./paths')

/** The app's observable state. The Panel reads from here; the core writes it. */
function initialState(overrides = {}) {
  return {
    autoRead: true,
    language: language.PORTUGUESE,
    isListening: false,
    /** Listening has ended and we are waiting for the engine's final text. */
    isFinishingDictation: false,
    isSpeaking: false,
    /** A running reading that has been paused, its position held to resume. */
    isPaused: false,
    partialText: '',
    lastAssistantText: null,
    lastPermissionDetail: null,
    /**
     * Last text delivered by Dictation, kept until the message is submitted. It
     * is what lets the Transcript mark what came from the voice and what came
     * from the keyboard — and what keeps a message from being logged twice.
     */
    lastDictatedText: null,
    activeSessionId: null,
    /**
     * Folder of the project open in the Panel, already normalized. While it is
     * null, Jarvis answers to no session at all.
     */
    projectPath: null,
    /**
     * Short message for the Panel — today only the end of a session. It stays
     * until dismissed, or until a new session begins.
     */
    notice: null,
    ...overrides,
  }
}

function isBlank(text) {
  return typeof text !== 'string' || text.trim() === ''
}

class JarvisCore {
  constructor(state = {}) {
    this.state = initialState(state)
  }

  /** Is there a live session Jarvis is attached to? */
  get hasLiveSession() {
    return this.state.activeSessionId !== null
  }

  // --- Events from Claude Code ------------------------------------------------

  /**
   * The single entry point for events coming from the tool.
   *
   * An event is answered only when it comes from the folder of the project open
   * in the Panel. Without that filter Jarvis would adopt the first session that
   * spoke — in practice, reading aloud the answers of a project it cannot write
   * to, while ignoring the session it opened itself.
   */
  receive(incoming) {
    const { projectPath } = this.state
    if (projectPath === null) return []
    if (!samePath(incoming.workingDirectory, projectPath)) return []
    return this.handleAgentEvent(incoming.event)
  }

  /** The unrouted path. Callers outside the core should use `receive`. */
  handleAgentEvent(event) {
    switch (event.type) {
      case 'assistantFinished':
        return this.#assistantFinished(event)
      case 'permissionRequested':
        return this.#permissionRequested(event)
      case 'userPromptSubmitted':
        return this.#userPromptSubmitted(event)
      case 'sessionStarted':
        // Nothing to say and nothing to do — but adopting it here is what makes
        // "Claude Code is open" knowable before the first word is exchanged.
        this.#adoptOrMatch(event.sessionId)
        return []
      case 'sessionEnded':
        return this.state.activeSessionId === event.sessionId
          ? this.#endSession({ announcing: true })
          : []
      default:
        return []
    }
  }

  #assistantFinished({ sessionId, text }) {
    if (!this.#adoptOrMatch(sessionId)) return []
    // A blank answer becomes neither a Transcript line nor speech.
    if (isBlank(text)) return []
    this.state.lastAssistantText = text

    const effects = [effect.log(entry(EntryKind.assistant, text))]
    if (!this.state.autoRead) return effects
    return effects.concat(this.#speakEffects(text))
  }

  #permissionRequested({ sessionId, toolName, detail }) {
    if (!this.#adoptOrMatch(sessionId)) return []
    this.state.lastPermissionDetail = detail

    const sentence = announcement.sentence(toolName, detail, this.state.language)
    this.state.lastAssistantText = sentence

    // Permission requests are always spoken, even with read-aloud off: this is
    // the moment where staying silent would leave the user waiting for an answer
    // that never comes.
    const effects = [effect.log(entry(EntryKind.permission, sentence))]
    if (this.state.isSpeaking) effects.push(effect.stopSpeaking())
    effects.push(effect.play(Sound.permissionNeeded))
    this.state.isSpeaking = true
    effects.push(effect.speak(sentence, this.state.language))
    return effects
  }

  #userPromptSubmitted({ sessionId, text }) {
    if (!this.#adoptOrMatch(sessionId)) return []
    if (isBlank(text)) return []
    const trimmed = text.trim()

    // If the submitted text is exactly what Dictation delivered, it came from
    // the voice. If you edited it before sending, it no longer is what you said.
    const kind = trimmed === this.state.lastDictatedText ? EntryKind.userVoice : EntryKind.userTyped
    this.state.lastDictatedText = null
    return [effect.log(entry(kind, trimmed))]
  }

  // --- Events from the user ---------------------------------------------------

  dispatch(event) {
    switch (event.type) {
      case 'projectOpened': {
        this.state.projectPath = event.path
        // Everything held belonged to the previous project: reading aloud the
        // answer of a project you closed is worse than not reading at all.
        this.state.activeSessionId = null
        this.state.lastAssistantText = null
        this.state.lastPermissionDetail = null
        this.state.lastDictatedText = null
        this.state.notice = null
        return this.#closeEverything()
      }

      case 'sessionRestored':
        this.state.activeSessionId = event.sessionId
        this.state.notice = null
        return []

      case 'sessionLost':
        // With no live session there is no surprise to announce.
        if (!this.hasLiveSession) return []
        return this.#endSession({ announcing: true })

      case 'projectClosed':
        this.state.projectPath = null
        return this.#endSession({ announcing: false })

      case 'shortcutPressed':
        return this.#shortcutPressed(event.shortcut)

      case 'micPressed':
        return this.#micPressed()

      case 'dictationPartial':
        if (!this.state.isListening) return []
        this.state.partialText = event.text
        return []

      case 'dictationFinal':
        return this.#dictationFinal(event.text)

      case 'cancelDictationPressed':
        if (!this.state.isListening) return []
        this.state.isListening = false
        this.state.isFinishingDictation = false
        this.state.partialText = ''
        return [effect.cancelListening()]

      case 'stopSpeechPressed':
        if (!this.state.isSpeaking) return []
        this.state.isSpeaking = false
        this.state.isPaused = false
        return [effect.stopSpeaking()]

      case 'repeatLastPressed':
        return this.#repeatLast()

      case 'pauseSpeechPressed':
        // Only a reading that is actually running can be held, and holding one
        // already held is nothing.
        if (!this.state.isSpeaking || this.state.isPaused) return []
        this.state.isPaused = true
        return [effect.pauseSpeaking()]

      case 'resumeSpeechPressed':
        if (!this.state.isSpeaking || !this.state.isPaused) return []
        this.state.isPaused = false
        return [effect.resumeSpeaking()]

      case 'replayReadingPressed':
        // Not while the microphone is open: playing a reading into a live
        // microphone would have it capture the app's own voice, the very thing
        // pressing the microphone stops a reading to avoid.
        if (this.state.isListening) return []
        // Play a stored reading again. It becomes the reading in progress, so a
        // held state from before it is cleared.
        this.state.isSpeaking = true
        this.state.isPaused = false
        return [effect.replayReading(event.id)]

      case 'autoReadSet':
        this.state.autoRead = event.enabled
        return []

      case 'languageToggled':
        return this.#languageToggled()

      case 'speechFinished':
        this.state.isSpeaking = false
        this.state.isPaused = false
        return []

      default:
        return []
    }
  }

  #shortcutPressed(shortcut) {
    if (isBlank(shortcut.command)) return []

    const effects = []
    // Reaching for a command means you are done listening.
    if (this.state.isSpeaking) {
      this.state.isSpeaking = false
      this.state.isPaused = false
      effects.push(effect.stopSpeaking())
    }
    // The command is sent as written, not trimmed: a shortcut that does not
    // submit often ends in a space on purpose, waiting for an argument.
    effects.push(
      shortcut.submits
        ? effect.runInTerminal(shortcut.command)
        : effect.sendTextToTerminal(shortcut.command),
    )
    return effects
  }

  #micPressed() {
    if (this.state.isListening) {
      // The engine still has to deliver the final text, so listening is only
      // considered over once it answers.
      if (this.state.isFinishingDictation) return []
      this.state.isFinishingDictation = true
      return [effect.stopListening()]
    }

    const effects = []
    // Pressing the microphone during a Reading interrupts it. Besides being the
    // natural way to cut someone off, it keeps the microphone from picking up
    // the app's own voice.
    if (this.state.isSpeaking) {
      this.state.isSpeaking = false
      this.state.isPaused = false
      effects.push(effect.stopSpeaking())
    }
    this.state.isListening = true
    this.state.partialText = ''
    effects.push(effect.play(Sound.listeningStarted))
    effects.push(effect.startListening(this.state.language))
    return effects
  }

  #dictationFinal(text) {
    if (!this.state.isListening) return []
    this.state.isListening = false
    this.state.isFinishingDictation = false
    this.state.partialText = ''

    const effects = [effect.play(Sound.listeningStopped)]
    if (isBlank(text)) return effects
    const trimmed = text.trim()

    // Nothing is logged here: the text has not been submitted yet, and it can
    // still be corrected or abandoned. The submit event does the logging; this
    // text is kept only to mark that entry as voice.
    this.state.lastDictatedText = trimmed

    // The text lands in Claude Code's input line without being submitted.
    // Submitting is always the user's act — recognition makes mistakes and the
    // agent has tools that delete files.
    effects.push(effect.sendTextToTerminal(trimmed))
    return effects
  }

  #repeatLast() {
    const text = this.state.lastAssistantText
    if (text === null) return []

    const effects = []
    if (this.state.isSpeaking) {
      effects.push(effect.stopSpeaking())
      this.state.isSpeaking = false
      this.state.isPaused = false
    }
    return effects.concat(this.#speakEffects(text))
  }

  #languageToggled() {
    this.state.language = language.next(this.state.language)
    if (!this.state.isListening) return []

    // Once you have pressed stop, the sentence you already spoke is on its way
    // and must still arrive. Cancelling and restarting here would leave the old
    // engine's final in flight, to be typed into the terminal after the new
    // listening had begun. So the new language waits for the next Dictation.
    if (this.state.isFinishingDictation) return []

    // Otherwise, switching mid-Dictation throws away what was said and starts
    // over: the engine is instantiated per language.
    this.state.partialText = ''
    return [effect.cancelListening(), effect.startListening(this.state.language)]
  }

  // --- Helpers ---------------------------------------------------------------

  /** Dismisses the Panel's notice. */
  clearNotice() {
    this.state.notice = null
  }

  /**
   * Ends the attachment to the session. Announcing is for when the ending came
   * as a surprise: if you asked for it yourself, being told would be noise.
   */
  #endSession({ announcing }) {
    this.state.activeSessionId = null
    const effects = this.#closeEverything()
    if (!announcing) return effects

    const notice = language.sessionEndedNotice(this.state.language)
    this.state.notice = notice
    // Spoken only with read-aloud on; written always.
    if (this.state.autoRead) {
      this.state.isSpeaking = true
      effects.push(effect.speak(notice, this.state.language))
    }
    return effects
  }

  /** Interrupts speech and listening. Used when there is no one left to talk to. */
  #closeEverything() {
    const effects = []
    if (this.state.isSpeaking) {
      this.state.isSpeaking = false
      this.state.isPaused = false
      effects.push(effect.stopSpeaking())
    }
    if (this.state.isListening) {
      this.state.isListening = false
      this.state.isFinishingDictation = false
      effects.push(effect.cancelListening())
    }
    return effects
  }

  #speakEffects(text) {
    const spoken = filter.spokenText(text, this.state.language)
    if (spoken === '') return []
    this.state.isSpeaking = true
    this.state.isPaused = false
    return [effect.speak(spoken, this.state.language)]
  }

  /**
   * With no active session, adopts the first one that shows up. With one active,
   * discards anything from another — that is what keeps you from dictating into
   * the wrong project.
   */
  #adoptOrMatch(sessionId) {
    if (this.state.activeSessionId === null) {
      this.state.activeSessionId = sessionId
      return true
    }
    return this.state.activeSessionId === sessionId
  }
}

module.exports = { JarvisCore, initialState }
