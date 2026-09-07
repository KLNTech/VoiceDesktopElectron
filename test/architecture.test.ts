import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The dependency rule of `docs/PLAN.md` §3, as a gate rather than a paragraph: arrows point
 * inward, so `src/domain/` may not import the platform. A rule that lives only in prose is a
 * rule that is already broken somewhere nobody looked.
 *
 * ## Why this is a list of patterns and not one regex
 *
 * It used to be `/from\s+['"](electron|node:|fs|path|child_process|os)/`, which catches an
 * ordinary `import x from "electron"` and nothing else. This project shows the gate as its
 * flagship example of *a rule that is true rather than merely written*, and the deliberate
 * violation it was proven on was the easiest possible one. Everything below walked straight
 * through it:
 *
 *   - `import "electron"` — a side-effect import has no `from`;
 *   - `await import("node:child_process")` — dynamic, and the most likely way a real violation
 *     would arrive, since it is what someone reaches for to avoid a top-level import;
 *   - `require("fs")`;
 *   - every Node builtin outside that four — `crypto`, `stream`, `net`, `worker_threads`,
 *     `http` — when written without the `node:` prefix;
 *   - `process.env` and `process.platform`, which need no import at all and are the most common
 *     way pure code quietly starts depending on where it is running.
 *
 * The last one is worth its own note: `process` is a global, so no import scan of any strictness
 * would ever have found it.
 */
const PLATFORM_MODULE = String.raw`electron|node:[\w/]+|${[
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
].join('|')}`

/** Each rule names what it forbids, so a failure says which shape was used, not just "no". */
const FORBIDDEN: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  {
    what: 'a static import of the platform',
    pattern: new RegExp(String.raw`from\s*['"](${PLATFORM_MODULE})['"]`),
  },
  {
    what: 'a side-effect import of the platform (no `from` to match)',
    pattern: new RegExp(String.raw`^\s*import\s*['"](${PLATFORM_MODULE})['"]`, 'm'),
  },
  {
    what: 'a dynamic import of the platform',
    pattern: new RegExp(String.raw`import\s*\(\s*['"](${PLATFORM_MODULE})['"]`),
  },
  {
    what: 'a require of the platform',
    pattern: new RegExp(String.raw`require\s*\(\s*['"](${PLATFORM_MODULE})['"]`),
  },
  {
    what: 'the `process` global, which needs no import and so no import scan would find it',
    pattern: /\bprocess\s*\.\s*(env|platform|argv|cwd|versions|exit|stdout|stderr)\b/,
  },
]

describe('the dependency rule', () => {
  const files = globSync('src/domain/**/*.ts')

  it('has something to check', () => {
    // The classic silent pass is a glob that matched nothing: zero files trivially satisfy
    // "no file imports the platform". Assert the scan happened before trusting its verdict.
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(FORBIDDEN)('keeps domain/ free of $what', ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  /**
   * Each pattern is checked against a sample that SHOULD trip it.
   *
   * Without this the suite cannot tell "the rule holds" from "the rule is a regex that matches
   * nothing" — and a typo in one of the alternations above produces exactly the second while
   * looking exactly like the first. A gate nobody has seen redden is not evidence.
   */
  it.each([
    ['a static import', `import { app } from 'electron'`],
    ['an unprefixed builtin', `import { createHash } from 'crypto'`],
    ['a side-effect import', `import 'node:fs'`],
    ['a dynamic import', `const x = await import("node:child_process")`],
    ['a require', `const fs = require('fs')`],
    ['the process global', `const dir = process.env.HOME`],
  ])('would redden on %s', (_label, sample) => {
    expect(FORBIDDEN.some((rule) => rule.pattern.test(sample))).toBe(true)
  })

  /**
   * The other direction, which nothing checked at all.
   *
   * `docs/PLAN.md` §3 says the renderer may reach shared types, the bridge, and the domain's
   * pure model — and nothing below it. Running the turn machine in the renderer is deliberate:
   * it is the only way to get the zero-latency key handling §2 requires. Reaching an ADAPTER
   * from there is a different thing entirely, and would mean Node code in a sandboxed page.
   */
  it('keeps the renderer away from adapters and ports', () => {
    const rendererFiles = globSync('src/renderer/**/*.{ts,tsx}')
    expect(rendererFiles.length).toBeGreaterThan(0)

    const reachesInward = /from\s*['"][^'"]*(infrastructure|domain\/ports|domain\/usecases)/
    const offenders = rendererFiles.filter((file) => reachesInward.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
