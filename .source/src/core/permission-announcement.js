'use strict'

// Builds the sentence spoken when Claude Code asks for authorization.
//
// The hook event carries a ready human-readable description, but it always
// arrives **in English**, whatever the conversation's language. Read out with a
// Portuguese voice it would be noise. So the sentence is built here from the
// structured fields; the original description stays visible in the Panel for
// anyone who wants to read it.

const { PORTUGUESE } = require('./language')
const { abbreviatePaths } = require('./speech-text-filter')

const MAX_DETAIL_LENGTH = 120

/** Spoken content, so each case is written in the language it is heard in. */
const ACTIONS = {
  Bash: { [PORTUGUESE]: 'rodar um comando no terminal', other: 'run a terminal command' },
  Write: { [PORTUGUESE]: 'criar ou substituir um arquivo', other: 'create or replace a file' },
  Edit: { [PORTUGUESE]: 'editar um arquivo', other: 'edit a file' },
  Read: { [PORTUGUESE]: 'ler um arquivo', other: 'read a file' },
  NotebookEdit: { [PORTUGUESE]: 'editar um notebook', other: 'edit a notebook' },
  WebFetch: { [PORTUGUESE]: 'acessar um endereço na internet', other: 'fetch a web address' },
  WebSearch: { [PORTUGUESE]: 'fazer uma busca na internet', other: 'search the web' },
  Glob: { [PORTUGUESE]: 'procurar nos arquivos', other: 'search the files' },
  Grep: { [PORTUGUESE]: 'procurar nos arquivos', other: 'search the files' },
  Agent: { [PORTUGUESE]: 'iniciar um agente auxiliar', other: 'start a helper agent' },
  Task: { [PORTUGUESE]: 'iniciar um agente auxiliar', other: 'start a helper agent' },
}

function action(toolName, language) {
  const known = ACTIONS[toolName]
  if (known) return language === PORTUGUESE ? known[PORTUGUESE] : known.other
  return language === PORTUGUESE ? `usar a ferramenta ${toolName}` : `use the ${toolName} tool`
}

function firstLine(detail) {
  const line = detail.split('\n')[0].trim()
  // Very long commands tire more than they inform.
  if (line.length <= MAX_DETAIL_LENGTH) return line
  return `${line.slice(0, MAX_DETAIL_LENGTH)}…`
}

function sentence(toolName, detail, language) {
  const lead = language === PORTUGUESE ? 'O Claude quer' : 'Claude wants to'
  const what = action(toolName, language)

  if (typeof detail !== 'string' || detail.trim() === '') {
    return `${lead} ${what}.`
  }

  return `${lead} ${what}: ${abbreviatePaths(firstLine(detail))}.`
}

module.exports = { sentence, action, firstLine }
