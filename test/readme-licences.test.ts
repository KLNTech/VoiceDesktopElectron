import { readFileSync } from 'node:fs'
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

  it('names the agent CLI version the flag set was verified against', () => {
    // Another program's version, so it cannot come from the lockfile — but it is load-bearing:
    // `docs/PLAN.md` §5.2 says the flags were checked against a specific release, and those are
    // someone else's flags and can move.
    expect(readme).toMatch(/Claude Code CLI \| 2\.1\.\d+/)
  })
})

/** Escapes a literal for use inside a RegExp — the labels contain `·`, `.` and `@`. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
