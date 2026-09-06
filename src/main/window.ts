import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell } from 'electron'

/**
 * Window bounds follow `docs/design/DESIGN-BRIEF.md` §3. They live here as one constant so that
 * a change to the design is a change to one line rather than a hunt through the process code.
 */
/**
 * The window's own background, painted by the OS before the renderer has drawn anything and
 * again behind every resize.
 *
 * These two values are the ONE place the palette is duplicated: main cannot read the renderer's
 * CSS custom properties, because it has no document. They mirror `--bg` in
 * `src/renderer/src/index.css` for the light and dark themes respectively, and must be changed
 * with it. Hard-coding only the light one — which this did until it was noticed — means a dark
 * system paints a pale window for the first frame and on every resize.
 */
const BACKGROUND = { light: '#f5f3ef', dark: '#141210' } as const

export const WINDOW_BOUNDS = {
  width: 800,
  height: 720,
  minWidth: 720,
  minHeight: 560,
} as const

/**
 * Creates the single application window.
 *
 * The three `webPreferences` switches below are the current Electron defaults. They are written
 * out anyway (`docs/PLAN.md` §8): a default nobody chose is a default anyone can change without
 * a review noticing, and the gap between the two settings is an XSS bug versus remote code
 * execution on the user's machine.
 */
export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_BOUNDS,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // Show only once the first frame is ready. Showing earlier flashes an empty white window,
  // which reads as a slow app even when the app is not slow.
  window.once('ready-to-show', () => window.show())

  // The system theme can change while the app is open, and the OS does not repaint the window
  // chrome for us. Without this the background stays on whichever theme was active at launch.
  const followTheme = (): void => {
    if (window.isDestroyed()) return
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light)
  }
  nativeTheme.on('updated', followTheme)
  window.on('closed', () => nativeTheme.off('updated', followTheme))

  // Deny by default, both directions out of the page. This app never navigates anywhere and
  // never opens a second window, so anything asking to is either a defect or an attack; a link
  // the user genuinely wants goes to their browser, not into the shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  return window
}
