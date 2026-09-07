/*
 * Reports what the window ACTUALLY computes, in one theme, and exits.
 *
 * The defect this exists for: `design/tokens.css` had a comment containing a directory glob —
 * a star followed by a slash. No C-style comment nests, so those two characters ended the
 * comment where they appeared; the rest of the sentence became stray tokens and the CSS parser
 * discarded the whole `:root` rule that followed. Every token in the file vanished at runtime
 * while the file still contained every declaration, the build said nothing, and 220 tests
 * stayed green.
 *
 * Writing the glob out literally has now broken three files in three languages while this gate
 * was being built — here, in the test that drives it, and in the stylesheet itself. JavaScript
 * and TypeScript both refuse to parse and say exactly where. CSS is the only one of the three
 * that keeps going and quietly drops a rule. That asymmetry is the entire reason this file
 * launches a browser instead of reading the stylesheet as text.
 *
 * Nothing short of a real render can see that. The stylesheet is correct as TEXT — grep finds
 * every token — and only a CSS parser reports that the rule was dropped.
 */
const { app, BrowserWindow, ipcMain, nativeTheme, session } = require('electron')
const { join } = require('node:path')

const repo = process.argv[2]
const theme = process.argv[3]

/** Production CSP, so a token that needs a blocked resource fails here rather than in the app. */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join('; ')

function installCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })
}

void app.whenReady().then(async () => {
  installCsp()
  // The probe loads the REAL renderer, which asks for these as it mounts. Answering keeps the
  // output clean: an unhandled channel logs an error, and an unexpected error in the log is
  // where a real one would hide.
  ipcMain.handle('app:info', async () => ({
    version: '0.0.0', stage: 'dev', notesDir: '/tmp/notes', agentModel: 'haiku', notices: [],
  }))
  ipcMain.handle('notes:list', async () => ({ files: [] }))
  // Forced rather than inherited: the machine running the suite has one appearance setting, and
  // the theme that is not currently selected is exactly the one nobody looks at.
  nativeTheme.themeSource = theme

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(repo, 'out/preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  await win.loadFile(join(repo, 'out/renderer/index.html'))

  const seen = await win.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    const sheet = document.styleSheets[0]
    return {
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      // The rule whose loss started all this. Asserted by NAME, because its absence is what
      // made every token below it resolve to the empty string.
      rootRuleParsed: [...sheet.cssRules].some((rule) => rule.selectorText === ':root'),
      bg: body.backgroundColor,
      text: body.color,
      font: body.fontFamily,
      accent: root.getPropertyValue('--color-accent').trim(),
      stateListening: root.getPropertyValue('--state-listening').trim(),
    }
  })()`)

  console.log('THEME ' + JSON.stringify(seen))
  app.quit()
  return undefined
})
