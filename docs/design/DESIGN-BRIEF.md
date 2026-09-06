# VoiceDesk — design brief

A self-contained brief for generating the UI. It is written to be handed over whole: everything
needed to design the app is below, including the exact copy. Nothing here needs the source code.

**Canvas:** <https://claude.ai/design/p/e16f45ae-f5bd-4c22-9187-7df8dff8ed69> — the target this
brief is rendered into. Empty scaffold as of 2026-09-06; nothing in the implementation derives
from it until it is filled in and approved.

Source of truth for behaviour: `docs/PLAN.md`. Where the two disagree, the plan wins and this
file gets corrected.

---

## 1. The product in one paragraph

A small macOS desktop window with one control. The user **holds** a button (or the `Space` key
while the window is focused), speaks, and releases. Their words appear as text. The text goes to
a coding agent that reads and writes Markdown files in a `notes/` folder, and the agent's reply
appears in the window. *"Add milk to my shopping list"* edits `notes/shopping.md`; *"what's on my
list?"* answers from it.

It is not a chat app. One turn at a time, one screen, no navigation.

---

## 2. What to design

**One window, eight artboards** — the same window in each of its states. This is a state
machine with a face, so the deliverable is the set of faces, not a set of pages.

| # | artboard | what it must show |
|---|---|---|
| 1 | **Idle** | the hold-to-talk control at rest; the keyboard hint; the last completed turn still visible below (or the empty state if there is none) |
| 2 | **Recording** | the control held down; a **live level meter** responding to the voice; elapsed seconds; an unmistakable "the microphone is on" signal |
| 3 | **Transcribing** | the hold has ended, speech is being turned into text; a short determinate-feeling wait |
| 4 | **Thinking** | the transcript is on screen as the user's turn; the agent is working; the wait here is the longest (seconds to a minute) and needs to feel bounded, not hung |
| 5 | **Reply** | the agent's answer, plus which note files it touched, plus a control to hear it spoken |
| 6 | **Error** | four distinct failures, designed as one layout with different content — see §5. The design must make the difference between "you need to fix your setup" and "the agent failed" obvious at a glance |
| 7 | **First run** | never used before: no turns yet, microphone permission not yet granted, an explanation of what the app will do with the folder it writes to |
| 8 | **About / credits** | version, the licences of everything bundled — see §7 |

Also specify, as part of the design and not as an afterthought: the **empty state** (artboard 1
with no history) and the **version badge** (§6).

---

## 3. Window, layout, platform

- **macOS.** It should look like it belongs on the OS, not like a web page in a frame.
- **Default size 480 × 720**, resizable, minimum 380 × 520. A single column. The design must
  survive being made narrow and tall.
- Light **and** dark, both first-class. Follow the system setting.
- System font stack (`-apple-system`, `SF Pro`). No web fonts.
- The window content is one vertical stack: header (title + version badge) · turn history
  (scrollable) · current turn · the talk control pinned to the bottom.
- The talk control is the largest thing on screen. Everything else defers to it.

## 4. The talk control — the one component that matters

It must communicate three things without a label: that it is **held, not clicked**; that the
microphone is **live right now**; and how loud the user is.

- at rest: an inviting, obviously-pressable target with the copy `Hold to talk` and the hint
  `or hold Space`;
- held: visibly depressed/active, with a **level meter** driven by real microphone amplitude —
  design the meter as part of the button, not as a separate widget. This meter is the only
  evidence the user has that the app is hearing them;
- a hold shorter than 250 ms is discarded by the app; design a brief, non-alarming acknowledgement
  for that case (`Too short — hold and speak`);
- the release → transcribing transition should read as continuous, not as a page change.

## 5. The four failures

One layout, four contents. Each needs its own icon/colour treatment and its own action.

| failure | headline | body | action |
|---|---|---|---|
| microphone denied | `Microphone access is off` | `VoiceDesk needs the microphone to hear you. Turn it on in System Settings → Privacy & Security → Microphone.` | `Open System Settings` |
| setup incomplete | `<tool> was not found` | `VoiceDesk needs it to <transcribe your voice / reach the agent>. See the README for the one-line install.` | `Copy install command` |
| agent failed | `The agent could not finish` | the trimmed error text from the agent, in a monospace block | `Try again` |
| timed out | `That took too long` | `The agent did not answer within 90 seconds and was stopped.` | `Try again` |

The first two are **the user's machine**; the last two are **this turn**. That distinction is the
point of the screen — design it so nobody debugs the wrong thing.

## 6. Version badge

A small, permanent `v0.1.0 · dev` marker in the header, quiet enough to ignore and legible
enough to read across a desk. It exists so that during manual testing it is obvious at a glance
whether the running build is the one just changed.

## 7. About / credits panel

Legally required, so it is a designed surface rather than a text dump: the app bundles
open-source components whose licences require their notices to travel with it. The panel needs a
readable list of **name · version · licence**, scrollable, with the full licence text reachable.
Design it as a sheet over the main window, not as a second window.

## 8. Copy

All strings are English, and English is the only language this build ships. They go through
one lookup table, so keep them short and self-contained — a second language should later cost
a file, not a redesign. **Do not design a language switcher**: there is nothing to switch
between. Use exactly the copy in §4–§7; where a string is missing, propose one and mark it as
proposed.

## 9. Constraints and non-goals

- **No settings screen.** Configuration is environment variables and a file, deliberately.
- **No conversation UI.** History is the last few turns, plain, not a chat transcript with
  avatars.
- **No animation that delays interaction.** The waits in states 3 and 4 are real; make them
  legible, do not stretch them for effect.
- **Nothing that implies the app edits notes itself.** Every file change is the agent's. If the
  design shows touched files, it shows them as *what the agent did*.
- Contrast must hold in both themes; the level meter must not be the only cue that recording is
  live (colour-blind and low-vision users get the state from shape and text too).

## 10. Deliverable

A multi-artboard canvas, one artboard per row in §2, laid out left to right in turn order with
the error and about states below. Include the light and dark treatment of at least artboards 1,
2 and 5. Name each artboard after its state (`idle`, `recording`, `transcribing`, `thinking`,
`reply`, `error/*`, `first-run`, `about`) so the implementation can be checked against it
state by state.
