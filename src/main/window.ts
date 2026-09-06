import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

/**
 * Window bounds follow `docs/design/DESIGN-BRIEF.md` §3. They live here as one constant so that
 * a change to the design is a change to one line rather than a hunt through the process code.
 */
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
    backgroundColor: '#f5f3ef',
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
