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
- 192 automated checks across 27 files. `npm test` runs the typecheck and the linter first,
  because it previously ran neither and a real type error went green.

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

**Not used, on purpose:** `ffmpeg` is GPL-3.0-or-later. `whisper-cli` decodes WAV itself, so the
app captures raw microphone samples and writes the WAV header in a few lines rather than
recording a compressed format and transcoding it. Every dependency in this project is therefore
permissively licensed.

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

---

## Licence

VoiceDeskElectron itself: to be decided before the first release.
