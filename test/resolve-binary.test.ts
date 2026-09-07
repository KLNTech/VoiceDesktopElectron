import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { resolveBinary } from '../src/infrastructure/process/resolveBinary'

/**
 * `resolveBinary` was used by the suite only as a HELPER — to find real programs so other tests
 * could run — and none of its own branches was asserted. That is the shape of untested code
 * that looks tested: it appears in the imports of a green file and nothing checks what it does.
 *
 * The branch that matters most is the one a refactor is most likely to "fix": a bad override
 * returns `null` and deliberately does NOT fall back to `PATH`. Falling back would turn *"you
 * configured this wrong, here is the fix"* into *"it is silently running a different binary than
 * the one you named"*, which is the harder bug by a wide margin.
 */
const work = mkdtempSync(join(tmpdir(), 'voicedesk-bin-'))
const originalPath = process.env['PATH']

afterEach(() => {
  process.env['PATH'] = originalPath
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

/** An executable file with the given name, in its own directory. */
function executable(name: string, dir = mkdtempSync(join(work, 'd-'))): string {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

describe('finding a program without trusting PATH', () => {
  it('takes an explicit override, ahead of everything else', () => {
    const override = executable('claude')
    // A different `claude` earlier on PATH must not win: an operator who names a path means it.
    process.env['PATH'] = join(executable('claude'), '..')

    expect(resolveBinary('claude', override)).toBe(override)
  })

  it('returns null for a BAD override, and does not quietly fall back to PATH', () => {
    // The decision this guards. With a fallback, a typo in VOICEDESK_AGENT_BIN would run some
    // other `claude` and report success, and the user would be debugging the wrong binary.
    const onPath = executable('claude')
    process.env['PATH'] = join(onPath, '..')

    expect(resolveBinary('claude', join(work, 'no-such-binary'))).toBeNull()
  })

  it('ignores an empty override rather than treating it as a bad one', () => {
    // An unset environment variable arrives as `''` often enough that this has to be a
    // deliberate answer: empty means "not configured", not "configured to nothing".
    const onPath = executable('claude')
    process.env['PATH'] = join(onPath, '..')

    expect(resolveBinary('claude', '')).toBe(onPath)
  })

  it('searches PATH before the known install locations', () => {
    const onPath = executable('whisper-cli')
    process.env['PATH'] = join(onPath, '..')

    expect(resolveBinary('whisper-cli', undefined)).toBe(onPath)
  })

  it('skips a file that exists but is not executable', () => {
    // The Finder-launched case in reverse: something with the right NAME is not the program.
    //
    // The name is deliberately one no machine can have installed. Using `whisper-cli` here made
    // this test fail against the REAL binary in /opt/homebrew/bin — which is `resolveBinary`
    // working exactly as designed, since a known install location is the third thing it tries.
    // A test that has to be right about the machine it runs on is a test that will be wrong.
    const dir = mkdtempSync(join(work, 'noexec-'))
    writeFileSync(join(dir, 'voicedesk-not-a-program'), 'text, not a program\n')
    chmodSync(join(dir, 'voicedesk-not-a-program'), 0o644)
    process.env['PATH'] = dir

    expect(resolveBinary('voicedesk-not-a-program', undefined)).toBeNull()
  })

  it('ignores empty entries in PATH rather than resolving against the root', () => {
    const onPath = executable('claude')
    process.env['PATH'] = ['', join(onPath, '..'), ''].join(delimiter)

    expect(resolveBinary('claude', undefined)).toBe(onPath)
  })

  it('returns null when the program is nowhere, instead of guessing a path', () => {
    process.env['PATH'] = mkdtempSync(join(work, 'empty-'))

    // Null and not a plausible string: the caller turns this into a SETUP failure naming the
    // install command, and a guessed path would turn it into a confusing ENOENT instead.
    expect(resolveBinary('definitely-not-a-real-program', undefined)).toBeNull()
  })
})
