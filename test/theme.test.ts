import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * The window is readable, in both themes — asserted against a real render.
 *
 * This gate exists because of a defect that had every other signal green. `design/tokens.css`
 * carried a comment naming its source with a directory glob — a star followed by a slash. CSS
 * has no nested comments, so those two characters ended the comment where they appeared; the
 * rest of the sentence became stray tokens and the parser threw away the entire `:root` rule
 * that followed it.
 *
 * Writing that glob into THIS file's comment reproduced it immediately, which is worth keeping
 * as a note: in TypeScript esbuild refuses to compile, loudly, at the character. In CSS the
 * same two characters cost a whole rule and no tool says anything at all.
 *
 * What that produced: every custom property resolved to the empty string, so
 * `background: var(--color-bg)` was invalid and the body was transparent, `color:
 * var(--color-text)` fell back to black, and `font-family: var(--font-body)` fell back to the
 * browser default — Times. The window painted **black text on the black the OS paints behind
 * it**, in a serif nobody chose. Meanwhile the file still contained every declaration, `grep`
 * found every token, the typecheck passed, the linter passed, `npm run build` printed no
 * warning, and 220 tests were green.
 *
 * No static check would have caught it, because the stylesheet is correct AS TEXT. Only a CSS
 * parser knows the rule was dropped, which makes this the exact shape
 * `electron-renderer-evidence` describes: a claim about the renderer is only proved by evidence
 * produced in the renderer.
 */
const require_ = createRequire(import.meta.url)
const electronBinary = z.string().min(1).parse(require_('electron'))
const repoRoot = process.cwd()

const Theme = z.object({
  prefersDark: z.boolean(),
  rootRuleParsed: z.boolean(),
  bg: z.string(),
  text: z.string(),
  font: z.string(),
  accent: z.string(),
  stateListening: z.string(),
})
type Theme = z.infer<typeof Theme>

function render(theme: 'dark' | 'light'): Theme {
  const stdout = execFileSync(
    electronBinary,
    [join(repoRoot, 'test/fixtures/theme-probe.cjs'), repoRoot, theme],
    { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } },
  )
  const line = stdout.split('\n').find((l) => l.startsWith('THEME '))
  if (line === undefined) throw new Error(`the probe reported nothing:\n${stdout}`)
  return Theme.parse(JSON.parse(line.slice('THEME '.length)))
}

/** `rgb(r, g, b)` → relative luminance, so "is this readable" is a number and not an opinion. */
function luminance(colour: string): number {
  const parts = colour.match(/\d+(\.\d+)?/g)
  if (parts === null || parts.length < 3) throw new Error(`not a colour this can read: ${colour}`)
  const [r, g, b] = parts.slice(0, 3).map((value) => {
    const channel = Number(value) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** WCAG contrast ratio between two computed colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

describe.each(['dark', 'light'] as const)('the window in %s', (theme) => {
  const seen = render(theme)

  it('parsed the base :root rule, which is where every token is defined', () => {
    // The specific failure. Without this rule the two assertions below still "pass" in the sense
    // that they read SOMETHING — they read the browser's defaults — so this is asserted directly.
    expect(seen.rootRuleParsed).toBe(true)
  })

  it('resolved the tokens rather than falling back to browser defaults', () => {
    // An empty custom property is the signature of the dropped rule: `var()` with nothing to
    // resolve to makes the whole declaration invalid, silently.
    expect(seen.accent).not.toBe('')
    expect(seen.stateListening).not.toBe('')
    // Times is what `font-family: var(--font-body)` degrades to when the token is missing.
    expect(seen.font).toContain('Barlow')
  })

  it('paints text the user can read against the background', () => {
    // The whole point, as a number. 4.5:1 is WCAG AA for body text; this is body copy.
    expect(contrast(seen.bg, seen.text)).toBeGreaterThan(4.5)
  })

  it('follows the system appearance rather than a fixed palette', () => {
    expect(seen.prefersDark).toBe(theme === 'dark')
    // The direction, so a palette applied the wrong way round is caught rather than merely a
    // low-contrast one: dark mode has the darker ground.
    const groundIsDark = luminance(seen.bg) < luminance(seen.text)
    expect(groundIsDark).toBe(theme === 'dark')
  })
})

describe('the native window background', () => {
  it('matches the ground the page paints, so the first frame is not a flash', () => {
    // Main has no document and cannot read the renderer's custom properties, so these two
    // values are the one place the palette is duplicated. Checked here rather than trusted.
    const dark = render('dark')
    const light = render('light')

    expect(dark.bg).toBe('rgb(43, 43, 45)') // #2b2b2d — BACKGROUND.dark in src/main/window.ts
    expect(light.bg).toBe('rgb(242, 242, 243)') // #f2f2f3 — BACKGROUND.light
  })
})
