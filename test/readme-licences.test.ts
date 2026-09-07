import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * The README's licence tables, checked against the lockfile.
 *
 * S11's acceptance criterion is *"a README that tells the truth"*, and a version number typed
 * into a Markdown table is the least truthful thing in any repository: it is correct on the day
 * it is written and silently wrong from the next upgrade onward. Nothing about a stale row
 * looks broken, which is exactly why it needs a machine.
 *
 * This is `code-documentation`'s third rule applied to this project's own README — a sentence
 * stating a verifiable fact about this repository is either guarded by a check or reworded.
 * The rows below state facts, so here is the check.
 */
const Lock = z.object({
  packages: z.record(z.string(), z.object({ version: z.string().optional() }).loose()),
})

const lock = Lock.parse(JSON.parse(readFileSync('package-lock.json', 'utf8')))
const readme = readFileSync('README.md', 'utf8')

/** The README's row label → the package whose version it claims to be reporting. */
const CLAIMS: readonly (readonly [string, string])[] = [
  ['Electron', 'electron'],
  ['React', 'react'],
  ['React DOM', 'react-dom'],
  ['Zod', 'zod'],
  ['TypeScript', 'typescript'],
  ['Vite', 'vite'],
  ['electron-vite', 'electron-vite'],
  ['@vitejs/plugin-react', '@vitejs/plugin-react'],
  ['Vitest', 'vitest'],
  ['jsdom', 'jsdom'],
  ['oxlint', 'oxlint'],
  ['Barlow · Barlow Condensed', '@fontsource/barlow'],
]

function installedVersion(name: string): string {
  const version = lock.packages[`node_modules/${name}`]?.version
  if (version === undefined) throw new Error(`${name} is not in package-lock.json`)
  return version
}

describe('the README tells the truth about its dependencies', () => {
  it('has tables to check', () => {
    // The silent pass: a README that lost its tables would satisfy every assertion below.
    expect(readme).toContain('## Third-party software and licences')
    expect(CLAIMS.length).toBeGreaterThan(0)
  })

  it.each(CLAIMS)('reports the installed version of %s', (label, pkg) => {
    const version = installedVersion(pkg)
    // Matched as a whole table row, so a version that appears somewhere else in the file by
    // coincidence cannot make this pass.
    const row = new RegExp(`\\|[^|\\n]*${escape(label)}[^|\\n]*\\|\\s*${escape(version)}\\s*\\|`)
    expect(readme).toMatch(row)
  })

  /**
   * The one number the README quotes about itself.
   *
   * It said *"192 automated checks across 27 files"*, and by the time anyone read it the suite
   * was 180 across 22 — the count had been correct on the day it was typed and wrong from the
   * next commit onward, which is the exact failure the licence rows above already have a machine
   * for. The assertion count is deliberately NOT quoted in the README: it moves on almost every
   * commit, and a number nothing can hold still does not belong in a document.
   */
  it('quotes a test-file count that matches the files on disk', () => {
    const files = globSync('test/**/*.test.ts').length
    expect(files).toBeGreaterThan(0)
    expect(readme).toMatch(new RegExp(`\\*\\*${files} test files\\*\\*`))
  })

  /**
   * The two numbers the *What this application is* section quotes about the code.
   *
   * Both are the kind that go stale without looking stale. The bridge-method count moved twice in
   * one branch — `micAccess` added, `onTurnState` removed with the dead `turn:state` channel —
   * and the window size is the one figure the design brief and the code have to agree on.
   */
  it('quotes the bridge surface size that `shared/ipc.ts` actually declares', () => {
    const wire = readFileSync('shared/ipc.ts', 'utf8')
    const surface = wire.slice(wire.indexOf('export interface VoiceDeskBridge'))
    const methods = [...surface.matchAll(/^ {2}(\w+)\(/gm)].length
    expect(methods).toBeGreaterThan(0)
    expect(readme).toContain(`exactly ${spellOut(methods)} named bridge methods`)
  })

  it('quotes the window size the code opens', () => {
    const window = readFileSync('src/main/window.ts', 'utf8')
    const width = /width:\s*(\d+)/.exec(window)?.[1]
    const height = /height:\s*(\d+)/.exec(window)?.[1]
    expect([width, height]).not.toContain(undefined)
    expect(readme).toContain(`${width} × ${height}`)
  })

  /**
   * The one licence claim in the README that is about an ABSENCE.
   *
   * `ffmpeg` is GPL-3.0-or-later, which reaches further into a shipped product than anything else
   * this app touches, and the README says it is not used *on purpose*. An absence is the easiest
   * claim in any document to stop being true — nobody reviewing a diff that adds a dependency is
   * thinking about a sentence three sections away — so it is asserted here rather than trusted.
   *
   * What this CAN check is the lockfile, which is the whole of this repository's dependency
   * surface. What it cannot check is the `whisper-cli` the user installs themselves, which is why
   * F10 — vendoring that binary — carries the constraint in its own row instead of relying on
   * this test to grow arms it does not have.
   */
  it('pulls in no ffmpeg, which is the one licence the README rules out by name', () => {
    const names = Object.keys(lock.packages).join('\n')
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toMatch(/ffmpeg/i)
    expect(readme).toContain('`ffmpeg` is GPL-3.0-or-later')
  })

  it('names the agent CLI version the flag set was verified against', () => {
    // Another program's version, so it cannot come from the lockfile — but it is load-bearing:
    // `docs/PLAN.md` §5.2 says the flags were checked against a specific release, and those are
    // someone else's flags and can move.
    expect(readme).toMatch(/Claude Code CLI \| 2\.1\.\d+/)
  })
})

/** The README writes small counts as words, the way prose does. */
function spellOut(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)
}

/** Escapes a literal for use inside a RegExp — the labels contain `·`, `.` and `@`. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
