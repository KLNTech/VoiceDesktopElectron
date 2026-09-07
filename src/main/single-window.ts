/**
 * One window, and a way to get it back — the whole of it.
 *
 * The defect this exists for: `mainWindow` was assigned once and never reset. Closing the window
 * with the red button destroys it, but on macOS `window-all-closed` deliberately does not quit
 * the app (`docs/PLAN.md` §8), so the variable went on pointing at a destroyed window for the
 * rest of the process's life. `second-instance` guarded on `mainWindow === null` — false from
 * the first window onward — so launching the app again from Finder or Spotlight called `.focus()`
 * on a corpse and created nothing. The app was running, had no window, and had no way to show
 * one. `activate` two lines below did the right thing, but `activate` is a different event and
 * inherits none of that logic.
 *
 * Both events now ask the same question, in one place: is there a live window? Show it. Is there
 * not? Make one.
 */

/** Exactly what this file calls on a window — so the test can hand it a fake and nothing more. */
export interface WindowHandle {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
  on(event: 'closed', listener: () => void): void
}

/**
 * Wraps "open a window" into "show THE window", creating one only when there is none alive.
 *
 * `open` is expected to both create the window and start loading into it: this file owns *when*
 * a window exists, not what is in it.
 */
export function makeSingleWindow<T extends WindowHandle>(open: () => T): () => T {
  let current: T | null = null

  return function show(): T {
    // `isDestroyed()` and not just a null check. The `closed` listener below is the ordinary
    // path back to null, but a window can be destroyed without this process being the one that
    // asked — and a destroyed window answers `isMinimized()` and `focus()` by throwing.
    if (current !== null && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore()
      current.focus()
      return current
    }

    const window = open()
    current = window
    // The only thing that resets the reference. Without it the next call finds a destroyed
    // window and has to rely on `isDestroyed()` alone — true, but one guard deep instead of two.
    window.on('closed', () => {
      if (current === window) current = null
    })
    return window
  }
}
