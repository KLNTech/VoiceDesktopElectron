# VoiceDesk — work breakdown

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
| **1 — current** | **S1 → S6** | the app opens, records while you hold, shows a level meter, and turns your speech into text on screen. It does **not** reach the agent yet |
| 2 | S7, S10 | the transcript reaches `claude -p`, edits `notes/`, and the reply comes back; one end-to-end launch guards the seam |
| 3 | S8, S9, S11 | the approved design is implemented, the reply is spoken, and the README is closed out with real numbers |

S8 stays `BLOCKED` until the design canvas is filled in and approved, which is why it is in the
last iteration and not the first — the UI is implemented against an approved design, not
sketched twice.

Iteration 1 deliberately stops **before** the agent adapter. Speech-to-text on screen is a
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
  on a machine that has never seen this repo opens a window showing `v0.1.0 · dev`.
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
- **Complexity:** 7 · **Parallelism:** PARALLEL (with S5, S6) · **Status:** PLANNED

### S8 — the interface
Scope: implement the approved design — the eight states, the talk control with its meter, the
four failure screens, the about/credits sheet, and every string through `t()` against the one
locale that ships (English). No second locale, no switcher — see `docs/PLAN.md` §10.

- **Acceptance:** *"UI: generate it with Claude Design … it looks intentional and is usable"*,
  and each artboard state is recognisable in the running app.
- **Complexity:** 7 · **Parallelism:** SEQUENTIAL (after S5) · **Status:** BLOCKED — waiting on
  the design canvas being filled in and approved.

### S9 — spoken reply *(stretch)*
Scope: `MacSaySynthesizer` behind the port, plus the control that triggers it.

- **Acceptance:** *"Stretch, only if you're inside the budget: the reply is spoken back."*
- **Complexity:** 3 · **Parallelism:** PARALLEL (last) · **Status:** PLANNED — confirmed in
  scope. It is the cheapest point the brief offers and it stays cheap: one adapter, one
  control, no new dependency.

### S10 — the one end-to-end
Scope: a single Playwright `_electron` launch that starts the real app, asserts the preload
bridge exists, and puts one round trip across the real IPC seam.

- **Acceptance:** something in this project executes in the renderer, so a CSP or preload-wiring
  defect has a gate in front of it.
- **Complexity:** 4 · **Parallelism:** SEQUENTIAL (after S4, S5) · **Status:** PLANNED

### S11 — the README
Scope: install from zero on a Mac that has nothing; run; what works; what was cut and what that
stops catching; how long it actually took; and the full third-party licence list with names and
versions, which is also the data behind the about panel.

- **Acceptance:** *"It runs on a clean machine following your README"* and *"A README that tells
  the truth"*.
- **Complexity:** 4 · **Parallelism:** SEQUENTIAL (written incrementally from S1 onward, closed
  last) · **Status:** IN PROGRESS

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
| F3 | **CI** — typecheck, unit tests, the architecture gate and the one Playwright launch on every push | the gates exist and run locally; wiring them to a runner is a day's work that buys nothing until more than one person commits |
| F4 | **CD** — tagged release publishing the signed artifact | strictly after F1–F3; a release pipeline without a signed artifact publishes something nobody can open |
| F5 | **Auto-update** | only meaningful once F4 exists |
| F6 | **Second agent adapter** (`codex exec`, `cursor-agent -p`) | the port exists from day one, so this is an adapter and a line in the composition root — cheap later, wasted now |
| F7 | **Second language** | the lookup table and `t()` ship in this build; a locale is a JSON file and a switch |
| F8 | **Global hold-to-talk** while another app is focused | needs a native keyboard hook rebuilt per Electron version plus an Accessibility permission — see `docs/PLAN.md` §12 |
| F9 | **Running the agent on a larger model tier** | not an omission: `--model haiku` is pinned on purpose because this is a demonstration build and an expensive tier must not be reachable by accident. `VOICEDESK_AGENT_MODEL` exists so an operator can opt in deliberately; nothing in this delivery raises the tier by itself, and no quality claim is made for one that does |
