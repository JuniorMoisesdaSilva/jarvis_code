# Jarvis icons — how to apply them

The icon is the **Spoken line** mark: a `›` followed by three voice bars.
Three colour versions (`dark`, `light`, `iron`) and three formats per version.

## What is in the folder

```
icons/
  jarvis-dark.ico            ← the app icon on Windows (7 sizes inside)
  jarvis-light.ico
  jarvis-iron.ico
  jarvis-dark.svg            ← the mark alone, no background (for the UI)
  jarvis-dark-16.svg         ← cut for 16–24px: thicker stroke, bars further apart
  jarvis-dark-plate.svg      ← square with a background, radius 14/64
  …the same for light and iron
  jarvis-mono.svg            ← currentColor, for the tray
  jarvis-mono-16.svg
  png/
    jarvis-<theme>[-plate]-<16|24|32|48|64|128|256|512>.png
```

Which one to use:

| Where | File |
| --- | --- |
| Window / installer / shortcut (Windows) | `jarvis-<theme>.ico` |
| Title bar inside the app | `jarvis-<theme>-16.svg` |
| System tray | `jarvis-mono-16.svg` (or the 16/32 PNG) |
| Linux (`.deb`, AppImage) | `png/jarvis-<theme>-plate-512.png` |
| README, website, docs | `jarvis-<theme>.svg` |

The **plate** (the square background) is used only where the operating system
insists on a square: installer, shortcut, dock. Inside the app the mark always
stands alone, with no background.

## 1. Copy it into the repository

Copy the whole folder into the project:

```
jarvis/
  assets/
    icons/        ← the folder from this package
```

## 2. The window and executable icon

In `src/main/` (where the `BrowserWindow` is created):

```js
const path = require('node:path')

const win = new BrowserWindow({
  // …
  icon: path.join(__dirname, '../../assets/icons/jarvis-dark.ico'),
})
```

When packaging, point at the same `.ico`. With **electron-builder**, in
`package.json` or `electron-builder.yml`:

```json
{
  "build": {
    "win":   { "icon": "assets/icons/jarvis-dark.ico" },
    "linux": { "icon": "assets/icons/png/jarvis-dark-plate-512.png" }
  }
}
```

With **electron-packager** / **Forge**, it is `icon: 'assets/icons/jarvis-dark'`
(no extension — each platform picks its own).

The `.ico` already carries 16, 24, 32, 48, 64, 128 and 256px inside. Windows
picks the right size on its own; do not generate a single-size `.ico`.

## 3. The icon in the title bar (inside the window)

The redesigned title bar is HTML. In `panel.html` / in the frame's renderer,
before the name:

```html
<img class="brand-mark" src="../../assets/icons/jarvis-dark-16.svg" alt="" width="16" height="16">
<span class="brand-name">Jarvis</span>
```

If you would rather the mark followed the theme without swapping files, use the
mono SVG inline (not as an `<img>`, or `currentColor` never reaches it) and let
the CSS paint it:

```html
<svg class="brand-mark" viewBox="0 0 64 64" width="16" height="16" fill="none"
     stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 23 L21 32 L13 41"/>
  <path d="M30 25 L30 39 M40 18 L40 46 M50 28 L50 36"/>
</svg>
```

```css
.brand-mark { color: var(--color-accent); }
```

The icon then switches along with Dark / Light / Iron Man, because
`--color-accent` already changes with `data-theme`.

## 4. The system tray

```js
const { Tray, nativeImage } = require('electron')

const trayIcon = nativeImage.createFromPath(
  path.join(__dirname, '../../assets/icons/png/jarvis-dark-32.png')
)
const tray = new Tray(trayIcon)
tray.setToolTip('Jarvis')
```

On Windows the tray wants a PNG (not an SVG) — use the 32px one, which the
system scales down to 16 when it needs to.

To show that it is listening, swap the tray icon rather than flashing a window:

```js
tray.setImage(isListening ? iconListening : iconIdle)
```

## 5. Which theme to use as the app icon

The executable's icon is a single one — the operating system knows nothing of
the theme inside. Pick one and keep it:

- **`jarvis-dark.ico`** is the recommended default: it works over both the light
  and the dark Windows taskbar.
- **`jarvis-iron.ico`** if you want the app to present itself with the Iron Man
  identity.
- **`jarvis-light.ico`** only makes sense if the app ships with the light theme
  as its default.

Inside the app, there the mark does follow the active theme (section 3).

## 6. Changing the colours later

Every SVG is one `<g>` with `stroke` in a single colour. For a new colour, open
the file and change the `stroke` value — there is no gradient and no fill.
The PNGs and the `.ico` are derived from the SVGs; if the colour changes,
regenerate them (any SVG→PNG converter will do, at 16/24/32/48/64/128/256/512).

## The geometry of the mark, if it has to be redrawn

A 64-unit grid, `fill: none`, rounded caps and joins.

```
Large sizes (≥ 24px) — stroke-width 5.5
  M12 22 L21 32 L12 42
  M29 24 L29 40   M39 17 L39 47   M49 27 L49 37

Small sizes (16–24px) — stroke-width 8, bars further apart
  M13 23 L21 32 L13 41
  M30 25 L30 39   M40 18 L40 46   M50 28 L50 36

Plate: rect 64×64, rx 14, filled with the theme's background.
```

Colours: dark `#9184d9` · light `#796cbf` · iron `#e3ae3c`.
Plate backgrounds: dark `#161826` · light `#f3f5fe` · iron `#14090b`.
