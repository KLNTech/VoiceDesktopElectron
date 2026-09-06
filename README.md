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
| **UI design** | brief written ([`docs/design/DESIGN-BRIEF.md`](docs/design/DESIGN-BRIEF.md)); canvas not yet filled in |
| **Application code** | **not written yet** |

Nothing below the *Requirements* heading has been executed end to end, because there is nothing
to execute yet. Each step is marked ✅ where it has been verified on the development machine and
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
| A coding-agent CLI | see step 4 | the app drives an agent CLI, not a model API |
| A microphone | — | built-in is fine |

No API key is needed for speech-to-text: transcription runs locally.

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

### 4 · A coding-agent CLI ✅

VoiceDesk drives a coding agent through its command line. Install **one**:

```bash
# Claude Code — the default this repo is built and tested against
curl -fsSL https://claude.ai/install.sh | bash
claude --version
```

`codex exec` and `cursor-agent -p` are supported by the same seam but ship as a second adapter;
the default adapter is Claude Code, tested against **2.1.263**.

> **If the app cannot find it:** an app launched from Finder gets a minimal `PATH` that does not
> include `~/.local/bin` or `/opt/homebrew/bin`. Set `VOICEDESK_AGENT_BIN` to the absolute path
> (`which claude` in a terminal, or `~/.local/bin/claude`) and the app will use it directly.

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

- **Works:** —
- **Cut, and what that stops catching:** this delivery is a **development build** — there is
  no packaged `.app`, no signing and no CI/CD; see [`docs/PLAN.md`](docs/PLAN.md) §13 and the
  future-work table at the end of [`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md). Nothing
  in the repository exercises a packaged artifact, so defects that only appear there have no
  gate at all, and neither does any UI appearance regression. One Playwright launch is kept
  deliberately, so "nothing executes in the renderer" is *not* among the gaps.
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
| [Vite](https://github.com/vitejs/vite) | 8.2.2 | MIT |
| [electron-vite](https://github.com/alex8088/electron-vite) | 5.0.0 | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 6.1.1 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0.0 | MIT |
| [Playwright](https://github.com/microsoft/playwright) | 1.63.0 | Apache-2.0 |
| [Testing Library](https://github.com/testing-library/react-testing-library) | 16.3.3 | MIT |
| [jsdom](https://github.com/jsdom/jsdom) | 30.0.1 | MIT |

**Not used, on purpose:** `ffmpeg` is GPL-3.0-or-later. `whisper-cli` decodes WAV itself, so the
app captures raw microphone samples and writes the WAV header in a few lines rather than
recording a compressed format and transcoding it. Every dependency in this project is therefore
permissively licensed.

Exact versions are pinned in `package-lock.json`, which is the authoritative list; this table is
the human-readable copy of it and is regenerated whenever a dependency changes.

---

## Not in this delivery

Named here so nobody goes looking: there is **no packaged `.app` or `.dmg`, no code signing
or notarisation, and no CI/CD pipeline**. The delivery is the development build described
above. The full list, with the reason for each, is the future-work table at the end of
[`docs/WORK-BREAKDOWN.md`](docs/WORK-BREAKDOWN.md).

---

## Licence

VoiceDesk itself: to be decided before the first release.
