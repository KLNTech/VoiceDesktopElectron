import { describe, expect, it } from 'vitest'

import { makeSingleWindow, type WindowHandle } from '../src/main/single-window'

/**
 * The window can always be brought back — asserted, rather than left to a reading of the diff.
 *
 * What this gate is for, in the order the user meets it: open the app, close the window with the
 * red button, then launch the app again from Finder. Before this, `second-instance` guarded on
 * `mainWindow === null`, which stopped being true the moment the first window existed and never
 * became true again — so the handler focused a destroyed window and created nothing. The app was
 * running, had no window, and offered no way to get one. Quitting it needs the dock menu, which
 * is not where anybody looks for a window that will not appear.
 */
class FakeWindow implements WindowHandle {
  destroyed = false
  minimized = false
  focused = 0
  restored = 0
  private closedListener: (() => void) | null = null

  isDestroyed(): boolean {
    return this.destroyed
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.minimized = false
    this.restored += 1
  }
  focus(): void {
    this.focused += 1
  }
  on(_event: 'closed', listener: () => void): void {
    this.closedListener = listener
  }

  /** What the red button does: destroy the window, then tell whoever was listening. */
  close(): void {
    this.destroyed = true
    this.closedListener?.()
  }
}

function presenter(): { show: () => FakeWindow; opened: FakeWindow[] } {
  const opened: FakeWindow[] = []
  const show = makeSingleWindow(() => {
    const window = new FakeWindow()
    opened.push(window)
    return window
  })
  return { show, opened }
}

describe('showing the one window', () => {
  it('opens a window the first time', () => {
    const { show, opened } = presenter()
    show()
    expect(opened).toHaveLength(1)
  })

  it('focuses the existing window rather than opening a second', () => {
    const { show, opened } = presenter()
    const first = show()
    const again = show()

    expect(opened).toHaveLength(1)
    expect(again).toBe(first)
    expect(first.focused).toBe(1)
  })

  it('un-minimises before focusing, because focus alone leaves it in the dock', () => {
    const { show } = presenter()
    const window = show()
    window.minimized = true

    show()

    expect(window.restored).toBe(1)
    expect(window.minimized).toBe(false)
  })

  /**
   * The regression itself. Everything above passed before the fix too.
   */
  it('opens a NEW window after the user closed the last one', () => {
    const { show, opened } = presenter()
    const first = show()
    first.close()

    const second = show()

    expect(opened).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(second.isDestroyed()).toBe(false)
    // And nothing was said to the corpse: a destroyed BrowserWindow throws on both of these.
    expect(first.focused).toBe(0)
    expect(first.restored).toBe(0)
  })

  /**
   * The same recovery when nobody told us the window closed.
   *
   * A window can be destroyed without this process being the one that asked, and the `closed`
   * listener is not the only thing standing between us and a destroyed handle — which is why the
   * check is `isDestroyed()` and not merely a null reference.
   */
  it('recovers from a window destroyed without a `closed` event', () => {
    const { show, opened } = presenter()
    const first = show()
    first.destroyed = true

    const second = show()

    expect(opened).toHaveLength(2)
    expect(second).not.toBe(first)
  })

  it('keeps working across several close-and-reopen rounds', () => {
    const { show, opened } = presenter()
    for (let round = 0; round < 3; round += 1) show().close()
    expect(opened).toHaveLength(3)
  })

  /**
   * A stale `closed` event may not blank a window that has since replaced it.
   *
   * Electron delivers `closed` asynchronously, so the old window's event can land after the
   * replacement is already on screen. A listener that unconditionally set the reference to null
   * would drop the live window on the floor, and the next launch would open a third.
   */
  it('ignores a late `closed` from a window that was already replaced', () => {
    const { show, opened } = presenter()
    const first = show()
    first.destroyed = true
    const second = show()

    first.close() // arrives late, refers to the window nobody is showing any more

    expect(show()).toBe(second)
    expect(opened).toHaveLength(2)
  })
})
