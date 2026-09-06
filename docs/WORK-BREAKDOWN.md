# VoiceDesk — work breakdown

The build, decomposed before any of it is written. Each subtask carries a scope, an acceptance
criterion **quoted from the client brief** (not "tests are green"), a complexity rating 1–10 that
decides how much review it gets, and a parallelism label.

Status values: `PLANNED` · `IN PROGRESS` · `BLOCKED` · `DONE (accepted)`. Nothing is reported
done until its acceptance criterion has been checked against the brief — and the umbrella is
done only when every subtask is, not when most of them are.

---

## Branching, and a deliberate deviation

The usual rule here is one branch per subtask, squash-merged. **This build commits directly to
`main` instead**, because the brief grades the commit history itself:

> *"Don't clean up the history. Real commits as you go, not one squash at the end."*

A squash merge per subtask is exactly the cleanup that sentence forbids. The trade is that
`main` carries intermediate states; that is the point.

---

## Dependency shape

```
S1 toolchain + window ─┬─► S4 IPC contract ─┬─► S5 capture ──┬─► S8 UI  ──► S11 README
                       │                    │                │
S3 domain (parallel) ──┘                    ├─► S6 whisper ──┤
                                            ├─► S7 agent CLI ┤
S2 arch gate (parallel with S3)             └─► S10 smoke ───┘
                                                              S9 TTS (stretch, last)
                                                              S12 packaging (optional)
```

---

## Subtasks

### S1 — toolchain and a window that opens
Scope: stand up Node 26 / TypeScript strict / electron-vite with three build outputs, and a
single `BrowserWindow` that opens with the three security switches written explicitly and a
version badge reading `package.json`.

- **Acceptance:** *"It runs on a clean machine following your README"* — `npm ci && npm run dev`
  on a machine that has never seen this repo opens a window showing `v0.1.0 · dev`.
- **Complexity:** 5 · **Parallelism:** SEQUENTIAL (root) · **Status:** PLANNED

### S2 — the architecture gate
Scope: Vitest, plus the ~15-line test that fails when `domain/` imports the platform, proven by
breaking it once.

- **Acceptance:** the gate has been *seen* to redden on a deliberate violation, and asserts it
  scanned a non-empty file list.
- **Complexity:** 3 · **Parallelism:** PARALLEL (with S3) · **Status:** PLANNED

### S3 — the domain
Scope: `TurnState`, `TurnFailure`, the three ports, and `runVoiceTurn` as a function taking
ports as arguments. Unit tests for the turn machine, including the 250 ms rule and the
"key repeat is ignored" rule.

- **Acceptance:** the whole flow *audio → transcript → reply* is expressible and testable with
  no Electron, no binaries and no network.
- **Complexity:** 5 · **Parallelism:** PARALLEL (needs nothing from S1) · **Status:** PLANNED

### S4 — the IPC contract
Scope: `shared/ipc.ts` (channel names + zod schemas, one declaration), the preload bridge with
one named method per message, and main handlers that unwrap → call the use case → wrap. Errors
cross as typed data.

- **Acceptance:** the renderer can reach exactly the five declared messages and nothing else;
  `ipcRenderer` is not exposed and no bridge function takes a caller-supplied channel name.
- **Complexity:** 6 · **Parallelism:** SEQUENTIAL (after S1, S3) · **Status:** PLANNED

### S5 — push-to-talk capture
Scope: hold-to-talk on the button and on `Space`; `getUserMedia` on first hold; `AudioContext`
at 16 kHz; an `AudioWorklet` producing mono Float32; a live level meter; all four hold-ending
events; microphone permission handled as three distinct outcomes.

- **Acceptance:** *"Hold a key or button, speak, release → your words appear as text in the
  window."*
- **Complexity:** 7 · **Parallelism:** SEQUENTIAL (after S4) · **Status:** PLANNED

### S6 — the transcription adapter
Scope: `WhisperCppTranscriber` over `execFile`, the pure Float32 → 16-bit PCM WAV encoder,
binary + model resolution that survives a Finder-launched app's minimal `PATH`, and the
`ENOENT` → *setup failure* mapping.

- **Acceptance:** speech becomes text with no API key, no account and no network; a missing
  binary or model says which one and how to install it.
- **Complexity:** 6 · **Parallelism:** PARALLEL (with S5, S7) · **Status:** PLANNED

### S7 — the agent CLI adapter
Scope: `ClaudeCliAgentRunner` — argv array via `execFile` with no shell, the full flag set from
`docs/PLAN.md` §5.2, zod-parsed JSON reply, session continuity carried explicitly, timeout that
kills, and the three-way outcome mapping.

- **Acceptance:** *"add milk to my shopping list"* creates or edits `notes/shopping.md`, and
  *"what's on my list?"* answers from it — through the CLI, not the raw API, with the agent's
  blast radius bounded to `notes/`.
- **Complexity:** 7 · **Parallelism:** PARALLEL (with S5, S6) · **Status:** PLANNED

### S8 — the interface
Scope: implement the approved design — the eight states, the talk control with its meter, the
four failure screens, the about/credits sheet, every string through `t()`.

- **Acceptance:** *"UI: generate it with Claude Design … it looks intentional and is usable"*,
  and each artboard state is recognisable in the running app.
- **Complexity:** 7 · **Parallelism:** SEQUENTIAL (after S5) · **Status:** BLOCKED — waiting on
  the design canvas being filled in and approved.

### S9 — spoken reply *(stretch)*
Scope: `MacSaySynthesizer` behind the port, plus the control that triggers it.

- **Acceptance:** *"Stretch, only if you're inside the budget: the reply is spoken back."*
- **Complexity:** 3 · **Parallelism:** PARALLEL (last) · **Status:** PLANNED — ships only if the
  time budget is honest without it.

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

### S12 — packaging *(optional)*
Scope: `electron-builder` producing an unsigned `.app`/`.dmg`, with the microphone usage
description in `Info.plist`.

- **Acceptance:** a build exists that runs on another Mac after right-click → Open; signing and
  notarisation are explicitly out of scope and said so in the README.
- **Complexity:** 4 · **Parallelism:** PARALLEL (late) · **Status:** PLANNED

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

## Questions that must be answered before S7 and S8 start

1. **Default Whisper model** — `base.en` (~150 MB, fast setup) or `large-v3-turbo` (~1.6 GB,
   markedly better, already present on this machine)? Affects README install time.
2. **Stretch goal** — is the spoken reply (S9) wanted, or is the time better spent on S8?
3. **Packaging** — is S12 in scope, or is `npm run dev` the whole delivery?
