# VoiceDesk

A macOS desktop assistant you talk to. Hold a button, speak, release — your words appear as
text, go to a coding agent running through its own CLI, and the agent's reply comes back in the
window. The agent reads and writes Markdown files in a `notes/` folder beside the app.

> *"add milk to my shopping list"* → the agent creates or edits `notes/shopping.md`
> *"what's on my list?"* → the agent answers from it

Repository name: `VoiceDesktopElectron`. Product name: VoiceDesk.

---

## Status — read this first

| | |
|---|---|
| **Architecture** | planned and written down: [`docs/PLAN.md`](docs/PLAN.md) |
| **Work breakdown** | [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md) — subtasks, complexity, what can run in parallel |
| **UI design** | canvas at version `0.3.1` — 800 × 720, two panels; the brief ([`docs/design/DESIGN-BRIEF.md`](docs/design/DESIGN-BRIEF.md)) describes it. **Not implemented yet**: the interface is built in one pass against the artboards |
| **Application code** | iteration 1 built: the window, the turn machine, push-to-talk capture and on-device transcription. The agent is **not** wired up yet — see the iteration table in [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md) |

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
through the Claude Code CLI's own macOS Keychain login (step 4). VoiceDesk never asks for,
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

VoiceDesk drives a coding agent through its command line, and the one adapter in this build is
Claude Code (`claude -p`). Two things have to be true, not one: the CLI is on this machine, and
you have signed in to it **in a terminal on this machine**. The sign-in is the half that matters
to the app — it is what writes the credentials into the macOS Keychain that VoiceDesk later
depends on, without VoiceDesk ever handling them itself.

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
> the step 3 probe, then restart VoiceDesk.

### 5 · VoiceDesk itself ◻︎

```bash
git clone https://github.com/KLNTech/VoiceDesktopElectron.git
cd VoiceDesktopElectron
npm ci
npm run dev
```

The first launch asks for **microphone** permission. Grant it. If you decline and change your
mind: *System Settings → Privacy & Security → Microphone → VoiceDesk*.

### Configuration ◻︎

Everything has a working default; set these only to override.

| variable | default | what it does |
|---|---|---|
| `VOICEDESK_AGENT_BIN` | `claude` resolved from a known list | absolute path to the agent CLI |
| `VOICEDESK_AGENT_MODEL` | `haiku` | which model the agent CLI runs on. The default pins the cheapest current tier on purpose — this is a demonstration build, and an expensive tier must not be reachable by accident |
| `VOICEDESK_WHISPER_BIN` | `whisper-cli` resolved from a known list | absolute path to the transcriber |
| `VOICEDESK_WHISPER_MODEL` | `~/.whisper/ggml-base.en.bin` | which model file to load |
| `VOICEDESK_NOTES_DIR` | `./notes` beside the app | the only folder the agent may write to |

---

## Using it ◻︎

1. Hold the big button — or hold **Space** while the window has focus.
2. Speak. The meter moves while the microphone is live.
3. Release. Your words appear as text, then the agent's reply appears under them — and is
   read back aloud by the macOS voice.
4. Look in `notes/` — the files there were written by the agent, never by the app.

The interface is **English only**. Every string goes through a single lookup table, so adding
a language later is a JSON file rather than a pass over the whole UI — but no second language
ships in this build and there is no language switcher.

---

## What works · what was cut · how long it took

Filled in as the build progresses; empty here means not yet done, not overlooked.

- **Works:** `npm ci && npm run dev` opens the window. Hold the button (or **Space**), speak,
  release — the level meter follows your voice, and your words appear as text, transcribed on
  this machine with no network. Setup problems name the thing that is missing and the command
  that fixes it. Verified on the development machine; the microphone half needs a human to grant
  the permission, so it is not covered by an automated check.
- **Not working yet:** the agent. Iteration 1 stops at the transcript on screen, deliberately —
  holding and speaking works, but nothing is asked of `claude -p` and nothing is written to
  `notes/` yet.
- **Cut, and what that stops catching:** this delivery is a **development build** — there is
  no packaged `.app`, no signing and no CI/CD; see [`docs/PLAN.md`](docs/PLAN.md) §13 and the
  future-work table at the end of [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md). Nothing
  in the repository exercises a packaged artifact, so defects that only appear there have no
  gate at all, and neither does any UI appearance regression. The one end-to-end launch that
  closes the "nothing executes in the renderer" gap is subtask S10, in the next iteration; until
  it lands, the renderer's only automated gate is a static check on the built bundle. That gate
  exists because it already caught a real defect: the audio worklet was being inlined as a
  `data:` URL, which the app's own CSP refuses — invisible in `npm run dev`, fatal in a build.
- **Time actually spent:** tracked and reported honestly at the end. A truthful four hours beats
  a claimed ninety minutes.

---

## Third-party software and licences

VoiceDesk is built on other people's work. The permissive licences below (MIT, Apache-2.0,
BSD) require their copyright and permission notices to travel with any distribution, so the
list is reproduced here and, once built, inside the app under **About → Credits**.

### Shipped inside the application

These are bundled into the built app, so their notices are legally required to accompany it.

| component | version | licence |
|---|---|---|
| [Electron](https://github.com/electron/electron) | 44.2.0 | MIT |
| [Chromium](https://www.chromium.org/) *(inside Electron)* | as bundled by Electron 44 | BSD-3-Clause + the licences listed in Electron's `LICENSES.chromium.html` |
| [Node.js](https://nodejs.org) *(inside Electron)* | as bundled by Electron 44 | MIT |
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

VoiceDesk itself: to be decided before the first release.
