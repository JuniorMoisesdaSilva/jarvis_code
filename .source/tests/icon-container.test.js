import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FOLDER, THEME, APP, TRAY } from '../src/core/icon-files.js'

// The icons ship as files now rather than being drawn in code, which moves the
// risk: nobody reads an .ico by eye, and a malformed one does not fail — Windows
// shows a blank square and says nothing about why. These checks are the reading
// by eye, done by a machine, over the files that actually ship.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICONS = path.join(ROOT, FOLDER)

/** Every size Windows asks for, from the notification area up to the shortcut. */
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const THEMES = ['dark', 'light', 'iron']

function readIco(theme) {
  const data = fs.readFileSync(path.join(ICONS, `jarvis-${theme}.ico`))
  const count = data.readUInt16LE(4)
  const images = []
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16
    images.push({
      // The width and height fields are one byte each, so 256 is written as 0.
      width: data[at] === 0 ? 256 : data[at],
      height: data[at + 1] === 0 ? 256 : data[at + 1],
      size: data.readUInt32LE(at + 8),
      offset: data.readUInt32LE(at + 12),
    })
  }
  return { data, count, images }
}

describe.each(THEMES)('the %s icon', (theme) => {
  it('declares itself an icon rather than a cursor', () => {
    const { data } = readIco(theme)
    expect(data.readUInt16LE(0)).toBe(0)
    expect(data.readUInt16LE(2)).toBe(1)
  })

  it('carries every size Windows asks for', () => {
    const { images } = readIco(theme)
    expect(images.map((each) => each.width)).toEqual(SIZES)
    expect(images.map((each) => each.height)).toEqual(SIZES)
  })

  it('holds a real PNG at each offset, of the width it claims', () => {
    const { data, images } = readIco(theme)
    for (const image of images) {
      const png = data.subarray(image.offset, image.offset + image.size)
      expect(png.subarray(0, 4), `${image.width}px`).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      expect(png.readUInt32BE(16), `${image.width}px width`).toBe(image.width)
      expect(png.readUInt32BE(20), `${image.width}px height`).toBe(image.width)
    }
  })

  it('writes 256 as zero, because the field is one byte wide', () => {
    const { data, images } = readIco(theme)
    const last = images.length - 1
    expect(images[last].width).toBe(256)
    expect(data[6 + last * 16]).toBe(0)
  })

  it('stops exactly at the end of the last image', () => {
    const { data, images } = readIco(theme)
    const end = Math.max(...images.map((each) => each.offset + each.size))
    expect(end).toBe(data.length)
  })
})

// Not the filenames spelled out again — the ones src/main/icon.js and
// scripts/package.js actually open. Spelling them out here would let a typo in
// either of those ship green, and the failure it causes is silent: a blank
// square in the taskbar, or nothing at all in the notification area.
describe('the files the app names', () => {
  it('names one of the themes that were delivered', () => {
    expect(THEMES).toContain(THEME)
  })

  it('has the .ico the window and the installer are pointed at', () => {
    expect(fs.existsSync(path.join(ICONS, APP))).toBe(true)
  })

  it('has the PNG the tray is pointed at, at the size it claims', () => {
    const tray = path.join(ICONS, TRAY)
    expect(fs.existsSync(tray)).toBe(true)
    const data = fs.readFileSync(tray)
    expect(data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(data.readUInt32BE(16), 'width').toBe(32)
    expect(data.readUInt32BE(20), 'height').toBe(32)
  })
})
