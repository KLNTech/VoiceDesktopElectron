# VoiceDeskElectron — work breakdown

The build, decomposed before any of it is written. Each subtask carries a scope, an acceptance
criterion **quoted from the client brief** (not "tests are green"), a complexity rating 1–10 that
decides how much review it gets, and a parallelism label.

Status values: `PLANNED` · `IN PROGRESS` · `BLOCKED` · `BUILT (awaiting acceptance)` · `DONE
(accepted)`. `BUILT` means the code exists and its own checks pass; it becomes `DONE` only when a
reviewer has checked it against the acceptance criterion above it, which for this build is the
iteration's pull request. Nothing is reported
done until its acceptance criterion has been checked against the brief — and the umbrella is
done only when every subtask is, not when most of them are.

---

## Branching, and a deliberate deviation

The usual rule here is one branch per subtask, squash-merged. **The squash is the part this
build drops**, because the brief grades the commit history itself:

> *"Don't clean up the history. Real commits as you go, not one squash at the end."*

A squash merge is exactly the cleanup that sentence forbids. So each iteration is built on its
own branch and merged by a pull request **without squashing**: every commit made along the way
arrives on `main` as it was written, and the client also gets a reviewable PR per iteration —
which committing straight to `main`, the earlier reading of the same rule, would not have given
them. The trade is identical either way: `main` carries intermediate states; that is the
point.

---

## Dependency shape

```
S1 toolchain + window ─┬─► S4 IPC contract ─┬─► S5 capture ──┬─► S8 UI  ──► S11 README
                       │                    │                │
S3 domain (parallel) ──┘                    ├─► S6 whisper ──┤
                                            ├─► S7 agent CLI ┤
S2 arch gate (parallel with S3)             └─► S10 smoke ───┘
                                                              S9 TTS (last)
```

---

## Iterations

The build is not one run. What the current iteration contains is stated here, so "not done yet"
and "not in scope yet" never look the same from the outside.

| iteration | subtasks | what exists at the end of it |
|---|---|---|
| 1 — merged | **S1 → S6** | the app opens, records while you hold, shows a level meter, and turns your speech into text on screen. It does **not** reach the agent yet |
| **2 — current** | **S7 → S11** | the transcript reaches `claude -p`, edits `notes/`, and the reply comes back; the approved design is implemented; the reply is spoken; one real launch guards the seam; the README is closed out |

**Iterations 2 and 3 were merged into one, by the owner's decision, at the start of this run.**
The table above originally split them. Recording the change rather than quietly rewriting the
plan: the trade is a larger PR against a shorter path to a working product, and the owner took
it knowingly. Everything else about the branching rule is unchanged — one branch, real commits
as they were written, a merge commit and never a squash.

S8 was `BLOCKED` on the design canvas being filled in and approved — the UI is implemented
against an approved design, not sketched twice. It is unblocked: the canvas exists at design
`0.3.1`, was read directly during this iteration, and S8 was built against it.

Iteration 1 deliberately stopped **before** the agent adapter. Speech-to-text on screen is a
complete, demonstrable thing on its own, and it is the half that carries the hardware, the
permissions and the process boundaries — the half worth reviewing before anything is layered on
top of it.

---

## Subtasks

### S1 — toolchain and a window that opens
Scope: stand up Node 26 / TypeScript strict / electron-vite with three build outputs, and a
single `BrowserWindow` that opens with the three security switches written explicitly and a
version badge reading `package.json`.

- **Acceptance:** *"It runs on a clean machine following your README"* — `npm ci && npm run dev`
  on a machine that has never seen this repo opens a window showing the version from
  `package.json` followed by ` · dev` — the number itself lives in one place and is not
  restated here, so a bump cannot make this criterion false.
- **Complexity:** 5 · **Parallelism:** SEQUENTIAL (root) · **Status:** BUILT (awaiting acceptance)

### S2 — the architecture gate
Scope: Vitest, plus the ~15-line test that fails when `domain/` imports the platform, proven by
breaking it once.

- **Acceptance:** the gate has been *seen* to redden on a deliberate violation, and asserts it
  scanned a non-empty file list.
- **Complexity:** 3 · **Parallelism:** PARALLEL (with S3) · **Status:** BUILT (awaiting acceptance)

### S3 — the domain
Scope: `TurnState`, `TurnFailure`, the three ports, and `runVoiceTurn` as a function taking
ports as arguments. Unit tests for the turn machine, including the 250 ms rule and the
"key repeat is ignored" rule.

- **Acceptance:** the whole flow *audio → transcript → reply* is expressible and testable with
  no Electron, no binaries and no network.
- **Complexity:** 5 · **Parallelism:** PARALLEL (needs nothing from S1) · **Status:** BUILT (awaiting acceptance)

### S4 — the IPC contract
Scope: `shared/ipc.ts` (channel names + zod schemas, one declaration), the preload bridge with
one named method per message, and main handlers that unwrap → call the use case → wrap. Errors
cross as typed data.

- **Acceptance:** the renderer can reach exactly the five declared messages and nothing else;
  `ipcRenderer` is not exposed and no bridge function takes a caller-supplied channel name.
- **Complexity:** 6 · **Parallelism:** SEQUENTIAL (after S1, S3) · **Status:** BUILT (awaiting acceptance)

### S5 — push-to-talk capture
Scope: hold-to-talk on the button and on `Space`; `getUserMedia` on first hold; `AudioContext`
at 16 kHz; an `AudioWorklet` producing mono Float32; a live level meter; all four hold-ending
events; microphone permission handled as three distinct outcomes.

- **Acceptance:** *"Hold a key or button, speak, release → your words appear as text in the
  window."*
- **Complexity:** 7 · **Parallelism:** SEQUENTIAL (after S4) · **Status:** BUILT (awaiting acceptance)

### S6 — the transcription adapter
Scope: `WhisperCppTranscriber` over `execFile`, the pure Float32 → 16-bit PCM WAV encoder,
binary + model resolution that survives a Finder-launched app's minimal `PATH`, and the
`ENOENT` → *setup failure* mapping.

- **Acceptance:** speech becomes text with no API key, no account and no network; a missing
  binary or model says which one and how to install it.
- **Complexity:** 6 · **Parallelism:** PARALLEL (with S5, S7) · **Status:** BUILT (awaiting acceptance)

### S7 — the agent CLI adapter
Scope: `ClaudeCliAgentRunner` and nothing else — **`claude -p` only**. Argv array via
`execFile` with no shell, the full flag set from `docs/PLAN.md` §5.2, zod-parsed JSON reply,
session continuity carried explicitly, timeout that kills, and the outcome mapping of §5.6.
Two choices inside it carry their own reasons: the model is pinned to `--model haiku` — the
cheapest current tier, by alias so it can never resolve to an Opus-tier model — with
`VOICEDESK_AGENT_MODEL` (default `haiku`) as the deliberate opt-in for anything stronger; and
authentication is the CLI's own macOS Keychain login, so no API key is passed or read and a
keychain preflight turns *"never signed in"* into a distinct **setup** failure. No second CLI
adapter is written; the port already makes one cheap when it is wanted.

- **Acceptance:** *"add milk to my shopping list"* creates or edits `notes/shopping.md`, and
  *"what's on my list?"* answers from it — through the CLI, not the raw API, with the agent's
  blast radius bounded to `notes/`. Two further checks, both answerable without reading the
  code: the reply envelope's `modelUsage` names a Haiku model, so the cheap tier is proved by
  the reply rather than assumed; and on a machine that has never signed in, the app says *"run
  `claude` in a terminal and log in"* instead of reporting an agent failure.
- **Complexity:** 7 · **Parallelism:** PARALLEL (with S5, S6) · **Status:** BUILT (awaiting acceptance) — the acceptance criterion is executed against the real CLI in `test/claude-cli-agent.test.ts`, including the two further checks: the reply's `modelUsage` names a Haiku model, and a machine with no keychain login gets its own setup failure

### S8 — the interface
Scope: implement the approved design — the eight states, the talk control with its meter, the
four failure screens, the about/credits sheet, and every string through `t()` against the one
locale that ships (English). No second locale, no switcher — see `docs/PLAN.md` §10.

- **Acceptance:** *"UI: generate it with Claude Design … it looks intentional and is usable"*,
  and each artboard state is recognisable in the running app.
- **Complexity:** 7 · **Parallelism:** SEQUENTIAL (after S5) · **Status:** BUILT (awaiting
  acceptance) — **unblocked by reading the canvas.** The design project was reachable after all:
  `Voice Desktop.dc.html` at design `0.3.1` was read directly, which settled every item
  `docs/design/DESIGN-BRIEF.md` §12 had listed as unverifiable — the fifteen artboard names, the
  error-code mapping, the copy, the absence of an `empty-speech` board, and the fact that the
  canvas states no minimum window size.

### S9 — spoken reply *(stretch)*
Scope: `MacSaySynthesizer` behind the port, plus the control that triggers it.

- **Acceptance:** *"Stretch, only if you're inside the budget: the reply is spoken back."*
- **Complexity:** 3 · **Parallelism:** PARALLEL (last) · **Status:** BUILT (awaiting acceptance)
  — it stayed as cheap as promised: `MacSaySynthesizer` behind the port, one `Speak reply`
  control on the reply, no new dependency. A voice that will not start withdraws the control
  rather than failing the turn, which is what `SpeechOutcome`'s third value exists for.

### S10 — the one end-to-end
Scope: a single real Electron launch that starts the app shell, asserts the preload bridge
exists, and puts one round trip across the real IPC seam.

**Built as `test/preload-bridge.test.ts` plus `test/fixtures/bridge-probe.cjs`, not with
Playwright.** The launch already existed for S4 and does the three things only a launched app
can show: a sandboxed preload has no module resolver, so a preload that typechecks and bundles
can still fail at load and leave `window.voicedesk` undefined; the Content-Security-Policy is a
header and so exists only when something serves it; and the seam itself is renderer → preload →
`ipcMain.handle` → back. Adding Playwright would have bought a second launcher for a launch this
repository already performs.

**What that cut stops catching**, recorded rather than left implied: nothing drives the UI as a
user does. There is no test that presses the talk control, holds `Space`, or reads what the
window renders, so a control wired to the wrong handler, a state that renders the wrong pane, or
a button that is disabled when it should not be will not redden anything. The seam is gated; the
interaction is not.

- **Acceptance:** something in this project executes in the renderer, so a CSP or preload-wiring
  defect has a gate in front of it.
- **Complexity:** 4 · **Parallelism:** SEQUENTIAL (after S4, S5) · **Status:** BUILT (awaiting
  acceptance) — **and delivered without Playwright**, which is a cut that names its own cost
  below.

### S11 — the README
Scope: install from zero on a Mac that has nothing; run; what works; what was cut and what that
stops catching; how long it actually took; and the full third-party licence list with names and
versions, which is also the data behind the about panel.

- **Acceptance:** *"It runs on a clean machine following your README"* and *"A README that tells
  the truth"*.
- **Complexity:** 4 · **Parallelism:** SEQUENTIAL (written incrementally from S1 onward, closed
  last) · **Status:** BUILT (awaiting acceptance)

---

## How each subtask is run

Complexity decides the shape of the loop, not the mood:

| rating | loop |
|---|---|
| < 2 | done in the main thread, no ceremony |
| 2–6 | develop → test → review, one reviewer |
| ≥ 7 | develop → test → review, then a panel of independent critics before acceptance |

S5, S7 and S8 are the three that earn the panel. S4 and S6 sit just under it and get a full
single review. Nothing is marked done on a green test alone — the gate is the acceptance
criterion above it, checked against the brief.

---

## Answered before the build started

1. **Default Whisper model** — `base.en` (~150 MB). Fast first run beats accuracy on a
   criterion that is literally "it runs on a clean machine following your README".
   `large-v3-turbo` stays one environment variable away.
2. **Spoken reply (S9)** — in scope, via the macOS `say` binary.
3. **Packaging** — not in this delivery. `npm run dev` is the whole promise, and the cost of
   that cut is written into `docs/PLAN.md` §13 rather than left implied.

---

## Future work — not in this delivery

Recorded so the absence is a decision rather than an oversight. None of it is started, none of
it is promised, and the README does not claim any of it.

| # | item | why it is not now |
|---|---|---|
| F1 | **Packaged build** — `electron-builder` producing `.app` and `.dmg`, with `NSMicrophoneUsageDescription` in `Info.plist` | the delivery is a dev build; nothing in the repo exercises a packaged artifact today |
| F2 | **Code signing, notarisation, stapling** | needs a paid Apple Developer account and certificates on the build machine — an external dependency, not an engineering decision |
| F3 | **CI on GitHub Actions** — typecheck, lint, the unit suite, the architecture gate and the real Electron launches on every push, on a macOS runner because `package.json` declares `"os": ["darwin"]` and three of the adapters are macOS-only | the gates exist and run locally; wiring them to a runner is a day's work that buys nothing until more than one person commits. GitHub Actions specifically, because it is what the rest of the tooling around this project already speaks |
| F4 | **CD** — tagged release publishing the signed artifact | strictly after F1–F3; a release pipeline without a signed artifact publishes something nobody can open |
| F5 | **Auto-update** | only meaningful once F4 exists |
| F6 | **Second agent adapter** (`codex exec`, `cursor-agent -p`) | the port exists from day one, so this is an adapter and a line in the composition root — cheap later, wasted now |
| F7 | **Second language** | the lookup table and `t()` ship in this build; a locale is a JSON file and a switch |
| F8 | **Global hold-to-talk** while another app is focused | needs a native keyboard hook rebuilt per Electron version plus an Accessibility permission — see `docs/PLAN.md` §12 |
| F9 | **Running the agent on a larger model tier** | not an omission: `haiku` is the default on purpose because this is a demonstration build and an expensive tier must not be reachable by accident. `VOICEDESK_AGENT_MODEL` is now a three-value enumeration — `haiku`, `sonnet`, `opus` — so an operator opts in **deliberately and by name**, and a typo is refused with a setup failure listing the legal values rather than silently substituting the default. Nothing in this delivery raises the tier by itself, and no quality claim is made for one that does; `haiku` is the only tier this build has been exercised on |
| F10 | **Whisper inside the app** — the `whisper-cli` binary, its libraries and a model shipped with the build, so the install is one step instead of four | the delivery is a dev build, and vendoring a binary is a packaging decision that belongs after F1. Measured on the development machine: `whisper-cli` is 643 KB and its libraries about 1.1 MB, and the `base.en` model is **141 MB** — so ~143 MB, effectively all of it the model. The size is therefore a model choice, not an engine one, and `tiny.en` would trade accuracy for about 100 MB of it. The size increase is accepted on purpose: a user who has to install four things has four chances to give up before the app does anything |
| F11 | **Choose the notes folder from the app** — a directory picker writing what `VOICEDESK_NOTES_DIR` sets today | an environment variable is enough for one operator on one machine and nothing else; it needs a settings surface, which this build does not have |
| F12 | **A notes list you can use** — click a row to open the file, delete a row | the panel was specified as a *readout* of what the agent touched (`docs/design/DESIGN-BRIEF.md` §5), so nothing in it is interactive. Making a row clickable is small; making one deletable needs a confirmation, an undo or both, because it destroys the user's own writing |
| F13 | **One conversation per note** — the agent dialogue attached to the note it is about, and itself deletable, instead of one session for the whole app | `sessionId` is carried as a single value in `useTurn`, which is the right shape for one conversation and the wrong shape for many. This is a data-model change, not a UI one |
| F14 | **The agent may delete a Markdown file** | `NotesFolder` exposes reading and listing; deletion is the one file operation deliberately absent, because an agent that can delete on a misheard sentence is a different risk class from one that can only add. It needs the confirmation story from F12 first |
| F15 | **Rename a note** | the name comes from whatever the agent chose on the first sentence, and there is no way to change it afterwards |
| F16 | **Sign in as any account**, instead of inheriting whichever account Claude Code is logged into on this machine — and, with it, a deliberate way to **clear the conversation context** | the app authenticates by *not* authenticating: it checks that Claude Code's own keychain entry exists and never reads it (`README.md` → Requirements). That is the cheapest correct thing for a demonstration build and the wrong thing for a product, because the user cannot choose the account and cannot start over |
| F17 | **A UI happy-path gate that runs after the merge** — drives the window through one whole turn and reports, rather than standing in front of the merge | this is the coverage the Playwright cut gave up, named in the cut table above: nothing drives the UI as a user does. Putting it *after* the domain gate rather than in front of it is the point — a flaky browser check that can block a merge gets disabled within a month, and one that only reports does not |
| F18 | **The microphone permission belongs to "Electron"** — System Settings shows Electron's name and icon, not the app's, and every Electron app on the machine shares that one switch | an unpackaged development build has no bundle identifier of its own, so it *is* Electron as far as macOS is concerned. Fixed by F1 and F2 and by nothing short of them |
| F19 | **A missing microphone permission can surface as *"Setup is incomplete"*** with a filesystem path in the body | reported from use and not reproduced here, because this machine has the permission granted. `setup` is the board for things that are not installed, and its body is the failing adapter's hint verbatim — two of which quote an absolute path. A permission problem must not be routed through it, and an absolute path does not belong mid-sentence in front of a user. It survived because the microphone path is the one the README's *"Needs a human"* note says has no automated gate |
