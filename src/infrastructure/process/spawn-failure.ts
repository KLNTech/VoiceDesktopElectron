/**
 * What an `execFile` rejection actually carries, read once and named.
 *
 * Two adapters in this app spawn a program — `whisper-cli` and `claude` — and both have to turn
 * a rejected promise into one of `docs/PLAN.md` §5.6's outcomes. That mapping was written twice
 * before this file existed, and the second copy is where the divergence would have started.
 *
 * ## Why the fields are read defensively
 *
 * A thrown value's shape is a claim about someone else's code. `error as ExecException` would
 * let a changed shape read as `undefined` three layers up, silently, so every field below is
 * narrowed with `in` and `typeof` rather than asserted — the same rule §5.3 states for the
 * agent's JSON reply, applied to the error path.
 *
 * ## The fields, measured rather than remembered
 *
 * Observed on Node 26 / macOS by spawning each failure deliberately. Blank means the property
 * is **absent**, which is a third state that `=== undefined` and `=== null` do not distinguish:
 *
 * | how it failed              | `name`       | `code`                  | `killed` | `signal`  | `stderr` |
 * |----------------------------|--------------|-------------------------|----------|-----------|----------|
 * | binary not found           | `Error`      | `'ENOENT'`              |          |           | `''`     |
 * | binary not executable      | `Error`      | `'EACCES'`              |          |           | `''`     |
 * | exited non-zero            | `Error`      | `3` — **a number**      | `false`  | `null`    | the text |
 * | `timeout` option fired     | `Error`      | `null`                  | `true`   | `SIGTERM` | `''`     |
 * | killed from outside        | `Error`      | `null`                  | `false`  | `SIGTERM` | `''`     |
 * | `signal` aborted mid-run   | `AbortError` | `'ABORT_ERR'`           |          |           | `''`     |
 * | `signal` already aborted   | `AbortError` | `'ABORT_ERR'`           |          |           | `''`     |
 * | `maxBuffer` exceeded       | `RangeError` | `'ERR_CHILD_…MAXBUFFER'`|          |           | `''`     |
 *
 * Three things in that table are worth more than the table:
 *
 * **1. `code` is two different fields wearing one name.** It is a string errno on a spawn
 * failure, a **number** on a non-zero exit, and `null` when the child was signalled. So
 * `code === 'ENOENT'` is safe only because it compares against a string, while anything shaped
 * like `code !== 0` is wrong in three separate ways. This interface splits it into `errno` and
 * `exitStatus` so the trap cannot be walked into a second time.
 *
 * **2. `killed` does not mean the child was killed.** It means *this call* killed it — the
 * `timeout`/`killSignal` path. A child killed by anything else (the OOM killer, a user's
 * `kill`, a crashing parent shell) arrives with `killed: false` and `signal: 'SIGTERM'`, so a
 * classifier that reads only `killed` files that case under "the program failed" and shows the
 * user an **empty** message, because `stderr` is empty too. `signal` is the field that closes
 * it, and it is why `couldNotFinish` reads all three.
 *
 * **3. An abort and a deadline are indistinguishable here — and that is a boundary, not an
 * oversight.** The last three abort rows are byte-identical: `name: 'AbortError'`,
 * `code: 'ABORT_ERR'`, no `killed`, no `signal`, no `stderr`. Nothing on the error says whether
 * `AbortSignal.timeout()` expired, whether the caller cancelled, or whether the signal was
 * already aborted and no process ever ran. **The information does not exist on this object.**
 *
 * That is survivable today only because of a fact about the caller: `src/main/ipc.ts` passes
 * `AbortSignal.timeout(...)` and nothing else, so every abort this app can observe *is* the
 * deadline, and `timeout` is the honest outcome. The day `Esc` cancels a turn — `TurnFailure`
 * already reserves cancellation as distinct from failure — that stops being true, and the fix
 * is not a cleverer reading of the error: the caller must hand down a signal it can attribute
 * (`AbortSignal.any([deadline, cancel])`, then ask which one fired) because only the caller
 * knows. Written down here so the next reader spends no time looking for a field that is not
 * coming.
 */
export interface SpawnFailure {
  /** `code` when it is a string: `'ENOENT'`, `'EACCES'`, `'ABORT_ERR'`, … Never an exit status. */
  readonly errno: string | null
  /** `code` when it is a number: the status the child exited with. Never an errno. */
  readonly exitStatus: number | null
  /** The rejection is an `AbortError` — the deadline expired, or the caller cancelled (see above). */
  readonly aborted: boolean
  /** The signal the child died from, whoever sent it. Present for both kill paths. */
  readonly signal: string | null
  /** `killed`: whether *this call's* `timeout` option killed the child. Not "was it killed". */
  readonly killedByThisCall: boolean
  /** The one line worth showing a user: the last line of `stderr`, or the error's own message. */
  readonly detail: string
}

/** Reads the fields above off an unknown thrown value, without asserting its shape. */
export function readSpawnFailure(error: unknown): SpawnFailure {
  const field = (key: string): unknown =>
    typeof error === 'object' && error !== null && key in error
      ? Reflect.get(error, key)
      : undefined

  const code = field('code')
  const signal = field('signal')
  const stderr = field('stderr')
  // stderr is empty on every failure except a real non-zero exit, so the error's own message is
  // the fallback: without it, a killed child reports nothing at all to the user.
  const text = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error)

  return {
    errno: typeof code === 'string' ? code : null,
    exitStatus: typeof code === 'number' ? code : null,
    aborted: field('name') === 'AbortError',
    signal: typeof signal === 'string' ? signal : null,
    killedByThisCall: field('killed') === true,
    detail: lastLine(text),
  }
}

/**
 * The run ended without reaching its own end — a deadline, a cancellation, or a signal from
 * anywhere. Distinct from "it ran and failed", which has an exit status and something on stderr.
 */
export function couldNotFinish(failure: SpawnFailure): boolean {
  return failure.aborted || failure.killedByThisCall || failure.signal !== null
}

/** The last line is the one that says what went wrong; the rest is the program's banner. */
export function lastLine(text: string): string {
  const lines = text.trim().split('\n')
  return (lines[lines.length - 1] ?? '').trim().slice(0, 500)
}
