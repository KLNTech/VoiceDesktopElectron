import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three switches of `docs/PLAN.md` §8, guarded rather than merely written down.
 *
 * The plan says the gap between these two settings is *"the difference between an XSS bug and
 * remote code execution"*. All three are correct today, and the only thing standing between
 * them and a silent flip was a human reading a diff — which is not a gate, because the change
 * that flips one is never a change about security. Somebody turns `sandbox` off to make a
 * dependency work, everything goes green, and the app ships with the boundary gone.
 *
 * Ten lines of `vi.mock('electron')` and one assertion on `webPreferences` closes it, with no
 * Electron launched and no Playwright.
 */
const constructed: { options: unknown }[] = []

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      constructed.push({ options })
    }
    once(): void {}
    on(): void {}
    setBackgroundColor(): void {}
    isDestroyed(): boolean {
      return false
    }
    webContents = {
      setWindowOpenHandler: (): void => {},
      on: (): void => {},
      getURL: (): string => 'file:///index.html',
      session: { setPermissionRequestHandler: (): void => {} },
    }
  },
  nativeTheme: { shouldUseDarkColors: false, on: (): void => {}, off: (): void => {} },
  shell: { openExternal: (): Promise<void> => Promise.resolve() },
}))

const { createWindow, WINDOW_BOUNDS } = await import('../src/main/window')

/**
 * One switch, read off the options the window was actually constructed with.
 *
 * Reads a single key rather than handing back the whole object, so nothing here has to claim a
 * type for another library's argument — the value is `unknown` and the assertion compares it,
 * which is all a switch needs.
 */
function preference(key: string): unknown {
  const options = constructed[0]?.options
  if (typeof options !== 'object' || options === null || !('webPreferences' in options)) {
    throw new Error('the window was created without webPreferences at all')
  }
  const prefs: unknown = Reflect.get(options, 'webPreferences')
  if (typeof prefs !== 'object' || prefs === null) throw new Error('webPreferences is not an object')
  return Reflect.get(prefs, key)
}

describe('the window the app opens', () => {
  beforeEach(() => {
    constructed.length = 0
    createWindow()
  })

  it('was created at all, so the assertions below are about something', () => {
    // The silent pass this guards: a mock that never runs the constructor makes every
    // assertion below vacuously true.
    expect(constructed).toHaveLength(1)
  })

  it('isolates the context, sandboxes the renderer, and keeps Node out of the page', () => {
    // Each of these is the current Electron default. They are asserted anyway, for the same
    // reason they are written out in the source: a default nobody chose is a default anyone
    // can change.
    expect(preference('contextIsolation')).toBe(true)
    expect(preference('sandbox')).toBe(true)
    expect(preference('nodeIntegration')).toBe(false)
  })

  it('loads a preload script, since the bridge is the only way in', () => {
    expect(String(preference('preload'))).toMatch(/preload/)
  })

  it('never enables the two switches that would undo the rest', () => {
    // Neither is set today. They are named so that setting one is a failing test rather than a
    // line in a diff: `webSecurity: false` disables the CSP the app relies on, and
    // `allowRunningInsecureContent` reintroduces exactly what it says.
    expect(preference('webSecurity')).not.toBe(false)
    expect(preference('allowRunningInsecureContent')).not.toBe(true)
  })

  it('opens at the size the design specifies', () => {
    // 800 × 720 is the canvas's window, and the two panes are laid out against it.
    expect(WINDOW_BOUNDS.width).toBe(800)
    expect(WINDOW_BOUNDS.height).toBe(720)
  })
})
