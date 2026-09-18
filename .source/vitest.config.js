import { defineConfig } from 'vitest/config'

// One setting, for one problem: this folder travels through a Mac.
//
// macOS writes a companion file beside anything carrying metadata — same name,
// `._` in front, a few kilobytes of binary. They are invisible on the Mac and
// perfectly visible on Windows, and `tests/._preferences.test.js` matches the
// default test glob exactly as well as the real file does. Vitest opened each
// one, failed to parse `Mac OS X …ATTR…` as JavaScript, and reported half the
// suite as failing suites while every actual test passed. Twenty-four of them,
// on 8 September 2026.

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
  },
})
