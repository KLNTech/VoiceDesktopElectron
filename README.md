# VoiceDeskElectron

A macOS desktop assistant you talk to. Hold a button, speak, release — your words appear as
text, go to a coding agent running through its own CLI, and the agent's reply comes back in the
window. The agent reads and writes Markdown files in a `notes/` folder beside the app.

> *"add milk to my shopping list"* → the agent creates or edits `notes/shopping.md`
> *"what's on my list?"* → the agent answers from it

Repository name: `VoiceDesktopElectron`. Product name: VoiceDeskElectron.

---

## Status — read this first

| | |
|---|---|
| **Architecture** | planned and written down: [`docs/PLAN.md`](docs/PLAN.md) |
| **Work breakdown** | [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md) — subtasks, complexity, what can run in parallel |
| **UI design** | canvas at version `0.3.1` — 800 × 720, two panels; the brief ([`docs/design/DESIGN-BRIEF.md`](docs/design/DESIGN-BRIEF.md)) describes it. **Implemented** against the fifteen artboards, read directly from the canvas |
| **Application code** | S1 → S11 built: the window, the turn machine, push-to-talk capture, on-device transcription, the agent over `claude -p`, the two-panel interface, the spoken reply, and one real Electron launch guarding the seam. Awaiting review — see [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md) |

Not everything below the *Requirements* heading has been executed end to end. Each step is marked ✅ where it has been verified on the development machine and
◻︎ where it has not. This table and those marks are updated as the build proceeds — a README
that claims more than the repository does is the one defect this file cannot have.

Development machine: macOS 26.6.2 (Apple Silicon), Node 26.8.1, npm 11.19.0.

---

## What this application is

A window with a button. You hold the button, say a sentence, and let go. What you said appears as
text, an agent acts on it, and the agent's answer appears underneath — while the file it wrote
shows up in the list on the left. That is the whole product, and everything below is how it is
made to happen.

Two things about it are unusual enough to state plainly, because they are what the design is for.

**Your voice never leaves the machine.** Transcription runs locally, through `whisper.cpp` on
your CPU. There is no API key for it, no account, no upload, and no network call — pull the
Ethernet cable and the transcription half still works. The recording exists as a temporary WAV
in a per-turn temp directory that is deleted on every exit path, including the failing ones.

**There is no model API key either.** The agent half does not call a model; it runs the **Claude
Code CLI** as a subprocess — the same `claude` you use in a terminal — and that CLI authenticates
with its own macOS Keychain login. This app checks that the keychain entry exists and never reads
it. So the credential belongs to Claude Code, not to VoiceDesk, and there is nothing here to leak.

### One turn, from press to answer

A single hold runs through six steps. Each is a real component, and each can fail in a way that
gets its own message rather than a generic one.

| # | what happens | where it lives |
|---|---|---|
| 1 | **You press and hold.** The microphone is acquired *now*, not at startup — asking before you have pressed anything reads as spyware and burns the one prompt macOS gives. A meter follows your voice, so you can see that it is listening. | `src/renderer/src/audio/recorder.ts` |
| 2 | **You let go.** The audio worklet is asked to flush its tail, the microphone is released, and the raw mono samples cross to the main process. Under 250 ms is treated as a slip, not a turn; over 120 s the hold is ended for you. | `recorder.ts`, `src/domain/model/turn.ts` |
| 3 | **The words come back.** `whisper-cli` runs on the clip with the English model, and the transcript is parsed out of its JSON — parsed, not cast, because it is another program's format. | `src/infrastructure/transcribe/WhisperCppTranscriber.ts` |
| 4 | **Your words go on screen immediately**, before the agent is asked anything. Showing someone their own words is a separate promise from answering them, and the agent step is the long one. | `src/renderer/src/useTurn.ts` |
| 5 | **The agent answers.** `claude -p` is spawned with the transcript, confined to the `notes/` folder, and it creates or edits Markdown there. Its reply, the files it touched, the model it actually ran and what the call cost come back in one JSON envelope. | `src/infrastructure/agent/ClaudeCliAgentRunner.ts` |
| 6 | **Optionally, the answer is read aloud** through the macOS `say` binary, in an English voice chosen deliberately rather than inherited from the system language. | `src/infrastructure/speak/MacSaySynthesizer.ts` |

Every step out of the process — Whisper, the agent, `say` — is treated the way a network call
is: an argv array and never a shell, a deadline that kills, and failures split into *"your
machine needs something installed"* and *"the run failed"*, because collapsing those two sends
you to debug the wrong thing.

### What you see

The window is 800 × 720 and has two panels.

- **On the left, `notes/`** — every Markdown file in the folder, each marked with what the last
  turn did to it: `EDITED`, `READING`, or nothing. It is a readout, so you can watch the agent
  work rather than take its word for it.
- **On the right, the conversation** — your turns and the agent's replies, timestamped, with the
  files each turn changed listed under it.
- **Along the top**, the version, the stage, and the model the CLI **actually ran** — read out of
  the reply envelope rather than out of a setting, so it is something you can check rather than
  something this README asserts. **About** opens the third-party notices, built from
  `process.versions` and the installed packages' own manifests.
- **When something breaks**, a panel that names the failure, gives you the one action that fixes
  it — open System Settings, copy an install command, retry — and a code you can quote.

### How it is built

Four layers, and the dependency arrows only point inward.

```
src/domain/          policy: the turn machine, the models, the ports. Plain TypeScript.
                     Imports NOTHING platform-shaped — no Electron, no Node, not even `process`.
src/infrastructure/  the adapters that implement those ports: whisper, the agent CLI, `say`,
                     the notes folder. All the I/O lives here.
src/main/            the backend: the composition root, the IPC handlers, the window.
src/renderer/        the page: React, and nothing that can reach the operating system.
shared/              the wire contract — the channel names and the payload schemas, imported by
                     main, preload and renderer alike, so a change is a compile error everywhere.
```

That rule is not a paragraph anybody has to remember: `test/architecture.test.ts` reads every
file under `src/domain/` and reddens on a static import, a side-effect import, a dynamic import,
a `require`, or the `process` global — and it also checks the other direction, that nothing in
the renderer reaches an adapter.

Electron's three processes are used as the privilege boundary they are. The renderer runs with
`contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`, under a
Content-Security-Policy with no `unsafe-eval`, and it can reach exactly seven named bridge methods
and nothing else — never `ipcRenderer`. Main validates every payload that arrives from
it, because a page is the least-trusted thing in a desktop app. Those two properties are held by
tests that launch a real Electron, not by review.

### Where your data is

- `notes/` beside the app — plain Markdown, yours, readable by anything. Set `VOICEDESK_NOTES_DIR`
  to put it elsewhere.
- Nothing else. No database, no cache of your audio, no telemetry, no analytics, no crash
  reporter, and no network destination other than the ones Claude Code opens for itself.

---

## Requirements

| | version | why |
|---|---|---|
| macOS | 13 or newer | the app is macOS-only; the spoken reply uses the system `say` |
| [Homebrew](https://brew.sh) | any current | installs the speech-to-text engine |
| Node.js | 26.x | the toolchain is pinned to it, and the install **refuses** rather than warns on a different major |
| Claude Code CLI | see step 4 | the app drives an agent CLI, not a model API — and it has to be **signed in** on this machine |
| A microphone | — | built-in is fine |

**No API key, for either half.** Transcription runs locally, and the agent authenticates
through the Claude Code CLI's own macOS Keychain login (step 4). VoiceDeskElectron never asks for,
stores or passes an API key or token: the keychain entry belongs to Claude Code, the app checks
only that it is there, and it never reads the secret.

---

## Install, from a Mac that has nothing

Five steps. Copy them in order.

### 1 · Homebrew ✅

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Already have it? `brew --version` prints a version — skip.

### 2 · Node 26 ✅

```bash
brew install node@26
brew link --overwrite node@26          # if `node -v` does not already print v26.x
node -v                                # expect v26.x
```

Using `nvm` instead? `nvm install 26 && nvm use 26` — the repo carries an `.nvmrc`.

### 3 · The speech-to-text engine ✅

```bash
brew install whisper-cpp               # provides the `whisper-cli` binary
whisper-cli --help | head -1           # prints usage → installed
```

Then download a model. The default is `base.en` (~150 MB, English, fast):

```bash
mkdir -p ~/.whisper
curl -L -o ~/.whisper/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

That is the default. **Verified on the development machine:** the download took under 3
seconds, and the model transcribes short commands in ~0.5 s per two seconds of speech.
It does occasionally run two words together (`Add milk` → `Admilk`). **For markedly better accuracy**
at ~1.6 GB, download `ggml-large-v3-turbo.bin` from the same location and point
`VOICEDESK_WHISPER_MODEL` at it:

```bash
curl -L -o ~/.whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
export VOICEDESK_WHISPER_MODEL=~/.whisper/ggml-large-v3-turbo.bin
```

### 4 · Claude Code — installed **and signed in** ✅

VoiceDeskElectron drives a coding agent through its command line, and the one adapter in this build is
Claude Code (`claude -p`). Two things have to be true, not one: the CLI is on this machine, and
you have signed in to it **in a terminal on this machine**. The sign-in is the half that matters
to the app — it is what writes the credentials into the macOS Keychain that VoiceDeskElectron later
depends on, without VoiceDeskElectron ever handling them itself.

```bash
# 1 — install
curl -fsSL https://claude.ai/install.sh | bash
claude --version                    # this repo is built and tested against 2.1.263

# 2 — sign in, once, in a terminal, as the macOS user who will run the app
claude                              # follow the login prompts, then leave the session

# 3 — confirm the whole path, non-interactively (costs a fraction of a cent)
claude -p 'Reply with exactly: ok' --model haiku --output-format json --strict-mcp-config
```

Step 3 is the one worth running, because it exercises exactly what the app will do. **Verified
on the development machine:** it exits `0` and prints a JSON object whose `subtype` is
`success`, whose `is_error` is `false`, and whose `result` is the word `ok`. Two more fields in
that object are worth a glance — `modelUsage` names the model that actually ran (here
`claude-haiku-4-5-…`), and `total_cost_usd` is what the call cost: about $0.01.

`codex exec` and `cursor-agent -p` fit the same seam, but each would need a second adapter, and
that is not in this delivery — see the future-work table in
[`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md).

> **If the app cannot find it:** an app launched from Finder gets a minimal `PATH` that does not
> include `~/.local/bin` or `/opt/homebrew/bin`. Set `VOICEDESK_AGENT_BIN` to the absolute path
> (`which claude` in a terminal, or `~/.local/bin/claude`) and the app will use it directly.

> **If the app says you are not signed in:** the binary is there, the keychain entry is not.
> That entry lives in *your* login keychain, so the sign-in has to have happened as the macOS
> user who runs the app — not as another account, and not on another machine. Do step 2, re-run
> the step 3 probe, then restart VoiceDeskElectron.

### 5 · VoiceDeskElectron itself ✅

```bash
git clone https://github.com/KLNTech/VoiceDesktopElectron.git
cd VoiceDesktopElectron
npm ci
npm run dev
```

The first launch asks for **microphone** permission. Grant it. If you decline and change your
mind: *System Settings → Privacy & Security → Microphone → VoiceDeskElectron*.

### Configuration ✅

Everything has a working default; set these only to override.

| variable | default | what it does |
|---|---|---|
| `VOICEDESK_AGENT_BIN` | `claude` resolved from a known list | absolute path to the agent CLI |
| `VOICEDESK_AGENT_MODEL` | `haiku` | which model tier the agent CLI runs on. **One of exactly `haiku`, `sonnet`, `opus`** — anything else is refused on the first turn with a message naming the three, rather than silently falling back, because an operator who set this deliberately should not quietly get something else. The default pins the cheapest current tier on purpose: this is a demonstration build, and an expensive tier must not be reachable by accident. Only `haiku` has been exercised |
| `VOICEDESK_SKIP_LOGIN_CHECK` | unset | set to `1` to skip the macOS keychain preflight that turns *"never signed in"* into its own setup message. An escape hatch for a machine that authenticates some other way — nothing is disabled by it |
| `VOICEDESK_WHISPER_BIN` | `whisper-cli` resolved from a known list | absolute path to the transcriber |
| `VOICEDESK_WHISPER_MODEL` | `~/.whisper/ggml-base.en.bin` | which model file to load |
| `VOICEDESK_NOTES_DIR` | `./notes` beside the app | the only folder the agent may write to |

---

## Using it ✅

1. Hold the big button — or hold **Space** while the window has focus.
2. Speak. The meter moves while the microphone is live.
3. Release. Your words appear as text first, then the agent's reply appears under them. The
   transcript does not wait for the agent: showing you your own words is a separate promise
   from answering them, and the agent step is the long one.
4. Press **Speak reply** to hear it read back by the macOS voice.
5. Watch the left panel — the files there were written by the agent, never by the app, and each
   row says whether this turn edited it, read it, or left it alone.

The interface is **English only**. Every string goes through a single lookup table, so adding
a language later is a JSON file rather than a pass over the whole UI — but no second language
ships in this build and there is no language switcher.

---

## What works · what was cut · how long it took

**Works**, verified on the development machine:

- `npm ci && npm run dev` opens the window. `npm run verify:clone` proves that from a fresh
  clone — it clones the repository as git would hand it to you, installs from the lockfile,
  builds, checks the artefacts are real files on disk, and runs the suite.
- Hold the control (or **Space**), speak, release. The meter follows your voice, your words
  appear as text — transcribed on this machine, with no key, no account and no network — and
  the agent's reply appears under them.
- *"add milk to my shopping list"* creates a Markdown file in `notes/`; *"what's on my list?"*
  answers from it across a second `claude -p` spawn. That round trip is executed by
  `test/claude-cli-agent.test.ts` against the real CLI, not described here.
- The title bar reports the model the CLI **actually ran**, read out of the reply envelope. The
  cheap tier is therefore something you can check rather than something this README asserts.
- Setup problems name the missing thing and the command that fixes it, and are kept distinct
  from a failed turn: a missing binary, a Whisper model that is not there, and *"nobody ever
  signed in on this machine"* each get their own message.
- The suite spans **23 test files**, and `npm test` runs the typecheck and the linter before any
  of them, because it previously ran neither and a real type error went green. The file count is
  checked by `test/readme-licences.test.ts` rather than typed here and left to rot; the number of
  individual assertions is deliberately not quoted, because it changes on almost every commit and
  a stale number in a README is the defect this project keeps writing gates against.

**Needs a human, and so has no automated gate:** granting the microphone permission, and every
question of appearance. Nothing in the suite looks at the window.

**Cut, and what each cut stops catching** — the second half is the part usually left out:

| cut | what now runs against no check |
|---|---|
| No packaged `.app`, no signing, no notarisation ([`docs/PLAN.md`](docs/PLAN.md) §13) | every defect that appears only in a packaged artifact: `asar` path assumptions, a spawned binary that is not where it was in dev, an entitlement that is missing. Nothing here exercises a packaged build |
| No CI | nothing runs these gates except a person typing `npm test`. They all pass locally; that is a different statement |
| Playwright dropped from S10 | nothing drives the UI as a user does. A control wired to the wrong handler, a pane rendering in the wrong state, or a button disabled when it should not be will not redden anything. The IPC seam **is** gated, by a real Electron launch |
| No second locale, no switcher | nothing checks that a string reaches the window through `t()` rather than as a literal |

**How long it took**, measured rather than remembered — `git log` is the only honest source, so
here is what it says: **34 commits, first at 22:26 and last at 02:30 the following morning —
about four hours of wall clock**, in two sittings. Read it as wall clock and not as effort: it
excludes the planning that produced `docs/PLAN.md` and the design brief before the first commit,
which is not in the history and which I am not going to estimate here.

The largest single cost inside those four hours was not writing code. A sandboxed preload has no
module resolver, the bundler had left `zod` external, so the preload threw before
`contextBridge` ever ran — `window.voicedesk` was `undefined`, every call rejected on
`undefined`, and the interface sat in "transcribing" for ever while the typecheck, the linter
and every unit test stayed green. Finding it took longer than writing the adapter it was hiding,
and it is the reason `test/preload-bridge.test.ts` launches a real Electron.

---
## Third-party software and licences

VoiceDeskElectron is built on other people's work. The permissive licences below (MIT, Apache-2.0,
BSD) require their copyright and permission notices to travel with any distribution, so the
list is reproduced here and, in the running app, under **About**.

**The version numbers in these tables are checked, not typed.** `test/readme-licences.test.ts`
reads each row back against `package-lock.json` and fails when they disagree — because a version
in a Markdown table is correct on the day it is written and silently wrong from the next upgrade
onward, and nothing about a stale row looks broken. The About sheet inside the app does not read
this file at all: it builds its table from `process.versions` and the installed packages' own
manifests, so it reports rather than recites.

### Shipped inside the application

These are bundled into the built app, so their notices are legally required to accompany it.

| component | version | licence |
|---|---|---|
| [Electron](https://github.com/electron/electron) | 44.2.0 | MIT |
| [Chromium](https://www.chromium.org/) *(inside Electron)* | as bundled by Electron 44 | BSD-3-Clause + the licences listed in Electron's `LICENSES.chromium.html` |
| [Node.js](https://nodejs.org) *(inside Electron)* | as bundled by Electron 44 | MIT |
| [Barlow · Barlow Condensed](https://github.com/jpt/barlow) *(via `@fontsource`)* | 5.3.0 | OFL-1.1 |
| [React](https://github.com/facebook/react) | 19.2.8 | MIT |
| [React DOM](https://github.com/facebook/react) | 19.2.8 | MIT |
| [Zod](https://github.com/colinhacks/zod) | 4.5.4 | MIT |

### Required at runtime, installed by the user, not redistributed

Attribution is given because it is deserved, not because a redistribution obligation is being
triggered — the app calls these; it does not ship them.

| component | version | licence |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-cpp`) | 1.9.2 | MIT |
| [Whisper models](https://huggingface.co/ggerganov/whisper.cpp) (`ggml-*.bin`) | — | MIT |
| Claude Code CLI | 2.1.263 | proprietary — see its own terms |
| macOS `say` | system | part of macOS |

### Build-time only

Not present in the built app; listed for completeness.

| component | version | licence |
|---|---|---|
| [TypeScript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | 7.3.6 | MIT |
| [electron-vite](https://github.com/alex8088/electron-vite) | 5.0.0 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.2.0 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0.0 | MIT |
| [Testing Library](https://github.com/testing-library/react-testing-library) | 16.3.3 | MIT |
| [jsdom](https://github.com/jsdom/jsdom) | 30.0.1 | MIT |
| [oxlint](https://github.com/oxc-project/oxc) | 1.81.0 | MIT |
| [oxlint-tsgolint](https://github.com/oxc-project/tsgolint) | 7.0.2001 | MIT |

**Not used, on purpose — and checked, not merely intended:** `ffmpeg` is GPL-3.0-or-later, which
would reach further into a shipped product than anything else here. `whisper-cli` decodes WAV
itself, so the app captures raw microphone samples and writes the WAV header in a few lines rather
than recording a compressed format and transcoding it. Every dependency in this project is
therefore permissively licensed.

Verified rather than assumed: `ffmpeg` appears nowhere in `package-lock.json`, and the
`whisper-cli` on this machine links only `libwhisper`, `libggml`, `libggml-base`, `libc++` and
`libSystem` — Homebrew's declared dependencies for it are `ggml`, `libomp`, `sdl2-compat` and
`sdl3`. `test/readme-licences.test.ts` holds the lockfile half of that claim. The half a test here
*cannot* hold is the binary the user installs, which is why F10 carries the constraint explicitly:
whatever gets vendored has to be checked for it at the moment of vendoring.

Exact versions are pinned in `package-lock.json`, which is the authoritative list; this table is
the human-readable copy of it and is regenerated whenever a dependency changes.

**One pin is deliberately not the newest release.** Vite is held at 7.3.6 rather than 8.x
because `electron-vite` 5.0.0 — the newest stable — declares a peer range of `^5 || ^6 || ^7`,
and `@vitejs/plugin-react` 6.x requires Vite 8, so the two cannot both be current. The set above
is the newest combination that actually resolves, all of it generally available. It moves the
day `electron-vite` supports Vite 8.

---

## Not in this delivery

Named here so nobody goes looking: there is **no packaged `.app` or `.dmg`, no code signing
or notarisation, and no CI/CD pipeline**. The delivery is the development build described
above. The full list, with the reason for each, is the future-work table at the end of
[`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md).

### Wanted next, and not started

Recorded so each absence is a decision rather than an oversight. None of it is promised, and
nothing above claims any of it. The reason for each, and what it would take, is the same table:
[`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md) → *Future work*.

**The install is longer than it should be**

- **F10 — ship Whisper inside the app**: the `whisper-cli` binary, its libraries, and
  `ggml-small.bin`, so a new user installs one thing instead of four. Today step 3 of the install
  is `brew install whisper-cpp` plus a model download, and both are ways for a first run to fail
  before the app has done anything.

  **What it costs, measured rather than estimated.** The engine is small: `whisper-cli` is 643 KB
  and its libraries about 1.1 MB, both read off this machine. The model is the whole download, and
  the sizes below come from the publisher's own `content-length` — the `base.en` figure matches the
  file on this disk byte for byte, so the other two are trustworthy:

  | model | size | note |
  |---|---|---|
  | `ggml-base.en.bin` | 141 MB | what the app installs today |
  | `ggml-small.en.bin` | 465 MB | English-only, same size as `small` |
  | `ggml-small.bin` | 465 MB | **requested** — multilingual |

  So the app goes from a ~2 MB build to roughly **470 MB**. That is accepted on purpose: a user
  who has to install four things has four chances to give up before the app does anything.

  **One decision inside this one, worth taking deliberately:** `small` and `small.en` are the same
  size, and `small` is the *multilingual* build. Everything else in this app is English-only — the
  transcriber is invoked `-l en`, the reply is read in an English voice chosen on purpose, and
  `i18n/` holds one file. Bundling multilingual `small` while pinning `-l en` buys nothing but the
  bytes; making it actually multilingual is F7, and it is a larger change than swapping a file.

  **Whatever is vendored has to stay `ffmpeg`-free** — see the licence note above. That is a
  property of the binary that gets shipped, not of this repository, so it needs checking at the
  moment of vendoring.
- **F18 — the consent is not recorded against this application at all.** In System Settings →
  Privacy & Security → Microphone the entry carries **Electron's** name and icon, not VoiceDesk's,
  because an unpackaged development build *is* Electron as far as macOS is concerned: it has no
  bundle identifier of its own. Three consequences, and none of them is cosmetic — the user cannot
  tell which application they are granting; every Electron app on the machine shares that one
  switch; and a grant given to VoiceDesk is really given to anything else built on Electron. Fixed
  by F1 and F2 and by nothing short of them, because a bundle identifier is created at packaging
  time.
- **F19 — a missing microphone permission can end up on the wrong board.** Reported from use:
  instead of the microphone board, a *"Setup is incomplete"* dialog appears carrying a filesystem
  path. That board is the `setup` failure, and its body is the failing adapter's hint shown
  verbatim — two of those hints quote an absolute path (`No Whisper model at …`, and the one that
  names `VOICEDESK_WHISPER_BIN`). Two things are wrong and both are worth fixing: **a permission
  problem must never be routed through the setup board**, which is about things that are not
  installed, and **an absolute path does not belong in the middle of a sentence** shown to
  someone who is not the developer. Not reproduced here — this repository's machine has the
  permission granted, so the branch cannot be entered without revoking it — which is itself part
  of the reason it survived: the mic path is the one the *"Needs a human"* note above says has no
  automated gate.

**The notes panel is a list you can only read**

- **F11 — choose where the Markdown files live**, from the app rather than from
  `VOICEDESK_NOTES_DIR`.
- **F12 — make the list on the left work**: a row you can click to open, and a row you can
  delete.
- **F13 — one conversation per note.** Today there is a single agent session for the whole app;
  the useful shape is a dialogue attached to the note it is about, and a dialogue that can itself
  be deleted.
- **F14 — the agent may delete a Markdown file**, not only create and edit one.
- **F15 — rename a note**, so a name typed in the first sentence is not permanent.

**Signing in, and starting over**

- **F16 — sign in as any account.** Today the app inherits whichever account Claude Code is signed
  into on this machine, by checking that its Keychain entry exists and never reading it. Two things
  follow that a product cannot keep: the user cannot choose the account, and **Claude Code has to
  be installed at all** — the app has no path of its own to a model.
- **F20 — clearing the agent window clears the context.** Right now the window and the conversation
  are separate things: `sessionId` is carried in `useTurn` across turns so *"add milk"* and
  *"what's on my list?"* are one conversation, and nothing in the interface drops it. Emptying the
  panel should end the session, not just stop drawing it — otherwise the user believes they started
  over and the agent does not.

**Checks that run somewhere other than a developer's laptop**

- **F3 — CI on GitHub Actions**, which is what the rest of the tooling around this project
  already speaks.
- **F17 — a UI happy-path gate that runs AFTER the merge**, not in front of it. The domain
  pipeline stays the thing that blocks a merge; this one drives the window through one whole turn
  and reports, which is exactly the coverage the Playwright cut gave up (see the cut table above).
- **F4 — CD on the same runner, two artifacts on two events.** A pull request builds a **dev**
  artifact, so a reviewer can open the thing rather than read about it; a merge to `main` builds a
  **release** artifact from the version already bumped on the branch. Both need F1 and F2 first —
  a release pipeline with no signed artifact publishes something nobody can open.

---

## Licence

VoiceDeskElectron itself: to be decided before the first release.
