'use strict'

// Preferences apply across every project, not inside whichever folder happens
// to be open. Where the file goes depends on whether Jarvis was copied here as
// a portable folder or installed the ordinary way — a decision made in the core
// and resolved by data-location; this only asks it. The logic itself is in the
// core too; this just wires the two together.

const { createPreferences, DEFAULTS } = require('../core/preferences')
const dataLocation = require('./data-location')

let store = null

function current() {
  if (!store) store = createPreferences(dataLocation.where().preferencesFile)
  return store
}

module.exports = {
  read: () => current().read(),
  write: (patch) => current().write(patch),
  store: current,
  DEFAULTS,
}
