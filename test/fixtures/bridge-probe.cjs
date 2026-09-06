/*
 * Launches the real app shell — built preload, sandbox on, contextIsolation on — and reports
 * what the page can actually reach. Run by `test/preload-bridge.test.ts`.
 *
 * This has to be a real Electron launch. A sandboxed preload has no module resolver, and that
 * is invisible to every Node-based test: a preload can typecheck, bundle, and still fail at
 * load with "module not found", leaving `window.voicedesk` undefined.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const repo = process.argv[2]
const errors = []

app.whenReady().then(async () => {
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

  const seen = await win.webContents.executeJavaScript(`({
    bridgeType: typeof window.voicedesk,
    methods: window.voicedesk ? Object.keys(window.voicedesk).sort() : [],
    ipcRendererLeaked: typeof window.require !== 'undefined'
      || typeof window.ipcRenderer !== 'undefined'
      || typeof window.electron !== 'undefined',
    nodeLeaked: typeof window.process !== 'undefined' || typeof window.module !== 'undefined',
  })`)

  console.log('PROBE ' + JSON.stringify({ ...seen, preloadErrors: errors }))
  app.quit()
})
