/*
 * Launches the real app shell and reports what the page can actually reach.
 *
 * This has to be a real Electron launch, and it is this project's whole answer to S10. Three
 * things here exist only in a launched app and are invisible to every Node-based test:
 *
 *  1. A sandboxed preload has no module resolver, so a preload can typecheck, bundle, and still
 *     fail at load with "module not found" — leaving `window.voicedesk` undefined and every
 *     call throwing on `undefined`, which presents as a hang rather than an error.
 *  2. The Content-Security-Policy is a HEADER, so it exists only when something serves it, and
 *     the page below is loaded under the production one. A policy that broke the app's own code
 *     would show up here as a preload error or a failed round trip, neither of which a Node test
 *     can produce.
 *  3. A round trip over the real seam — renderer → preload → `ipcMain.handle` → back — which is
 *     the wiring no unit test touches.
 */
const { app, BrowserWindow, ipcMain, session } = require('electron')
const { join } = require('node:path')

const repo = process.argv[2]
const errors = []

/** The production policy, copied in shape from `src/main/index.ts`'s packaged branch. */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join('; ')

/**
 * Serves the production policy on every response.
 *
 * A named function rather than an inline callback inside the `whenReady` chain: Electron's
 * `onHeadersReceived` is a callback API that must invoke its `callback` to release the
 * response, and mixing that into a promise chain is exactly what `promise/no-callback-in-promise`
 * is for. Lifting it out satisfies the rule by not doing the thing, rather than by silencing it.
 */
function installCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })
}

void app.whenReady().then(async () => {
  installCsp()

  // One handler, answering on a real channel, so the round trip below crosses the real seam
  // rather than a stub inside the page.
  ipcMain.handle('app:info', async () => ({ probe: 'round-trip', pid: process.pid }))
  // The probe loads the REAL renderer, which asks for the notes folder as it mounts. Answering
  // keeps the launch clean: an unhandled channel logs an error, and an error nobody expects in
  // the output is where a real one would hide.
  ipcMain.handle('notes:list', async () => ({ files: [] }))

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(repo, 'out/preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.webContents.on('preload-error', (_event, path, error) => {
    errors.push(`${path}: ${error.message}`)
  })

  await win.loadFile(join(repo, 'out/renderer/index.html'))

  const seen = await win.webContents.executeJavaScript(`(async () => {
    const bridge = window.voicedesk
    let roundTrip = null
    let roundTripError = null
    try {
      // Through the bridge, not through ipcRenderer: this is the contract the renderer has.
      const info = await bridge.appInfo()
      roundTrip = info && info.probe === 'round-trip' && info.pid === ${process.pid}
    } catch (error) {
      roundTripError = String(error && error.message ? error.message : error)
    }

    return {
      bridgeType: typeof bridge,
      methods: bridge ? Object.keys(bridge).sort() : [],
      ipcRendererLeaked: typeof window.require !== 'undefined'
        || typeof window.ipcRenderer !== 'undefined'
        || typeof window.electron !== 'undefined',
      nodeLeaked: typeof window.process !== 'undefined' || typeof window.module !== 'undefined',
      roundTrip,
      roundTripError,
    }
  })()`)

  console.log('PROBE ' + JSON.stringify({ ...seen, preloadErrors: errors }))
  app.quit()
  return undefined
})
