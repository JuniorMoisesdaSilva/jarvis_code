'use strict'

// Languages supported for Dictation and Reading.
//
// The synthesis voice must be chosen explicitly from this: Windows' default
// synthesis language does not follow the conversation's language, and without an
// explicit choice the assistant reads Portuguese with an English accent.

const PORTUGUESE = 'pt-BR'
const ENGLISH = 'en-US'

const ALL = Object.freeze([PORTUGUESE, ENGLISH])

/** Short label for the Panel. */
function shortLabel(language) {
  return language === PORTUGUESE ? 'PT' : 'EN'
}

function displayName(language) {
  return language === PORTUGUESE ? 'Portuguese (Brazil)' : 'English (US)'
}

/**
 * Spoken notice that there is no longer anyone to talk to. This one is content,
 * not interface: it comes out of the speakers in whichever language the user is
 * speaking.
 */
function sessionEndedNotice(language) {
  return language === PORTUGUESE
    ? 'A sessão do Claude Code foi encerrada.'
    : 'The Claude Code session has ended.'
}

/**
 * Spoken-language notice that an answer arrived in this window while another
 * window was reading aloud. One voice speaks at a time, so this one was not read
 * — it waits in the reading list instead. Content, in the language being spoken.
 */
function newAnswerNotice(language) {
  return language === PORTUGUESE
    ? 'Chegou uma resposta enquanto outra janela lia. Está na sua lista de leituras.'
    : 'An answer arrived while another window was reading. It is in your reading list.'
}

/**
 * The message the Memory button sends Claude Code, so it catches up from the
 * project's previous conversation logs. Content, not interface, so it is written
 * in the language being spoken. It names the folder rather than the files:
 * Claude Code finds the latest ones itself.
 */
function recallConversationsPrompt(language) {
  return language === PORTUGUESE
    ? 'Leia minhas últimas conversas na pasta .jarvis para ter mais contexto.'
    : 'Read my latest conversations in the .jarvis folder for more context.'
}

/**
 * The name Claude Code is told to answer in, which is the panel's switch and
 * nothing else: EN answers in English, PT in Portuguese, alongside the engine
 * that hears and the voice that reads. Claude Code's setting takes the
 * language's own name, and it reads it when a session starts — so a switch
 * reaches the next session rather than the answer being written now.
 */
function claudeName(language) {
  return language === PORTUGUESE ? 'portuguese' : 'english'
}

/** Cyclic toggle, used by the button and the keyboard shortcut. */
function next(language) {
  return language === PORTUGUESE ? ENGLISH : PORTUGUESE
}

function isLanguage(value) {
  return ALL.includes(value)
}

module.exports = {
  PORTUGUESE,
  ENGLISH,
  ALL,
  shortLabel,
  displayName,
  sessionEndedNotice,
  newAnswerNotice,
  recallConversationsPrompt,
  claudeName,
  next,
  isLanguage,
}
