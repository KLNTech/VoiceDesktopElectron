import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { couldNotFinish, readSpawnFailure } from '../src/infrastructure/process/spawn-failure'

const run = promisify(execFile)

/**
 * The table in `spawn-failure.ts` is a claim about another program's error objects — Node's —
 * and a claim like that is exactly the kind that rots without anyone noticing, because every
 * branch it feeds is an error path nobody exercises by hand.
 *
 * So each row is produced here by actually failing that way, against the real `execFile`. No
 * mock: a mock of Node's rejection would assert what this file already believes, which is the
 * one thing worth nothing.
 */
async function failureOf(
  fn: () => Promise<unknown>,
): Promise<ReturnType<typeof readSpawnFailure>> {
  try {
    await fn()
  } catch (error) {
    return readSpawnFailure(error)
  }
  throw new Error('expected the spawn to fail, and it did not')
}

describe('what an execFile rejection carries', () => {
  it('reads a missing binary as a string errno, with no exit status', async () => {
    const failure = await failureOf(() => run('/nonexistent/bin/nope', ['x']))

    expect(failure.errno).toBe('ENOENT')
    // The trap this interface exists for: `code` is a string here and a number below, so the
    // two live in separate fields and no reader has to remember which it got.
    expect(failure.exitStatus).toBeNull()
    expect(couldNotFinish(failure)).toBe(false)
  })

  it('reads a non-executable file as EACCES, not as a failed run', async () => {
    const failure = await failureOf(() => run('/etc/hosts', []))

    expect(failure.errno).toBe('EACCES')
    expect(failure.exitStatus).toBeNull()
  })

  it('reads a non-zero exit as a NUMBER, and keeps the last line of stderr', async () => {
    const failure = await failureOf(() =>
      run('/bin/sh', ['-c', 'echo noise >&2; echo the real problem >&2; exit 3']),
    )

    expect(failure.exitStatus).toBe(3)
    expect(failure.errno).toBeNull()
    expect(failure.detail).toBe('the real problem')
    // It ran and it failed. That is a different outcome from not finishing, and the difference
    // is what decides whether the user sees stderr or "it was stopped".
    expect(couldNotFinish(failure)).toBe(false)
  })

  it('reports the timeout option as this call having killed the child', async () => {
    const failure = await failureOf(() => run('/bin/sh', ['-c', 'sleep 5'], { timeout: 80 }))

    expect(failure.killedByThisCall).toBe(true)
    expect(failure.signal).toBe('SIGTERM')
    expect(couldNotFinish(failure)).toBe(true)
  })

  it('catches a child killed from OUTSIDE, which `killed` alone reports as false', async () => {
    // The case that motivated reading `signal` as well. `killed` means "this call killed it",
    // so a child signalled by anything else — the OOM killer, a stray `kill` — arrives with
    // `killed: false` and an empty stderr. Reading only `killed` files this under "the program
    // failed" and shows the user a blank message.
    const failure = await failureOf(() => run('/bin/sh', ['-c', 'kill -TERM $$; sleep 5']))

    expect(failure.killedByThisCall).toBe(false)
    expect(failure.signal).toBe('SIGTERM')
    expect(couldNotFinish(failure)).toBe(true)
    expect(failure.detail).not.toBe('')
  })

  it('reports an abort as aborted, with no signal and no status to go on', async () => {
    const failure = await failureOf(() =>
      run('/bin/sh', ['-c', 'sleep 5'], { signal: AbortSignal.timeout(80) }),
    )

    expect(failure.aborted).toBe(true)
    expect(failure.errno).toBe('ABORT_ERR')
    expect(failure.exitStatus).toBeNull()
    expect(couldNotFinish(failure)).toBe(true)
  })

  it('cannot tell a deadline from a cancellation, and this pins that boundary', async () => {
    // Both rows of the table, compared field by field. They are identical, which is the whole
    // point: nothing on the error says which one happened. If a future Node release ever DOES
    // distinguish them, this test fails and the paragraph in `spawn-failure.ts` gets rewritten
    // — which is the only way a documented limitation stops being true on purpose rather than
    // by accident.
    const deadline = await failureOf(() =>
      run('/bin/sh', ['-c', 'sleep 5'], { signal: AbortSignal.timeout(60) }),
    )
    const cancelled = await failureOf(() => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 60)
      return run('/bin/sh', ['-c', 'sleep 5'], { signal: controller.signal })
    })

    expect({ ...cancelled, detail: '' }).toEqual({ ...deadline, detail: '' })
    expect(deadline.aborted && cancelled.aborted).toBe(true)
  })

  it('falls back to the error message when stderr is empty, so nothing shows a blank failure', async () => {
    const failure = await failureOf(() => run('/bin/sh', ['-c', 'sleep 5'], { timeout: 80 }))

    expect(failure.detail.length).toBeGreaterThan(0)
  })
})
