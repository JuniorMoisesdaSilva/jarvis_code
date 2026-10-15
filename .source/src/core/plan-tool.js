'use strict'

// The names of Jarvis's plan tool, in one place.
//
// Connect registers the MCP server under one name, the approval hook is matched
// to the tool's full name, and the hook payload recognises the call by it. Three
// writers of the same three words drift the moment one is renamed, so all three
// read them from here. Brain/PLAN.js keeps its own copy — it is a carried file
// that must stand alone on a machine — and a test pins it to these.

/** The name Connect registers the server under in Claude Code's MCP list. */
const SERVER = 'jarvis'

/** The one tool the server offers. */
const TOOL = 'update_plan'

/** The tool as Claude Code names it: `mcp__<server>__<tool>`. */
const FULL_NAME = `mcp__${SERVER}__${TOOL}`

module.exports = { SERVER, TOOL, FULL_NAME }
