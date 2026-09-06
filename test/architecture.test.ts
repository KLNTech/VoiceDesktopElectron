import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The dependency rule of `docs/PLAN.md` §3, as a gate rather than a paragraph: arrows point
 * inward, so `src/domain/` may not import the platform. A rule that lives only in prose is a
 * rule that is already broken somewhere nobody looked.
 */
const FORBIDDEN = /from\s+['"](electron|node:|fs|path|child_process|os)/

describe('the dependency rule', () => {
  const files = globSync('src/domain/**/*.ts')

  it('has something to check', () => {
    // The classic silent pass is a glob that matched nothing: zero files trivially satisfy
    // "no file imports the platform". Assert the scan happened before trusting its verdict.
    expect(files.length).toBeGreaterThan(0)
  })

  it('keeps domain/ free of the platform', () => {
    const offenders = files.filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
