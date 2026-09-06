# Night-batch deep review — iteration 1 (S1–S6), consolidated

Synthesis of an eight-lens deep-review panel. Written by the review lead from the eight specialist
reports, read verbatim, then spot-checked against the working tree. No source file was modified.

---

## 1. Baseline reviewed

| | |
|---|---|
| **Scope** | the cumulative diff of iteration 1, subtasks S1–S6 |
| **Batch base** | `5c861e4` (`origin/main` at gate time) |
| **Batch head at panel time** | `79aaffd` — **12 commits** |
| **Branch the panel ran on** | `mq-review/iteration-1-deep-review`, on top of `mq-feat/iteration-1-voice-to-text` |
| **Files** | 52 touched, +6954/−112. The pre-batch tree at `5c861e4` held only docs, so effectively all application code is in scope |
| **Since the panel ran** | merged to `main` as a merge commit (`7f88c78`, not squashed); current branch `mq-review/iteration-1-gate`, 3 commits above `origin/main` |
| **Lenses** | correctness, test-quality, conventions-compliance, code-quality, api-contract, architecture, performance, security |

### Caveat: the tree moved under the panel, and is still moving

This is disclosed rather than absorbed, because it changes how three findings should be read.

- **During the panel.** Two reviewers observed the checkout changing beneath them. The
  test-quality lens watched `git log` move from the stated base through `ec40477` to `38454b8`
  mid-review; the security lens observed five working-tree files change on disk, uncommitted,
  while `HEAD` stayed at `79aaffd`. The security lens handled this correctly, verifying every
  finding against `git show 79aaffd:<path>` rather than the mutating tree; the test-quality lens
  disclosed it and re-based its file:line references on `38454b8`.
- **After the panel.** Three commits landed that resolve findings outright — see §6, ALREADY
  FIXED. Every one was verified by the lead by reading the current file, not taken on report.
- **During this synthesis.** `package.json` changed on disk again: a `postinstall` script
  (`scripts/postinstall.mjs`, fetching the Electron binary that Electron 44 no longer ships an
  installer for) and an `oxlint` lint step plus two `oxlint` devDependencies were added. This is
  after the reviewed batch and is not itself reviewed here, but it does bear on two findings —
  M12 (`npm test` still neither typechecks nor lints) and the `allowScripts` minor (the
  recommended `ignore-scripts=true` fix would now break the repo's own `postinstall`).

**Consequence for the reader:** file:line references below were re-verified against the working
tree at the time of writing. Where a reviewer's line number had drifted, the lead's number is
used. Where a reviewer's claim did not survive that check, it is recorded in §7 rather than
laundered into the tables.

### Addendum: three source files changed again while this report was being written

Between the verification pass and the final write, a concurrent process edited
`src/infrastructure/transcribe/WhisperCppTranscriber.ts`, `src/renderer/src/audio/recorder.ts` and
`src/renderer/src/useTurn.ts`. **This report deliberately remains a record of the reviewed batch**,
so the findings below are not rewritten in place — but the reader must not act on an item that has
since been closed, so the deltas are recorded here and flagged inline where they land:

- **M8 is now fixed.** The whisper JSON cast is gone: `WhisperCppTranscriber.ts:24-26` declares a
  `WhisperOutput` zod schema (with a doc-comment citing `docs/PLAN.md` §5.3 by name), and `:75`
  reads `WhisperOutput.parse(raw).transcription ?? []`. `classify()` was rewritten in the same
  change to narrow with `in`/`Reflect.get` instead of `as` (`:91-116`).
- **M7 is NOT fixed by that change, despite it touching `classify()`.** `run(...)` and
  `readFile(...)` still share one `try` (`:63-88`), and `classify` still branches only on
  `field('code') === 'ENOENT'` (`:99`) with the same "Reinstall it" hint for both causes. The
  three-lens convergence stands.
- **Two nits in §5.6 are now fixed:** `recorder.ts:143` narrows with `error instanceof
  DOMException` instead of a cast, and the `'microphone' as PermissionName` cast at `:156` is gone.
- **One nit in §5.7 is now a documented decision rather than an oversight:** `toArrayBuffer`
  (`useTurn.ts:157-161`) still copies, but now by construction (`new ArrayBuffer` + `set`) with a
  doc-comment explaining that slicing `Float32Array.buffer` would need an unverifiable `as
  ArrayBuffer` claim. The copy is now a deliberate trade of 0.377 ms at the cap for removing a
  cast. No longer a finding.
- **Unchanged and still live in those same three files:** B1 (`useTurn.ts:51-73`, the `beginHold`
  continuation is byte-identical), M10 (the two clocks), M4 (`useTurn.ts:94-95` still
  `text === ''`), M5 (`recorder.ts:4-10`, `CapturedClip`/`StartResult` still declared), M9 (the
  double timeout budget), M18 (`recorder.ts:90-112`, the flush race, still untested).

---

## 2. Verdict

This is a well-built iteration with a small number of real defects concentrated in one file. The
architecture holds: the domain layer imports nothing platform-shaped and is gated by a test that
has been *watched* to redden; there is exactly one composition root; the IPC handlers are genuinely
thin adapters with no business rule in them; the Electron security posture (`contextIsolation`,
`sandbox`, `nodeIntegration: false`, CSP registered before any window can load, `execFile` with an
argv array and no shell) is explicit and correct, and the security lens found no exploitable path
anywhere in the batch. Four of the eight lenses returned zero blockers and zero majors of their
own. The defects that matter cluster tightly: **`src/renderer/src/useTurn.ts` is the weak file in
this batch** — it holds the one blocker, three of the eighteen majors, and it is also the file with
no test and a demonstrated history of shipping an undetected regression. The second theme is
**seams that the project's own plan calls critical but that no automated gate covers** —
`window.ts`'s three security flags, `ipc.ts`'s payload validation, the preload bridge shape,
`resolveBinary`'s branches — every one of which the test-quality lens showed is testable today in
plain Vitest with no Electron and no Playwright. The third is **hand-maintained duplication of
knowledge** (domain shapes restated in `shared/ipc.ts`, one timeout budget set twice, the window
palette in two files), where the failure mode is silent drift rather than a present bug. Nothing
here suggests a sloppy baseline; these are additions to a high one.

---

## 3. Must-fix now — blockers and majors

Ranked by severity, then by cost-to-fix within a severity (cheapest first). "Lenses" names the
specialists that independently reached the same claim; convergence is evidence of severity, not
duplication.

### Blockers

| # | `file:line` | Claim | Lenses | Suggested fix |
|---|---|---|---|---|
| **B1** | `src/renderer/src/useTurn.ts:51-73` | A hold released — or a second press started — while `mic.start()` is still pending leaves the microphone live and unreleased, with the UI back at rest. `beginHold` sets `recorder.current` synchronously (`:58`) then `await`s `start()`; `endHold`'s guard (`:72`) sees `stateRef.current.k` still `'idle'` and returns without stopping anything; the `.then()` continuation (`:60-67`) then unconditionally applies `hold-started`. Reproduced mechanically by the correctness lens against the real `nextTurnState`: `microphone released at any point? false`. The same window lets a second `beginHold` pass the same stale guard and overwrite `recorder.current`, orphaning the first recorder's `MediaStream`. This is the ordinary path on the **first hold of a session**, when the permission prompt or the first `audioWorklet.addModule()` fetch outlasts a quick press. It is the exact outcome `docs/PLAN.md` §2 and `recorder.ts:19-21` both name as the one that must never happen. | correctness (blocker), test-quality (blocker, via the double-press variant) | In the `.then()` continuation, check `if (recorder.current !== mic)` before applying `hold-started`; if the reference has moved on, `await mic.release()` instead of resurrecting a recording nobody is holding. No new state is needed — `recorder.current` already carries the information and is simply never consulted after the await. Ship the regression test from B2 in the same change. |
| **B2** | `src/renderer/src/useTurn.ts` (no `test/useTurn*.test.ts` exists) | The hook that implements S5's stated acceptance criterion ("hold a key or button, speak, release → your words appear as text") has **zero** automated coverage, and it is the file that already shipped a live, undetected regression (`{ t: 'replied', spoken: false }`, a `TurnEvent` shape that does not exist, invisible because the typecheck was answering from a stale cache — see §6). A missing gate on a stated acceptance criterion, on a file with a demonstrated undetected regression, is not a hypothetical risk. | test-quality (blocker) | `test/useTurn.web.test.ts` using `renderHook` from `@testing-library/react` (16.3.3, **already an installed devDependency imported by zero files**) with `vi.mock('./audio/recorder')` supplying a `start()` that returns a manually-resolved promise, plus a stubbed `window.voicedesk`. Cover at minimum: the happy path, the release-during-pending-start case (B1), and the double-`beginHold` case. Needs `environmentMatchGlobs: [['**/*.web.test.ts', 'jsdom']]` in `vitest.config.ts` — see the report-only note; `.web.test.ts` currently has no runtime effect. |

### Majors

Ordered cheapest-first within the group. The five items marked **[gate]** are one theme: a seam
the project's own documents call critical, with no automated check, all testable today in plain
Vitest.

| # | `file:line` | Claim | Lenses | Suggested fix |
|---|---|---|---|---|
| **M1** | `docs/PLAN.md:491` | §11's tech-stack table says `Vite \| 8.x`; `package.json:41` pins `7.3.6`. The README explains the pin correctly (`electron-vite@5`'s peer range is `^5 \|\| ^6 \|\| ^7`; `@vitejs/plugin-react@6` needs Vite 8) and two commits record the reasoning — but §11 is the table whose own header promises "every version is the current stable at the time of writing." An agent later told to "bring the toolchain in line with the plan" would attempt `vite@8` and rediscover a conflict this repo already solved. | conventions (major), code-quality (minor) | Change the row to `7.x` and fold in the one-clause reason. **Rule that decides it:** `docs/PLAN.md`'s own header — *"Living document. Every sentence here is true of the current code, or it gets corrected"* — plus `code-documentation` rule 3. Severity taken from the conventions lens, which cites the stronger rule. |
| **M2** | `package.json:16` | The `docs:pdf` script still carries the pre-rename stem: `docs/voicedesk-architecture.pdf` and the title `'VoiceDesk — architecture'`. Commit `79aaffd` claims the product was "renamed to voicedeskelectron across the docs, the ui strings and package.json" — not fully true. Confirmed by the lead with a repo-wide grep: this is the **only** surviving bare `VoiceDesk` in tracked shipped content. | conventions (major) | `git mv` the PDF to `docs/architecture.pdf` (the directory already disambiguates it) and update the script's path and title. One line plus one rename. |
| **M3** | `package.json:21` | `"test": "electron-vite build && vitest run"` builds, but never type-checks and (as of the tree's latest change) never lints. `typecheck` runs only inside `"build"`, which `test` does not call. Vitest transpiles with esbuild, which strips types and checks nothing — so a real type error ships green through `npm test`, exactly as the `spoken`/`speech` regression did. There is no pre-commit hook and no CI. Note the near-miss: the fix that landed for the renderer-build gate chose `electron-vite build` rather than `npm run build`, so the typecheck half was left behind. | test-quality (major) | Change to `"test": "npm run build && vitest run"` — one word, folds in typecheck, and now also add `npm run lint` since oxlint exists. |
| **M4** | `src/renderer/src/useTurn.ts:94-95` vs `src/domain/model/transcript.ts:13-15` | The domain has a tested `isEmpty()` that strips whitespace *and punctuation*, written precisely because "Whisper answers a silent clip with an empty string, or with the punctuation-only fragments it hallucinates from noise." The shipped path does not use it — `useTurn.ts` checks only `text.trim() === ''`. `test/run-voice-turn.test.ts:96-105` proves the rule against `makeRunVoiceTurn`, which nothing in `src/main/` calls. The rule is enforced in exactly the one place that never runs; a green test misrepresents the shipped behaviour. A `"."` from background noise is rendered as a real turn today, and will be sent to `claude -p` as a real request once S7 lands. | architecture (major), correctness (minor) | Import `isEmpty` in `useTurn.ts` and use it in place of the bare `=== ''`. One line, code already written. Severity taken from the architecture lens, which correctly weights that this is a *tested* rule that does not apply to production. |
| **M5** | `src/renderer/src/audio/recorder.ts:4-10` | `CapturedClip` (`:4-8`) is field-for-field, readonly-for-readonly identical to `AudioClip` (`src/domain/ports/Transcriber.ts:5-9`); `StartResult` (`:10`) is `Outcome<void>` (`src/domain/model/turn.ts:68`) branch for branch — and this same file already imports from `../../../domain/model/turn` on line 1, so `Outcome` was one identifier away. The sibling port `SpeechSynthesizer.speak()` already returns `Outcome<void>` for the identical shape. `Outcome`'s own doc-comment names the failure: if it grows a `cancelled` branch (which the comment says is already in view), `StartResult` does not. | code-quality (major) | Delete both; `start(): Promise<Outcome<void>>`, `stop(): Promise<AudioClip>`. Mechanical and behaviour-preserving — `useTurn.ts`'s `started.k === 'failed'` does not change. |
| **M6** | `src/main/index.ts:47-51` | Nothing ever sets `mainWindow` back to `null` or checks `.isDestroyed()`. `window-all-closed` deliberately keeps the app alive on macOS (`:80-82`, correct), so after the user closes the window with the red button, `mainWindow` is a stale, destroyed reference. The `second-instance` handler guards only `mainWindow === null` — never true again once a window has existed — so relaunching from Finder/Spotlight calls `.isMinimized()`/`.focus()` on a destroyed `BrowserWindow` and never recreates one. The `activate` handler two lines below (`:72-77`) does this correctly; `second-instance` is a different event and does not share the logic. `window.ts:56` applies the missing `isDestroyed()` discipline correctly for `followTheme`, which shows the pattern was known. | correctness (major) | `mainWindow.on('closed', () => { mainWindow = null })` after each `createWindow()`, and make the `second-instance` guard `if (mainWindow === null \|\| mainWindow.isDestroyed())` recreate, mirroring `activate`. |
| **M7** | `src/infrastructure/transcribe/WhisperCppTranscriber.ts:66,83-99` | `classify()` cannot tell "the binary is missing" from "the binary ran fine and wrote no output file", and gives the wrong advice for the second. `run(...)` (`:58`) and `readFile(`${outBase}.json`)` (`:66`) sit inside one `try`; Node stamps `ENOENT` on both a missing executable and a missing file; `classify` branches only on `e.code === 'ENOENT'` (`:86`) and answers *"whisper-cli could not be run. Reinstall it with `brew install whisper-cpp`"* either way. Reproduced by the correctness lens calling the real private `classify()` with both error shapes: byte-identical output. Reachable by a `whisper-cpp` release renaming `-oj`/`-of`, a build that appends the language to the filename, a full temp volume, or a crash after partial output — in every case a correctly installed binary is diagnosed as "not found." This is the file's own header comment's stated purpose, inverted. **No test reaches this path at all**: the existing "missing binary" test (`test/whisper-transcriber.test.ts:101-112`) passes `binPath === null`, which short-circuits at `:36-42` before `execFile` runs, and the `killed`/`AbortError` → `timeout` branch (`:95-97`) is never exercised either — every `AbortSignal.timeout` in that suite is long enough never to fire, so "timeout kills", named in `docs/PLAN.md` §12 as a covered case, has no test. | correctness (major), api-contract (major), test-quality (major) | Split the try: wrap `readFile`/`JSON.parse` in its own catch and map a missing output file to a distinct message ("whisper-cli ran but produced no transcript"). Reserve the ENOENT branch for the spawn itself — `e.syscall` on a spawn ENOENT starts with `"spawn "`, and `fs` errors carry `path` while spawn errors do not. Add the two cheap tests the test-quality lens specified: a non-null-but-nonexistent `binPath`, and `AbortSignal.timeout(1)` against the real binary. **Strongest convergence in the panel — three independent lenses, one of them with a mechanical reproduction.** |
| **M8** ⟶ **fixed after the review, see §1 addendum** | `src/infrastructure/transcribe/WhisperCppTranscriber.ts:55-80` | External JSON is cast, not parsed, and the cast sits under a five-operation `try`. `:66-67` types `raw` as `unknown` correctly and then immediately widens it back with a bare `as WhisperJson`. `docs/PLAN.md` §5.3 states the opposite rule for the sibling process boundary — *"Parse the reply, never cast it"* — which the agent adapter is specified to follow. Two distinct failure directions, both silent: (a) if `raw` is `null` or an odd shape, `.transcription` throws a `TypeError`, which the one broad `catch` at `:74` relabels as `transcribe-failed` — a bug reported to the user as an expected failure; (b) if a future whisper release nests the transcript differently, `?? []` yields `succeeded({ text: '' })`, which `useTurn.ts:95` turns into "Nothing was heard" after a perfectly transcribable utterance. | code-quality (major), api-contract (minor) | A minimal zod schema (`z.object({ transcription: z.array(z.object({ text: z.string().optional() })).optional() })`) with `.safeParse`, failure mapped to `transcribe-failed` rather than falling through to `empty-speech`; and narrow the `catch` to wrap only the `execFile` call. Severity from the code-quality lens: the `TypeError`-relabelling half is a real crash-to-misdiagnosis path, which the contracts lens did not weigh. |
| **M9** | `src/infrastructure/transcribe/WhisperCppTranscriber.ts:32,63,96` + `src/main/ipc.ts:34` | One operation's time budget is set twice, by two independent mechanisms that agree today only by coincidence: the constructor's `timeoutMs = 60_000` fed to `execFile`'s own `timeout`, and the caller's `AbortSignal.timeout(60_000)` passed into the same call. Whichever fires first wins, silently. Worse, `classify()`'s timeout branch reports `{ kind: 'timeout', afterMs: this.timeoutMs }` **unconditionally** — it always blames the constructor's constant even when the caller's signal is what ended the run, and `App.tsx:135` renders that number to the user as *"Stopped after Ns."* The same pattern is seeded for S7: `ipc.ts:42,52` hard-code `90_000` and `120_000` with no named constant. | code-quality (major) | Pick one owner — the `AbortSignal` the caller already threads through every port — drop the redundant internal `timeoutMs`/`execFile({timeout})`, and report `afterMs` from a measured `performance.now()` delta rather than a configured constant. Name the `ipc.ts` magic numbers next to the channels they bound. *Narrowing, recorded honestly:* the performance lens measured real `whisper-cli` at 0.89 s on a clip at 99% of the byte cap, i.e. ~67× headroom, so a spurious kill is not the live risk — a wrong number in a user-facing message is. |
| **M10** | `src/renderer/src/useTurn.ts:66,77-83` + `src/renderer/src/audio/recorder.ts:34,91` | The 250 ms gate is decided from two clocks that disagree, and a real hold can vanish with no transcript and no notice. The reducer compares `performance.now()` taken **after** `mic.stop()`'s flush/release await (`:77`) against `startedAt`, which is set **after** `mic.start()`'s acquisition await (`:66`) — so it measures only the post-acquisition window. The `tooShort` notice (`:82`) instead uses `clip.heldMs`, computed from `recorder.ts:34`, set at the very *top* of `start()`, before acquisition. Whenever acquisition outlasts the tail flush — true on essentially every hold, heavily on the first of a session — the reducer's window is the shorter one, so a genuine hold can measure under `MIN_HOLD_MS` to the reducer while `clip.heldMs` is already over it: **neither** branch fires. The audio is discarded with zero on-screen feedback. Reproduced by the correctness lens against the real `nextTurnState` with a 400 ms physical hold of which 320 ms was acquisition: `after.k = idle`, `tooShort` check `false`. | correctness (major) | Use one measurement for both decisions — start `MicrophoneRecorder`'s clock in the continuation after `start()` resolves (or have `stop()` take the caller's base timestamp), and drive both the `hold-ended` event and the notice off that same number. Fixing this alongside B1 is natural: both are the `beginHold` continuation not owning what happens after the await. |
| **M11** | `shared/ipc.ts:44-56` + `src/renderer/src/audio/recorder.ts:28` | The only limit on a hold is a **byte** cap enforced *after* the whole recording has been captured and copied, and it silently becomes a different **time** limit per device. `TranscribeReq.pcm` caps at 8 MB with the comment "roughly two minutes at 16 kHz" — true only at 16 kHz. The schema's own `sampleRate` is deliberately `min(8_000).max(192_000)` because §6 promises a 48 kHz device works and `AudioContext({sampleRate: 16_000})` falls back to the native rate (`recorder.ts:128-135`). So the real maximum hold is ≈131 s at 16 kHz, **≈43.7 s at 48 kHz**, ≈10.9 s at the schema's own ceiling. There is no `MAX_HOLD_MS`, no recorder-side cap and no UI warning — confirmed by grep across `turn.ts`, `recorder.ts`, `useTurn.ts`. What the user sees when they cross it: `main/ipc.ts:28` returns `{kind:'transcribe-failed', stderr:'malformed audio payload'}`, and `App.tsx:129` renders that literal string as the body of "That did not transcribe" — a developer-facing sentence naming the wrong problem, for a recording that was never even attempted. | api-contract (major), performance (major) | Either cap on computed duration rather than a flat byte count, or enforce a client-side `MAX_HOLD_MS` in the turn machine so a hold ends before it can produce an uncarryable payload — and either way give the size refusal its own `TurnFailure` kind with real user copy, instead of routing it through the bucket whose body field is meant for a real whisper stderr tail. **Convergence verified: two lenses, arrived at independently, with the same arithmetic.** |
| **M12** | `shared/ipc.ts:22-34, 57, 63-72, 85-92` | The domain's shapes are re-derived by hand in `shared/ipc.ts` four times, with no import and no check that they still agree: `TurnFailureSchema` restates `turn.ts:31-38`; `TurnStatePush` restates `turn.ts:15-21`; the anonymous object in `TranscribeRes` restates `transcript.ts:2-6`; the one in `AskRes` restates `agent-reply.ts:2-16` with a field renamed. A fifth copy lives in `docs/PLAN.md:406-414`. `shared/ipc.ts` imports nothing from `src/domain`. The contracts lens correctly narrowed part of this: TypeScript *does* catch a `TurnFailure` divergence at `main/ipc.ts`'s explicitly-annotated `Promise<TranscribeRes>` return positions. But that protection is one-directional, undocumented, dependent on every handler keeping an explicit return annotation, and — verified by the lead — **does not cover `TurnState`/`TurnStatePush` at all**, since `pushTurnState` is never called with a domain `TurnState`. | code-quality (major), api-contract (minor) | Four lines: a mutual-assignability assertion next to each schema (`type AgreesWith<A,B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never`), importing the domain type it mirrors. Turns "hope" into a build error, the same move `test/architecture.test.ts` already makes for the dependency rule. Separately, replace `docs/PLAN.md` §7's copy with a pointer. |
| **M13** | `test/architecture.test.ts:9` | The dependency-rule regex has verified false negatives. The test-quality lens ran the installed regex against a battery of snippets in Node, not by reading: caught are `import x from "electron"`, `node:fs`, `fs/promises`, `export … from 'electron'`, and (contrary to the brief's premise) `import type` and `node:fs/promises`. **Bypassed** are side-effect imports (`import "electron"`), dynamic `await import("node:child_process")`, `require("fs")`, any Node builtin without the `node:` prefix outside the four listed (`crypto`, `worker_threads`, `net`, `dns`, `util`, `stream`, …), and ambient `process.env`/`process.platform` with no import at all. This is the gate the project holds up as its example of a rule made real; the deliberate violation it was watched to redden on was the easy case. | test-quality (major) | Harden to `/(?:from\s+['"]\|require\(\s*['"]\|import\(\s*['"]\|^\s*import\s+['"])(electron\|node:\|fs\|path\|child_process\|os)/m` plus a separate check for bare `\bprocess\.\|\bBuffer\b\|__dirname\|__filename`. Still a heuristic — a real fix walks the TS AST, and the compiler is already a dependency — but it closes the plausible holes for a few lines. Now that `oxlint` is in the tree, a lint rule is the other route. Keep the non-empty-glob assertion at `:14` exactly as it is; it guards the classic silent pass and is not itself weak. |
| **M14** **[gate]** | `src/main/window.ts:41-46` | The three settings `docs/PLAN.md` §8 singles out — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — are written out on purpose, explicitly because "a default nobody chose is a default anyone can change without a review noticing… the gap between the two settings is an XSS bug versus remote code execution." The only thing standing between those flags and a silent flip today is a human reading a diff. The security lens confirmed all three are correct *now*; nothing would catch them changing. | test-quality (major) | `test/window.test.ts`: `vi.mock('electron')` with a stub `BrowserWindow`, call `createWindow()`, assert on the exact `webPreferences` object the constructor received, and that the `setWindowOpenHandler` callback returns `{action:'deny'}`. Roughly ten lines of mock and one assertion object — **the best value-per-line item in the whole panel**, guarding the exact lines the project's own plan says turn a bug into an RCE. |
| **M15** **[gate]** | `src/main/ipc.ts:25-63` | S4's acceptance criterion is explicit — *"the renderer can reach exactly the five declared messages and nothing else"* — and has no automated check on the main-process side. If `TranscribeReq.safeParse` (`:26`) were deleted, weakened, or its 8 MB bound dropped, a malformed or oversized payload from "the least-trusted process in the app" (the file's own comment) would flow straight into a port with no test noticing. This does **not** need a live renderer or the S10 cut: `vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))` makes `registerIpcHandlers` importable and its handlers callable under plain Node. | test-quality (**blocker** → downgraded to major by the lead, see §7) | `test/ipc.test.ts` capturing each registered handler and calling it with a valid payload and a battery of invalid ones (missing field, wrong type, oversized `pcm`, out-of-range `sampleRate`), asserting the exact `{k:'failed', failure:{kind:…}}` shape. |
| **M16** **[gate]** | `src/preload/index.ts:23-45` | The other half of S4's criterion, equally ungated. `onTurnState` (`:33-44`) is the one place preload distrusts main — a push failing `TurnStatePush.safeParse` is dropped rather than delivered. Remove that guard and nothing today notices, because nothing calls the internal handler in any test. | test-quality (major) | `vi.mock('electron')` with a stub `contextBridge.exposeInMainWorld`, import the module for its side effect, capture the object from the mock's call args, and assert: the key set is exactly the five bridge methods; each delegates to `ipcRenderer.invoke` with the right `CH.*`; and the `ipcRenderer.on` handler drops a payload that fails `safeParse`. |
| **M17** **[gate]** | `src/infrastructure/process/resolveBinary.ts:13-31` | Exercised only indirectly, through whichever real binaries happen to exist on the test machine. None of its own branches are pinned: override-valid wins; **override-invalid returns `null` and deliberately does not fall back to `PATH`** (`:15`, a documented design choice with nothing asserting it); the `PATH`-then-known-locations order. A refactor that made an invalid override fall through silently would turn "you configured this wrong, here is the fix" into "it is using some other binary than the one you pointed at," with nothing red. | test-quality (major) | `vi.mock('node:fs')` to control `accessSync` per path, plus save/restore of `process.env.PATH`. Pure-logic unit tests, no filesystem writes, no real binaries. |
| **M18** **[gate]** | `src/renderer/src/audio/recorder.ts:90-112` | `stop()` posts `'flush'` to the worklet port and races the `'done'` reply against a hardcoded 250 ms `setTimeout` (`:105`). Neither branch has a test. This is exactly the "silent hang vs. silent data loss" logic that breaks in a refactor without anyone noticing, and it does **not** need jsdom or Web Audio: a hand-built double for `this.node` (`{port: {postMessage, onmessage, close}, disconnect}`) plus `vi.useFakeTimers()`/`advanceTimersByTime(250)` exercises both deterministically. Adjacent and equally cheap: `concat()` (`:165-174`, pure), `classifyMicError` (`:142-152`) and `denialKind` (`:154-163`) with a fake `DOMException`-shaped object — all untested today. | test-quality (major) | `test/recorder.test.ts`, plain `.test.ts`, no DOM, no hardware. |

---

## 4. Decisions for the human

Five items where **two written rules disagree, or a document contradicts itself**. A reviewer must
not silently pick a side in any of these — the resolution changes what the project *is*, not just
what the code does. Each records the panel's recommendation and the reason, but the call is not
the panel's to make.

### D1 — `docs/PLAN.md` §3 vs §7: do handlers call the use case, or drive three channels?

- **§3** (`docs/PLAN.md:150`) shows the composition root returning `{ runVoiceTurn: makeRunVoiceTurn(...) }` and states *"IPC handlers are adapters too: unwrap, call the use case, wrap."*
- **§7** (`docs/PLAN.md:378-391`) declares three independent channels — `transcribe`, `ask`, `speak` — precisely so the renderer can show the transcript before the agent answers (§4: *"the transcript must not wait behind [the agent]"*) and so speaking can be triggered separately.
- **The code** (`src/main/composition-root.ts:49-73`, `src/main/ipc.ts:25-54`) follows §7: `buildPorts` returns bare `Ports`, and each handler calls a port directly. `makeRunVoiceTurn` is constructed by nothing that ships and is exercised only by its own test.

These cannot both be literally true. A single fused `runVoiceTurn` IPC call cannot serve a
three-round-trip UI. **The panel's read: this is the plan disagreeing with itself, not the code
disobeying the plan** — forcing the code to match §3 would regress the UX §4 requires; forcing §7
to match §3 would regress "show the transcript immediately." Neither side should move to match the
other. **Recommended resolution (architecture lens):** rewrite §3's example to return `Ports` and
add one sentence naming `runVoiceTurn` as the same flow expressed as one pure function, kept for
domain testing and as the seam a future single-shot caller would use. **Why a human decides:**
that sentence promotes a currently-unshipped function to a documented, intentional second
consumer-shape. If the answer is instead "delete `runVoiceTurn`," that is a scope call, and it
would also delete the home of `isEmpty` that M4 asks the renderer to start using.

### D2 — Versioning cadence: the `versioning` skill vs `docs/PLAN.md` §9

- **Org `versioning` skill:** one bump per merge, as the **last commit on the PR branch, after human sign-off, immediately before merge** — explicitly *"nie przy każdej rundzie poprawek."*
- **`docs/PLAN.md:447-449`:** *"every code change bumps the patch level… the version badge is being used as a live signal during manual testing, so it has to move whenever the code does."*

These conflict on **ordering**, not merely frequency: §9 requires bumping on WIP commits before
sign-off, which is exactly what the skill's gate forbids. **Observed fact, verified by the lead:**
`package.json:3` still reads `0.1.0` — unchanged across all 12 commits of the batch **and across
the merge to `main`**. So neither rule was followed: §9 says the patch level should have moved ~6
times; the skill says the merge itself should have carried one bump, and it did not. The
conventions lens adjudicated for the skill (it is an unconditional org-wide TRIGGER+GATE with no
per-project cadence carve-out, unlike the *carrier location*, which the skill does delegate to the
project). **Recommended:** reword §9 to the standard cadence, and if a live "is this the build I
just changed" signal is still wanted, put the git short SHA next to the badge rather than
overloading the one canonical SemVer field with two purposes that want different update rates.
**Why a human decides:** the skill is org policy; a project-level override of it needs an owner's
word, and the merge that already happened is now retroactively non-compliant either way.

### D3 — Squash-merge: the `commit-messages` skill vs this project's own documents

- **`commit-messages` skill, "Merge strategy — ABSOLUTE RULE":** *"Every PR is squash-merged into `main`. Never a merge commit, never rebase-merge… This applies to all organisation repos."*
- **`.claude/CLAUDE.md` and the committed `docs/WORK-BREAKDOWN.md`, "Branching, and a deliberate deviation":** *"Merge with a merge commit. Never squash. A squash merge destroys exactly the history the brief asks to be shown"* — quoting the client requirement verbatim: *"Don't clean up the history. Real commits as you go, not one squash at the end."*

Direct opposites, both stated unconditionally. **The batch was in fact merged as a merge commit
(`7f88c78`)**, so the project rule was followed and the org rule broken. The conventions lens
recommends the project rule stand — it is a concrete, quoted client requirement, it is reasoned
rather than silent, and the substance is already recorded in a *committed* canonical file, which is
the right home for a project-specific deviation. **What is missing is the cross-reference:** neither
document names `commit-messages` as the rule being overridden, so a future reader of the skill has
no way to discover this repo is the documented exception, and a future reader of this repo has no
way to tell a conscious override from ignorance. **Why a human decides:** recording a per-project
carve-out in an org skill is an org-level edit.

### D4 — `.claude/` is gitignored, but carries this project's only copy of two rules

`.gitignore:16-19` blanket-excludes `.claude/`, `CLAUDE.md` and `.mcp.json`, reasoned as *"Local
tooling only: it is symlinked to repos that exist on one machine."* That reasoning is correct for
the symlinked contents. It is **not** correct for two real, non-symlinked files that live there:

- `.claude/CLAUDE.md` — a 985-byte real file stating this project's iteration/branch/PR/merge policy, content no contributor, CI run or fresh clone can see. Concretely observed: the conventions reviewer's own role instructs *"Read `CLAUDE.md` end-to-end"* — on a fresh clone that instruction silently checks nothing.
- `.claude/hooks/machines.txt` — the `branch-naming` skill says verbatim: *"add one line… **and commit it**."* It was never committed, so the `mq-` prefix on both branches in this batch is, to any other reader, undocumented. (The skill's prescribed "ask GitHub for the runner name" bootstrap is a genuine dead end here — the conventions lens checked, the repo has zero runners — so inventing the entry was not avoidable laziness; only the not-committing part contradicts the skill.)

**Recommended (conventions lens):** fold `CLAUDE.md`'s procedural detail into
`docs/WORK-BREAKDOWN.md` (cheaper, and matches the pattern already used for the merge-strategy
deviation), or carve narrow `.gitignore` exceptions (`!.claude/CLAUDE.md`, `!.claude/hooks/machines.txt`).
**Why a human decides:** the `.gitignore` policy is the project's own stated position and the skill
is org policy; one of them has to yield.

### D5 — `docs/PLAN.md` §3's renderer import row contradicts §3's own domain description

- **`docs/PLAN.md:86`** — the renderer "may import" column reads *"shared types and the bridge — nothing else."*
- **`docs/PLAN.md:89`**, three lines later — *"`domain/` is plain TypeScript that would run in a browser, in a test, or in a CLI."*
- **The code** — `src/renderer/src/useTurn.ts:3` imports `MIN_HOLD_MS` and `nextTurnState` from `../../domain/model/turn` as **values**, not types. (`App.tsx:1` and `talkControl.ts:1` import from the same module `type`-only, erased at compile time, and are not part of this.)

The architecture lens judges the code right and the table cell too narrow: running the pure state
machine in the renderer is the only way to get the zero-latency pointer/keyboard handling §2
requires. **Recommended:** reword the row to *"shared types, the bridge, and `domain/model` (pure
types and pure functions) — never `domain/ports`, `domain/usecases`, or `infrastructure`"*, and
extend `test/architecture.test.ts` with the symmetric check that actually matters — nothing under
`src/renderer/**` imports `src/infrastructure/**` or `src/domain/ports/**`. Today the gate covers
only domain's *outbound* imports, so **either** reading of the rule is unverified by tooling.
**Why a human decides:** this widens a stated layer boundary, and M4 depends on the answer — it
asks the renderer to import one more domain function.

---

## 5. Report-only — minors and nits

Not gating. Grouped by theme, cluster-counted where a list is more useful than rows.
**23 minors, 18 nits.**

### 5.1 Documentation drift and unguarded facts (6 minor, 3 nit)

The theme the panel found most often, and the one `code-documentation` rule 3 exists for: a
sentence asserting a checkable fact about this repo, with no check behind it.

- **minor** — `docs/PLAN.md:386-391`: §7's schema sample still shows `refine(b => b.byteLength <= 16 * 1024 * 1024)` and `sampleRate: z.literal(16000)`; the real `shared/ipc.ts:44-56` is 8 MB and `min(8_000).max(192_000)`. The literal was dropped deliberately (commit `b3eca62`: *"§6 promises a 48 kHz device works, and a literal rejects it"*) — the sample was not updated, so the plan currently argues for the shape the project already rejected. `AskRes` in the same block shows two fields; the real one has five. `SpeakReq`/`SpeakRes`/`AppInfoRes`/`TurnStatePush` are absent. *Raised by api-contract (nit), architecture (minor), performance (as supporting evidence). Fix: replace the fence with a pointer — a sample that is not the file will keep drifting; a pointer cannot.*
- **minor** — `docs/PLAN.md:406-414`: the `TurnFailure` union is transcribed verbatim in prose, a fifth hand-maintained copy (see M12). Same fix.
- **minor** — `docs/WORK-BREAKDOWN.md` S1 acceptance criterion and `docs/design/DESIGN-BRIEF.md` §6 both hardcode the literal string `v0.1.0 · dev`. §9 correctly describes the badge as reading `package.json` at build time; these two instead pin today's value inside an *acceptance criterion*, which is meant to be checked verbatim against a PR. A correct future bump makes a currently-true sentence silently false.
- **minor** — `README.md` "Using it", steps 3–4, describe the agent reply and `notes/` in the present tense; the same file states two paragraphs later that none of it works yet. The `◻︎` mark says "not yet *verified*", not "not yet *true*". Mitigated by the correction being close by, which is why it is minor.
- **minor** — `README.md:253` claims the third-party licence table *"is regenerated whenever a dependency changes."* No such generation step exists (`scripts/` holds `docs-pdf.sh`, `md2html.py` and now `postinstall.mjs`; no `package.json` script does it). It is already visibly false: the table lists Testing Library 16.3.3 but has no row for `@testing-library/jest-dom`, an equally real devDependency.
- **minor** — Three name-families coexist (`VoiceDesktopElectron` repo / `VoiceDeskElectron` product / `VoiceDeskBridge`, `window.voicedesk`, `VOICEDESK_*` env vars, `voicedesk-` temp prefixes) with nothing recording that the internal short form is pinned **on purpose**. The split is defensible — env vars are a user-facing compatibility surface that should not churn for a cosmetic rename — but the next contributor cannot tell "leave this alone" from "the rename stalled." One sentence next to the naming preamble in `docs/PLAN.md` fixes it.
- **nit** — `docs/design/DESIGN-BRIEF.md:177-179` says §7 declares **five** failure kinds; it declares **seven**. The brief was written before `transcribe-failed` and `no-microphone` landed later in the same batch. Low cost (the file is explicitly provisional) but the sentence is phrased as settled fact outside that framing.
- **nit** — `package-lock.json:2,8` still read `"name": "voicedesk"` against `package.json:2`'s `voicedeskelectron`. **Verified harmless:** the architecture lens actually ran `npm ci` (exit 0, 168 packages), so S1's acceptance criterion is not broken; it self-corrects on the next `npm install`.
- **nit** — `docs/handoff/2026-09-06-voicedesk-build.md` carries the old stem. Gitignored by its own nested `.gitignore` and never ships, so it is not repo-facing.

### 5.2 Test hygiene (5 minor, 2 nit)

- **minor** — No gate stops `"composite": true` or `"incremental": true` being added back to either tsconfig for a legitimate-sounding reason (faster local rechecks), silently reopening the hole described in §6. Cheapest durable fix: one assertion in `test/architecture.test.ts` that neither key is present in either config.
- **minor** — `src/domain/model/transcript.ts:13-15`'s `isEmpty` is exercised by exactly one indirect data point (`'  ...  '` through `run-voice-turn.test.ts:97`). A mutation to the strip regex — dropping one punctuation character, or over-stripping into false "empty" — has almost nothing guarding it. It is a pure function; four direct one-line cases cost milliseconds. *This matters more once M4 lands and makes it production code.*
- **minor** — A test file named `*.test.tsx` (the obvious shape for an eventual component test) matches **neither** tsconfig's include globs **nor** `vitest.config.ts`'s include list — all three are `.ts`-only. It would be invisible to both typecheck and to `vitest run` until someone updated three separate glob lists.
- **minor** — The `.web.test.ts` suffix currently controls only *which tsconfig type-checks a file*; it has no runtime effect. `vitest.config.ts:4` sets one global `environment: 'node'`, there is no `environmentMatchGlobs` and no `@vitest-environment` pragma anywhere. `jsdom` (30.0.1), `@testing-library/react` (16.3.3) and `@testing-library/jest-dom` (7.0.1) are installed and imported by **zero** files. The naming convention makes it easy to assume a browser-like runtime that is not there — and B2's recommended test will fail outright until this is wired. *Raised by test-quality and code-quality (N5) independently.*
- **minor** — `test/whisper-transcriber.test.ts:83-85` asserts `≥3 words`, deliberately weakened from "contains milk" because `base.en` mangles the synthetic `say` voice — honestly documented in the file. The residual gap: whisper's known silence hallucinations ("Thank you for watching" is four words) would satisfy it. Only minor because `test/wav.test.ts` independently pins the encoder deterministically, so the "encoder produced garbage" scenario is caught elsewhere; what is left uncovered is narrower (a wrong `-l` flag, wrong argv order, a JSON-parsing regression yielding a plausible string). One extra assertion — a short blocklist of the known stock phrases — closes it without reintroducing brittleness.
- **nit** — `test/turn-machine.test.ts` never exercises `turn.ts:127-132`'s `default: throw` arm (dead today; `nextTurnState` is only ever called with a well-typed `TurnEvent`).
- **nit** — `test/wav.test.ts` never tries a zero-length `Float32Array`.

### 5.3 Wire code that exists but nothing uses (3 minor)

- **minor** — `appInfo` and the `state` push are built end-to-end — schema, main handler, preload method, unsubscribe wiring — and called by **nothing**. `pushTurnState` (`src/main/ipc.ts:67-70`) has zero call sites in `src` or `test`; `window.voicedesk.onTurnState` is never called in the renderer, which manages `TurnState` entirely locally. `appInfo` is unused because `App.tsx:21-22` reads the build-time `__APP_VERSION__` constant — and `electron.vite.config.ts:9-11`'s own comment argues *against* putting the version on the bridge at all, which `AppInfoRes.version` then does. Building them is not scope creep (§7's `CH` object predates the batch, and S4's criterion only requires the five messages be *reachable*), but a main-driven state push would be a **second** source of the state the project has otherwise been careful to keep singular — `docs/PLAN.md` §11 commits to "one state machine, held in one hook." *Raised by code-quality (minor, E1), architecture (minor, F9), api-contract (nit, F8). Fix: name the consumer and the subtask in a one-line comment matching the style already used for the stub ports in `composition-root.ts:56-71`, or delete and record the cut.*
- **minor** — `src/preload/index.ts:37-38` drops a state push that fails `safeParse` with no error and no log. Unreachable today (nothing sends on that channel), so it is currently a latent shape rather than a live swallow — but it ships silently the day someone starts using it, which is `ts-error-model`'s "never swallow" failure mode.
- **minor** — Three devDependencies with no consumer: `@testing-library/jest-dom`, `@testing-library/react`, `jsdom` (see 5.2). Per `no-speculative-generality`'s litmus they should go and come back when S8 needs them — **except** that B2's recommended test needs two of the three, so this one is better resolved *by wiring them up* than by removal.

### 5.4 Security hardening — defense in depth, no live exploit path (4 minor, 2 nit)

The security lens found **zero blockers and zero majors** and explicitly rated everything against
this app's real threat model (local macOS desktop, single user, no server, no other principals)
rather than a public web service. Every item below is "closed before it can open."

- **minor** — `src/main/window.ts:65-68`: `setWindowOpenHandler` correctly denies the new-window action but unconditionally forwards the URL to `shell.openExternal(url)` first, with no scheme allowlist. Not exploitable today — repo-wide grep confirms no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `new Function` sink anywhere, and the prod CSP has no `unsafe-eval` and no `unsafe-inline` for scripts — but it goes live the moment a later iteration renders agent- or note-authored text as a clickable link, since `openExternal` on an uninspected scheme can invoke any locally installed app's custom protocol handler. *Fix: allow only `https:`/`http:`.*
- **minor** — `package.json`'s `allowScripts` block is enforced by nothing: it is not a field npm understands, there is no `@lavamoat/allow-scripts` devDependency, and `.npmrc` (which contains only `engine-strict=true`) does not set `ignore-scripts`. `npm ci` runs lifecycle scripts for every package exactly as if the field were absent, while its presence gives a reviewer false confidence. *Fix: wire real enforcement, or remove the field so the repo does not claim a control it lacks. **Note added by the lead:** the tree now has its own `postinstall` (`scripts/postinstall.mjs`, fetching the Electron binary), so a blanket `ignore-scripts=true` would break `npm ci` on a clean machine — whichever route is chosen has to keep that script running.*
- **minor** — `src/main/index.ts:31,34`: both dev and prod CSP carry `style-src 'self' 'unsafe-inline'`. The only inline-style usage is React's `style={{ height: … }}` on `TalkButton.tsx:55`, which React applies via per-property CSSOM assignment — not the literal `style="…"` attribute that `style-src` actually targets. An unforced widening of exactly the hardening §8 calls "the switch that matters." *Fix: try dropping it from prod, confirm the built renderer still renders, and record what needs it if anything does.*
- **minor** — `src/infrastructure/process/resolveBinary.ts:18,26`: every `PATH` entry is checked for `claude`/`whisper-cli` **before** the fixed known-good locations. The function's stated purpose is defending against a Finder-launched app's *too-minimal* PATH, not a poisoned one, and under the single-user threat model this is not privilege escalation — anyone who can write an earlier PATH entry already has code execution as that user. It is still the reverse of the safer default and costs nothing to flip.
- **nit** — No `session.setPermissionRequestHandler`/`setPermissionCheckHandler`. Nothing today requests anything but the microphone, so this is pure defense in depth, in the same deny-by-default spirit already applied to `setWindowOpenHandler` and `will-navigate`.
- **nit** — Forward pointer for S7, recorded so the next gate checks it explicitly: this batch never lets dictated text reach a subprocess (both agent and voice ports are inert stubs). When `ClaudeCliAgentRunner` lands, `docs/PLAN.md` §5.1's argv-array discipline must hold — which `WhisperCppTranscriber` already proves out correctly for audio.

### 5.5 Contracts and error-path robustness (2 minor, 1 nit)

- **minor** — `shared/ipc.ts:45-48` bounds `pcm`'s size but not the **sample alignment** `main/ipc.ts:33`'s `new Float32Array(pcm)` requires (a multiple of 4). Unreachable through the shipped renderer, which always produces an aligned buffer by construction — but reachable by anything calling `window.voicedesk.transcribe` directly, which is precisely the threat model `shared/ipc.ts`'s own comment names. **The valuable half of this finding is the second one:** `useTurn.ts:75-102`'s `.then()` chain has **no `.catch`**, so *any* `invoke()` rejection — from this cause or another — is unhandled and leaves the turn stuck in `'transcribing'` forever with no error card, because the machine already left `'recording'` and nothing calls `fail()`. *Fix: `&& b.byteLength % 4 === 0` on the refine, and — independently of that — a `.catch` on the chain that always routes to `fail()`.*
- **minor** — `src/main/ipc.ts` returns responses on three of five channels with no runtime validation on the reply leg in either direction, while `appInfo` and the `state` push are validated on both. *Raised by api-contract as **major**; **downgraded to minor by the lead** — see §7 for the reasoning.* What survives the downgrade is the actionable half: the asymmetry is undocumented, so it reads as an oversight rather than a decision. *Fix: one sentence in `shared/ipc.ts`'s doc comment saying the outbound leg is deliberately unvalidated and why, or validate all five symmetrically.*
- **nit** — `shared/ipc.ts:30-31`: `stderr` is the field name for text that in two of its three current producers never touched a process (`main/ipc.ts:28,40,50` put hand-written validation strings there). The name asserts a provenance those producers do not have, which will mislead the next person grepping logs for a real whisper crash. *Fix: rename to `detail`, or give schema-validation failures their own `TurnFailure` kind — which also serves M11.*

### 5.6 Code quality (3 minor, 4 nit)

- **minor** — `WhisperCppTranscriber.ts:102-109` (`exists`, `R_OK`) and `resolveBinary.ts:33-40` (`isExecutable`, `X_OK`) are the same `try { accessSync } catch { return false }` scaffolding twice, differing only in the mode constant. Mechanical rather than business knowledge — which is why it is minor, not major — but a future change to how "can we touch this path" is decided (say, distinguishing `ENOENT` from `EACCES` for a better hint) has to be made twice. *Fix: one `canAccessSync(path, mode)` in a narrowly-named file, not a `utils` bag — the project explicitly bans that shape.*
- **minor** — `src/main/window.ts:18`'s `BACKGROUND = { light: '#f5f3ef', dark: '#141210' }` and `src/renderer/src/index.css:8,17`'s `--bg` values are an exact duplicate, verified by grep and matching today. The duplication is **structurally unavoidable** (main paints the chrome before any document exists) and is unusually well documented as such at `window.ts:12-16`. The gap is narrower than the duplication: nothing checks the comment's "ONE place" promise. This gets sharper in S8, when the palette rebinds to design tokens and the failure mode — a flash of the wrong background on launch and on every resize — is invisible to `npm run dev` and only visible by eye. *Raised by code-quality (D5) and architecture (F6). Fix: a five-line test reading both files and asserting the two hex pairs match; delete it the day S8 generates both from one source.*
- **minor** — `.claude/hooks/machines.txt` uses the prefix `mq`, but the real parser (`branch-name-guard.py`'s `PREFIX_SHAPE = ^[a-z]{2}-$`, read as ground truth rather than from the skill's prose) requires the trailing dash. One malformed line poisons the whole file's verdict, so the guard — if ever wired — would answer `"ask"` on every branch creation rather than resolving `mq-`. Currently **inert**: this hook is not wired into the project's active `hooks.json` at all. The chosen host string does correctly match this machine's `LocalHostName`. *Fix (worth doing regardless of where the file ends up — see D4): `MacBook*Quaq*        mq-    # Quaq`, glob form, matching the canonical registry's own style.*
- **nit** — `electron.vite.config.ts:39`: `assetsInlineLimit: (filePath) => !filePath.endsWith('pcm-worklet.js')` returns `true` — *always inline* — for every non-worklet asset, rather than `undefined` (fall back to Vite's size-based default). The comment above frames the change as an exception *for the worklet*; the implementation makes "always inline" the rule. Inert today (nothing else in `src/renderer` is a bundled non-JS asset), but the moment S8 adds a font or image, the CSP's `font-src 'self'` would refuse the forced `data:` URI — the same silent, dev-invisible failure this line exists to prevent, reintroduced by its own overreach. *Fix: `(filePath) => (filePath.endsWith('pcm-worklet.js') ? false : undefined)`.*
- **nit** — `resolveBinary.ts:13-16`: a **relative** `VOICEDESK_*_BIN` override (a user setting `VOICEDESK_AGENT_BIN=claude` expecting shell-style PATH lookup) is resolved by `accessSync` against `process.cwd()`, so it silently reports the generic "not found" even when the binary is correctly installed. The documented contract is "absolute path" and this fails closed with an actionable-if-generic message, which is why it is only a nit.
- **nit** — `src/main/composition-root.ts:68`: the **voice** stub tags its failure `what: 'agent-cli'`. Harmless while both stubs are temporary, but it would surface if either outlives the other or the UI ever special-cases that tag.
- **nit** — Three small items clustered: `src/infrastructure/transcribe/wav.ts`'s doc-comment (and `docs/PLAN.md` §6) describe "a 44-byte WAV header" without noting that this holds only for files this encoder writes — a caveat `test/whisper-transcriber.test.ts:27-29` had to learn expensively when macOS `say`'s output turned out to carry `JUNK` and `FLLR` chunks before `fmt `; two uncommented `as` casts survive where `ts-type-discipline` asks for a one-line reason (`useTurn.ts:152-155`'s `as ArrayBuffer`, `recorder.ts:143`'s `as DOMException | undefined` — neither can crash, both safely narrowed, which is why they are not escalated); and `src/main/index.ts:42-83` nests the whole ~40-line bootstrap in the `else` of one top-level `if`, where a `function main()` with an early return after `app.quit()` would read as a guard clause. *(`recorder.ts:156`'s `'microphone' as PermissionName` is lib-forced boilerplate and correctly not flagged.)*

### 5.7 Performance (4 nit, all measured)

The performance lens benchmarked rather than estimated, and its headline result is that **nothing
in this pipeline is worth optimising**: real `whisper-cli` with the project's own `encodeWav` bytes
and the adapter's exact flags took **0.89 s** on a 130 s clip (99% of the 16 kHz byte cap) and
0.24 s on a 3 s clip, so every copy and allocation below is under 0.5% of one turn's latency.

- **nit** — `src/renderer/src/useTurn.ts:152-155`: `toArrayBuffer` `.slice()`s a buffer that is always already exactly the bytes being sent (`concat()` always returns a fresh `Float32Array` at offset 0), duplicating the whole recording for nothing. Measured **0.377 ms** at the cap vs **0.0001 ms** for `samples.buffer` directly. A free win, not a necessity.
- **nit** — `src/renderer/src/audio/pcm-worklet.js:28-44`: the per-sample copy loop measures 67.5 ns/call vs 17.5 ns for `buffer.set(...)` — 3.9× in relative terms, but **0.0025% of the 2.667 ms real-time budget** at 48 kHz, so there is no glitch or underrun risk at any supported rate. Separately, `emit()`'s `postMessage` passes no transfer list, though the sliced buffer has exactly one owner and one reader and is a textbook transferable — 4–12 clones/second of ~16 KB, free to eliminate.
- **nit** — `src/infrastructure/transcribe/wav.ts:36-41`: `DataView.setInt16` per sample measures 2.59 ms at the cap boundary and 0.11 ms for a typical 5 s hold; an `Int16Array` view is 12–15% faster. The lens states plainly it expected this to be worse before measuring — V8 JITs monomorphic little-endian `DataView` writes well.
- **nit** — `src/renderer/src/useTurn.ts:109-118`: `setLevel` from a `requestAnimationFrame` loop re-renders the **whole `App` tree** 60–120×/sec while recording (rAF runs at native refresh, so this is 2–4× the "30 fps" the design assumes, and nothing is `React.memo`'d) even though `LevelMeter` is the only consumer. Two things the lens corrected while checking: `meterBuffer` **is** a reused field, not a per-frame allocation (RMS sweep measures 5.2 µs/call), and the rAF loop's lifecycle is **correct** — `cancelAnimationFrame` on cleanup always cancels the live frame, and it does not keep running after the hold. Magnitude today is negligible at ~two dozen DOM nodes (the lens labels this specific number an estimate, not a measurement, and says so). Worth a line only because S8 lands fifteen artboards into that tree, and isolating the meter is much cheaper now than retrofitting it after.

---

## 6. ALREADY FIXED — verified against the current tree, not repeated above

Three commits landed after the panel started. Each was verified by the lead by reading the file,
not taken on the report's word. Findings they resolve are recorded here and **excluded** from §3
and §5.

| What | Verified where | Status |
|---|---|---|
| **`stateLabel` took `string` with a fallback `default`.** A `string` parameter makes the `never` guard unreachable, so adding a turn state would compile and quietly render the wrong label. | `src/renderer/src/App.tsx:60` now reads `function stateLabel(k: TurnState['k'])`, with a doc-comment naming exactly this failure, and a `const unhandled: never = k` guard at `:74-77`. The lead confirmed all four switches over a tagged union carry the guard: `App.tsx:74` (`stateLabel`), `App.tsx:140` (`describe`), `talkControl.ts:25`, and `turn.ts`'s own. | **Fixed** |
| **`composite: true` let `tsc --noEmit` answer from a stale `.tsbuildinfo`** and report clean over a tree that did not compile — masking a real type error (`apply({ t: 'replied', spoken: false })`, a field that exists nowhere in the `TurnEvent` union) for at least one commit. The test-quality lens found this independently, in parallel with the fix landing, and it is the single strongest data point in the whole panel: a real instance of "this gate cannot fail," caught in production use of the gate rather than by inspection. | Neither `tsconfig.node.json` nor `tsconfig.web.json` contains `composite` or `incremental` (read in full by the lead). `src/renderer/src/useTurn.ts:101` reads `apply({ t: 'replied', speech: 'not-requested' })`. The architecture lens independently re-checked and rejected the `spoken: false` claim against the fixed file. The gate was re-proven on a reintroduced known defect. | **Fixed** — *residual risk carried forward as a minor in §5.2: nothing stops `composite` being added back.* |
| **`test/renderer-build.test.ts` crashed with ENOENT on any unbuilt checkout.** `describe.skipIf` does not prevent Vitest running the suite body to collect tests, so the eager `readdirSync` threw and the whole file failed on a clean clone — and on a machine where the skip *did* engage, this project's only regression gate for the "worklet inlined as `data:`, invisible in dev, fatal in a build" defect was silently dark. | `test/renderer-build.test.ts` no longer skips at all; its doc-comment (`:15-18`) records exactly why `skipIf` was the wrong tool; the first test asserts the scan is non-empty before the other two trust it (`:21-26`); and `package.json:21` now reads `"test": "electron-vite build && vitest run"`. Reported verified passing on a clean unbuilt checkout: 31 tests, 7 files. | **Fixed** — *but see **M3**: the build half landed and the typecheck half did not, because the script calls `electron-vite build` rather than `npm run build`.* |

---

## 7. Where a reviewer's claim did not survive the lead's check

Recorded rather than laundered, per the brief.

1. **`src/main/ipc.ts` as a blocker (test-quality).** Downgraded to **major** (M15). The
   test-quality lens rated "S4's acceptance criterion has zero automated check" a blocker. But the
   security lens independently verified, line by line, that the validation is **present and correct
   today** (`ipc.ts:25-63` — all three inbound handlers `safeParse` before touching a port, bounds
   adequate), and the lead re-read the file to confirm. What is at risk is a future regression, not
   a present defect. A blocker is something that is broken now; a missing gate over correct code is
   a major. The item keeps its place at the top of the gate cluster, and M14 (`window.ts`'s
   security flags) is the higher-value member of that family anyway.

2. **Outbound reply-leg validation as a major (api-contract F3).** Downgraded to **minor**
   (§5.5). The lens's concrete scenario is version skew between independently-built processes,
   demonstrated through `electron-vite dev`'s HMR, where the renderer picks up a `shared/ipc.ts`
   change before main restarts. That premise does not hold for the shipped artifact: `electron-vite
   build` produces all three outputs from one source tree, packaged together, with no independent
   deployment — so there is no production path on which main and renderer can disagree about a
   shape. The dev-time confusion is real but is a developer-experience cost, not silent data
   corruption in a user's hands. The actionable residue — that the asymmetry is undocumented and
   reads as an oversight — is kept.

3. **"`endHold`'s only guard is `stateRef.current.k !== 'recording'`" (correctness B1).** The code
   at `useTurn.ts:72` actually reads `if (mic === null || stateRef.current.k !== 'recording')
   return` — there is a null guard too. **The finding stands unchanged**: `recorder.current` is
   assigned synchronously at `:58`, *before* the await, so during the pending window `mic` is
   non-null and the state guard is what fires. The report's phrasing understates the code without
   affecting the conclusion.

4. **Test-quality's major count of 9.** Its own summary says "8 distinct major items above;
   counted as 9 to include F0's residual-risk sub-finding." The lead counts that residual risk
   (nothing stops `composite` coming back) as a **minor** in its own right — it is a
   missing-guard-against-a-fixed-bug, not a peer of the eight — so the consolidated arithmetic
   differs from that lens's by one.

5. **The 8 MB cap, "confirmed clean" vs "major" — a genuine inter-lens conflict.** The security
   lens lists the bound in its *Confirmed clean* section as "comfortably past any real
   push-to-talk hold," while the api-contract and performance lenses both rate it **major**.
   Notably, the security lens's own sentence contains the number that undercuts it ("~44 s at
   48 kHz"). **Resolved for the api-contract/performance reading (M11).** The security lens is
   right about the question it was asking — the bound is adequate as a *denial-of-service* limit
   and keeps absurd values out of `encodeWav`'s header math — and the two other lenses are right
   about a different question: the bound is a byte count that the schema's own comment presents to
   the reader as a time, it moves by a factor of twelve across hardware the plan explicitly
   promises to support, and the rejection copy names the wrong cause. Both readings are correct;
   the defect is the second one.

6. **Two claims the architecture lens checked and rejected before reporting, correctly.** It
   verified `useTurn.ts` no longer contains `spoken: false` by grepping the file on disk, and it
   verified the `package-lock.json` name mismatch does not break `npm ci` by actually running it
   (exit 0, 168 packages), downgrading a suspected blocker to a nit. Recorded here so the next
   reviewer does not repeat either trip.

---

## 8. What the panel confirmed as GOOD

A report that lists only defects misrepresents the work. Every item below was *checked*, not
assumed — by grep, by reading every file, by mentally inverting the production logic a test
guards, or by running the thing.

**Security posture (the security lens returned zero blockers and zero majors).**

- `src/main/window.ts:41-46` — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, all three written out explicitly rather than inherited. `will-navigate` denies any URL but the page's own (`:69-71`).
- CSP is registered on `session.defaultSession` via `onHeadersReceived` **before** `createWindow()`/`loadRenderer()` run, so there is no window in which the page loads uncovered. No `unsafe-eval` in either mode. Prod `connect-src 'self'` means even a compromised renderer cannot exfiltrate over the network. `object-src`, `base-uri`, `frame-ancestors`, `form-action` all `'none'`.
- The preload bridge is exactly the five named methods; `ipcRenderer` is never exposed; no method takes a caller-supplied channel name; every call uses a hardcoded `CH.*` constant. Verified by grep by two lenses independently — `ipcRenderer`/`ipcMain`/`contextBridge` appear only in `main/ipc.ts` and `preload/index.ts`.
- `execFile` with a fixed argv array and **no shell**. The dictated audio never becomes a string argument — it is written to a WAV and referenced by path, so there is no argv position where speech content could change the command's meaning. The same discipline `docs/PLAN.md` §5.1 mandates for the agent CLI, applied to the one external program that actually ships this iteration.
- `mkdtemp` per turn with an unpredictable name, and `rm(workDir, {recursive: true, force: true})` in a `finally` that covers success, parse failure, execFile failure, timeout and abort alike — verified on every exit path.
- No secrets anywhere: a repo-wide grep for keys, tokens, passwords and Keychain access across `src/`, `shared/`, `test/` returned nothing. The only external text reaching the UI is whisper's own truncated 500-char last line.
- **The microphone is released on every exit path *inside* `MicrophoneRecorder` itself** — `stop()`, the mid-setup catch in `start()`, and the `window` `blur` listener. B1 is a defect in the orchestration *above* the class, not in the class, whose own invariant holds.

**Architecture and craft.**

- Exactly one composition root — `new WhisperCppTranscriber` appears exactly once in `src/`, at `composition-root.ts:51`, confirmed by grep, not assumed.
- IPC handlers are genuinely thin adapters: unwrap → `safeParse` → call the port → wrap. No business rule lives in `ipc.ts`.
- `src/domain/**` imports nothing platform-shaped — every file read, not sampled — and the rule is gated by a test the commit history shows was *watched to redden* on a deliberate violation before being trusted. That gate also asserts its own glob is non-empty, guarding the classic silent pass.
- Port/adapter naming discipline holds: ports named for roles (`Transcriber`/`AgentRunner`/`SpeechSynthesizer`), adapters for technologies (`WhisperCppTranscriber`).
- **Every** discriminated union in the batch — `TurnState`, `TurnFailure`, `Outcome`, `TalkControl`, `FailureCategory`, `SpeechOutcome`, `MicDenial` — is switched exhaustively with a `never` guard. Every switch site was checked.
- The five `minimize-boolean-state` migrations are complete and consistent, each with at least one direct test, none regressed downstream: `ok: boolean` → `k` tag; `recording`+`busy` → `TalkControl`; `permanent: boolean` → `MicDenial`; `spoken: boolean` → `SpeechOutcome`; `yours` → `FailureCategory`. A deliberate hunt for **new** instances (accumulator patterns, every `: boolean` field/param/return) found none — the remaining booleans are config, predicates, or a single fact from Node's own error shape.
- No `TODO`/`FIXME`/`HACK`, no commented-out code, no `console.log`/`debugger` anywhere in the batch.
- `shared/ipc.ts` sitting outside `src/` is correct, not a boundary violation — §3 places it there deliberately because it compiles into three separately-rooted outputs.
- The `export const X = z.object(…); export type X = z.infer<typeof X>` pattern is sound and used consistently.
- The `Outcome` tagged-union migration is complete: a repo-wide grep for the old boolean shape returns nothing but one comment explaining why it was replaced. Domain, adapters, IPC layer and renderer all discriminate uniformly.

**Tests that are not decorative.** Four suites were checked by mentally inverting the production
logic they guard, test by test, and each would fail:

- `turn-machine.test.ts` pins `MIN_HOLD_MS` on **both** sides (`-1` → idle, exactly → transcribing), catching a `<`/`<=` mutation; the key-repeat and busy-refusal tests assert **referential** equality (`toBe`), which is strictly stronger — it also catches a mutation returning a new object of the same shape.
- `wav.test.ts` pins every header field exactly and the clamp boundary at ±32767 — and a hardcoded sample rate is a regression this project has hit before.
- `talk-control.web.test.ts`'s four tests jointly cover all six `TurnState.k` values with exact-set assertions; there is no state left for a mutation to hide in.
- `run-voice-turn.test.ts` tests real behavioural guarantees rather than restated implementation — call ordering (transcript shown before the agent is asked), short-circuiting on both transcriber and agent failure without spending the next call, and the documented "a voice that will not start must not throw away an already-successful reply" decision. Its `ports()` fakes are **legitimate second implementations** of the real port interfaces using the real `Outcome`/`failed`/`succeeded` helpers — the shared-contract pattern `production-config-under-test` asks for, not test-only duplication.
- The tsconfig split was verified with `tsc --listFilesOnly` to be **exhaustive and non-overlapping** for all seven current test files — each is type-checked by exactly one config.
- The suite is fast (1.3 s) and deterministic with nothing skipped.

**Conventions.**

- `commit-messages` fully respected across all 12 commits, verified mechanically rather than by eye: every bullet starts `* `, zero sentence-case openers, zero trailing periods, zero conventional-commit prefixes, all English. The only capitalised tokens in the twelve bodies are `JUNK`/`FLLR` — literal RIFF chunk IDs, correctly left cased.
- `code-documentation` rules 1 and 2 fully respected: no non-English content anywhere in `src/`, `shared/`, `test/`; `shared/ipc.ts`, `src/domain/ports/*` and `runVoiceTurn.ts` carry JSDoc on every exported type and field that needs one, each explaining *why* rather than restating the signature.
- `cut-gates-name-their-cost` is respected and is a **strong example of the rule**: both `docs/PLAN.md` §12/§13 and README's "What works · what was cut" name, in one sentence each, exactly which class of defect now runs with no gate — the global-hotkey cut in particular ("*a hold started while another app is focused does nothing, and nothing detects that regression except using the app*") is a model application.
- `interface-oriented-boundaries` and `ts-layer-boundaries` respected; no `utils/`, no root `types/`; `shared/` holds one file, genuinely imported by all three build outputs.
- `anti-hallucination`: the README's ✅/◻︎ marks read as honest and, if anything, **conservative** — steps the app was self-evidently exercised on during development are still marked unverified, matching WORK-BREAKDOWN's careful `BUILT (awaiting acceptance)` vs `DONE (accepted)` distinction. No `✅` was found contradicted by other evidence in the repo.
- Design-vs-app version separation handled correctly: `DESIGN-BRIEF.md` repeatedly warns not to confuse the canvas's own `0.3.1` with the app's SemVer, and calls conflating them "a defect, not a shortcut" — exactly the two-counter trap `versioning` warns about, avoided.
- The architecture PDF's dated → stable rename (`daafa7b`) was adjudicated **legitimate**: it is a mechanical re-render of two living documents, re-rendered on nearly every commit that touches them, and the org's own `structure-map` precedent re-renders such maps in place under stable names.

**Measurement instead of assumption.** The performance lens ran six microbenchmarks and the real
`whisper-cli`, and reported the results honestly including where they contradicted its own
expectation. Three specific "this is probably a problem" premises were *disproved* by measurement:
`new Float32Array(pcm)` in `main/ipc.ts:33` is a **view, not a copy** (easy to get wrong —
`Float32Array.from` would have copied); the `accessSync` startup sweep costs 0.12–0.14 ms across
36 candidates; and the worklet message rate is ~4/s at 16 kHz, not the "125×/s" the brief assumed
(that is the sample-copy rate — the batching is doing exactly its job). The 60 s transcription
timeout has ~67× headroom at the byte-cap boundary.

---

## 9. Top five next actions, in order

1. **B1 + M10 together** — `useTurn.ts`'s `beginHold` continuation: check `recorder.current !== mic` before applying `hold-started`, and unify the two clocks that decide the 250 ms gate. Same file, same root cause (nothing owns what happens after the await), one change.
2. **B2** — `test/useTurn.web.test.ts` covering the happy path and both race variants, with `environmentMatchGlobs` wired in `vitest.config.ts`. This is the gate for the file that has both the blocker and a demonstrated history of undetected regressions.
3. **M14** — `test/window.test.ts` asserting the three `webPreferences` flags and the deny-by-default window-open handler. Ten lines of mock; guards the lines the plan itself says separate an XSS bug from remote code execution.
4. **M3, M1, M2, M4** — four one-line fixes worth doing in a single pass: `npm test` → `npm run build && vitest run`; PLAN's Vite row → `7.x`; the `docs:pdf` rename stem; and `useTurn.ts` importing the domain's `isEmpty`.
5. **Put D1–D5 in front of the owner** before iteration 2 opens. Two of them (D2's versioning cadence, D5's renderer import boundary) block work that iteration 2 will otherwise do twice.

---

## 10. Per-lens coverage and blind spots

| Lens | Ran | Found | Blind spot to be aware of |
|---|---|---|---|
| correctness | yes, with mechanical reproduction of three findings against the real `nextTurnState` and the real `classify()` | 1 blocker, 3 major, 1 minor, 2 nit | Read the tree at `79aaffd`; the fixes in §6 landed after. Did not cover the stub agent/voice ports or the S8 shell (out of scope). |
| test-quality | yes, ran `npm test` and a cleared-cache `npm run typecheck`; disclosed that the tree moved beneath it | 2 blocker (1 downgraded here), 9 major (8 here), 4 minor, 2 nit | Its own severity summary inflates the major count by one; see §7.4. |
| conventions | yes, read the real `branch-name-guard.py` parser as ground truth rather than the skill's prose | 6 major (1 moved to decisions here), 4 minor | Could only read `.claude/CLAUDE.md` because it ran on the author's own machine — on a fresh clone that file does not exist, which is itself finding D4. |
| code-quality | yes, read every source file in full, not just diff hunks; ran a deliberate clone scan and a deliberate boolean-state hunt | 4 major, 5 minor, 5 nit | Explicitly did **not** execute its TypeScript-assignability reasoning for M12 and said so; the lead confirmed the uncovered half independently. |
| api-contract | yes; seated despite the project having no HTTP/library surface, for two reasons that both produced findings | 3 major (1 downgraded here), 3 minor, 3 nit | Its version-skew premise (F3) does not hold for a single-build packaged app; see §7.2. |
| architecture | yes; ran `npm ci`, `npm run typecheck` and `npm test` for real, and rejected two suspected defects on the strength of it | 1 major, 6 minor, 2 nit | Read the tree after `38454b8`, so its line numbers are the freshest of the eight. |
| performance | yes; six microbenchmarks plus real `whisper-cli` timing, with estimates explicitly labelled as estimates | 1 major, 4 nit | One number (the React reconcile cost in §5.7) is an estimate rather than a profiled measurement, and the lens says so. |
| security | yes; verified every finding against `git show 79aaffd:<path>` rather than the mutating working tree | 0 blocker, 0 major, 4 minor, 2 nit | Packaging, signing, notarisation, Electron fuses and `asar` integrity are all absent from this batch and were correctly not treated as findings — they belong to the packaging work recorded as future work. |

---

## 11. Consolidated counts, after deduplication

| Severity | Count |
|---|---|
| blocker | **2** |
| major | **18** |
| minor | **23** |
| nit | **18** |
| decisions for the human | **5** |
| already fixed (excluded from the above) | **3** |

These counts describe **the batch as reviewed**. Fixes that landed while this report was being
written (§1 addendum) close M8 and two nits, which would make the live figures 2 blockers,
17 majors, 23 minors, 16 nits — but the tables are left as the record of what the panel found.

Raw panel total before dedup and adjudication: 3 blockers, 28 majors, 26 minors, 16 nits across
eight reports. The reductions come from six merges where independent lenses reached the same claim
(the strongest being `classify()`'s ENOENT conflation at three lenses, and the 8 MB cap at two),
two severity downgrades with the reasoning stated in §7, one major moved into the decisions
section because it is a rule conflict rather than a defect, and three items removed as already
fixed.
