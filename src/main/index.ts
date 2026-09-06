import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'

import { createWindow } from './window'

/**
 * Content-Security-Policy for the one page this app loads.
 *
 * `unsafe-eval` is absent in both modes — in a desktop shell that is the switch that matters,
 * because the renderer sits one bug away from the machine. Development additionally allows the
 * inline script and the websocket that Vite's dev server and React Fast Refresh need; those are
 * listed rather than waved through, so the difference between the two modes is readable.
 */
function contentSecurityPolicy(isDev: boolean): string {
  const common = [
    "default-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ]
  return isDev
    ? [
        ...common,
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' ws://localhost:* http://localhost:*",
      ].join('; ')
    : [...common, "script-src 'self'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'"].join('; ')
}

/**
 * Two copies of this app would write the same `notes/` folder. That is a corruption bug which
 * reproduces only on the user's machine, so the second instance is refused at launch rather
 * than left to race (`docs/PLAN.md` §8).
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const isDev = !app.isPackaged
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [contentSecurityPolicy(isDev)],
        },
      })
    })

    mainWindow = createWindow()
    loadRenderer(mainWindow)

    // macOS keeps the app alive with no windows; clicking the dock icon must bring one back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        loadRenderer(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

function loadRenderer(window: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl !== undefined && devServerUrl !== '') {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
