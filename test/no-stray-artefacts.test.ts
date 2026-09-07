import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * Nothing a test wrote may end up tracked in the repository.
 *
 * This exists because it happened, and it reached `main` in a clone every reviewer would pull.
 * `test/whisper-diagnosis.test.ts` stands whisper in with three-line shell scripts that write the
 * transcript where the adapter asked for it — `"$7"`, the value after `-of`. The first draft said
 * `"$6"`, which is the literal flag `-of`, so `printf … > -of.json` created a file called
 * `-of.json`. `execFile` gives the child THIS process's working directory, and vitest's working
 * directory is the repository root — so the file landed beside `package.json`, `git add -A` swept
 * it into a commit, and it was cloned from then on. Nothing was red at any point: the test suite
 * passed, the typecheck passed, the linter passed, and the reviewer sees an extra file whose name
 * looks like a mistake but could be anything.
 *
 * The general shape is worth naming: **a child process started by a test inherits the repository
 * as its working directory**, so any relative path a test gets wrong writes into the working tree
 * rather than into a temp directory where it would be swept away.
 *
 * A leading `-` is the specific signature of the mistake — a shell redirect that consumed a flag
 * as a filename — and it is also, independently, a filename nothing in this project should ever
 * have: a path beginning with a dash is read as an option by most command-line tools, which is
 * why removing it needs `git rm -- ./-of.json` rather than `git rm -of.json`.
 */
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 8 << 20 })
  .split('\0')
  .filter((path) => path !== '')

describe('the tracked file list', () => {
  it('has something to check', () => {
    // The classic silent pass: a command that produced nothing satisfies every filter below.
    expect(tracked.length).toBeGreaterThan(20)
  })

  it('contains no file whose name begins with a dash', () => {
    const offenders = tracked.filter((path) => path.split('/').some((part) => part.startsWith('-')))
    expect(offenders).toEqual([])
  })

  it('contains none of the scratch files the suite writes while it runs', () => {
    // Each of these is produced by a real test on a real path. They belong in the temp directory
    // `mkdtemp` hands out, and finding one tracked means a relative path escaped into the repo.
    const scratch = /^(clip\.wav|out\.json|model\.bin|.*\.aiff)$/
    const offenders = tracked.filter((path) => scratch.test(path.split('/').at(-1) ?? ''))
    expect(offenders).toEqual([])
  })
})
