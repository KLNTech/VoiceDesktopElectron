# VoiceDeskElectron — design brief

A self-contained brief for the UI. It is written to be handed over whole: everything needed to
build the app's face is below, including the copy. Nothing here needs the source code.

**Canvas:** <https://claude.ai/design/p/e16f45ae-f5bd-4c22-9187-7df8dff8ed69> — the design
project *Voice Desktop*. The canvas exists. This brief was rewritten to **describe** it rather
than to commission it; where the two disagreed, the canvas was treated as the fact and this file
as the thing that had drifted.

**Design version: `0.3.1`.** That number lives in `VERSION.md` inside the design project and is
the single source of truth for it. It is quoted here once, in this paragraph, so a reader knows
which canvas this brief describes — and it is deliberately not repeated anywhere else in this
repository, because a second copy is a second thing to forget to update. The number rendered *in
the window* (§6) is the **app** version and moves for entirely different reasons.

### Which document wins

| the question | the authority |
|---|---|
| what happens when the user does something — what the app spawns, validates, times out on, or writes | **`docs/PLAN.md`** |
| what the window looks like — layout, size, states, colour, type, iconography, the artboard set | **the canvas** (`Voice Desktop.dc.html`, design `0.3.1`) |
| why the surface is shaped this way, and what each string has to accomplish | **this file**, corrected whenever either of the other two moves |

The split is load-bearing, so it is stated rather than left to taste. Where the canvas implies
behaviour the plan does not sanction, **the plan wins** and the canvas is re-rendered. Where the
plan describes an appearance the canvas contradicts, **the canvas wins** and the plan's prose is
corrected. Neither is quietly reconciled inside this file: the divergences that are currently
open are listed in §12.

> **Provenance of this revision.** §2, §3, §5, §6, §10, §11 and §12 were rewritten against
> `VERSION.md` in the design project, read verbatim, and against `docs/PLAN.md`. The canvas file
> itself — `Voice Desktop.dc.html` — was **not** read during this revision, because the tool that
> reaches the design project was not available to the session that made it. Every statement below
> is therefore sourced from `VERSION.md`, from `docs/PLAN.md`, or carried forward from the
> previous revision of this brief. The details that only the canvas can settle are listed in §12
> as open, not guessed at.

---

## 1. The product in one paragraph

A small macOS desktop window with one control. The user **holds** a button (or the `Space` key
while the window is focused), speaks, and releases. Their words appear as text. The text goes to
a coding agent that reads and writes Markdown files in a `notes/` folder, and the agent's reply
appears in the window. *"Add milk to my shopping list"* edits `notes/shopping.md`; *"what's on my
list?"* answers from it. Beside the turn, the window keeps a standing list of those files, so the
evidence of what the agent did outlives the reply that scrolled away.

It is not a chat app. One turn at a time, one window, no navigation.

---

## 2. The artboard set

**One window, fifteen artboards** — the same window in each of its states, plus its dark
treatment. This is a state machine with a face, so the deliverable is the set of faces, not a set
of pages. The canvas groups them A–D.

| group | artboard | what it must show |
|---|---|---|
| A | **`idle`** | the hold-to-talk control at rest; the keyboard affordance; the last completed turn still visible. This is artboard 01 and it is **live** on the canvas — see §4 |
| A | **`idle-empty`** | the same window with no turns yet: the empty state, designed rather than left over |
| A | **`recording`** | the control held down; a **live level meter** responding to the voice; elapsed seconds; an unmistakable "the microphone is on" signal |
| A | **`transcribing`** | the hold has ended, speech is being turned into text; a short determinate-feeling wait |
| A | **`thinking`** | the transcript is on screen as the user's turn; the agent is working; the wait here is the longest (seconds to a minute) and needs to feel bounded, not hung |
| A | **`reply`** | the agent's answer, the note files it touched, and a control to hear it spoken |
| B | four **failure** artboards | one per row of §5 — one layout, four contents, each carrying its error code. The design must make the difference between "you need to fix your setup" and "the agent failed" obvious at a glance |
| C | **`first-run`** | never used before: no turns yet, microphone permission not yet granted, an explanation of what the app will do with the folder it writes to |
| C | **`about`** | version, and the licences of everything bundled — see §7 |
| D | three **dark** artboards | the dark treatment of `idle`, `recording` and `reply` |

The names in group A and group C are the ones `VERSION.md` states. The names of the four failure
artboards and the exact name form of the three dark ones are on the canvas and are recorded as
open in §12; nothing in this file should be read as asserting them.

Dark is not a variant of the deliverable — it has its own artboards, and §3 treats it as
first-class.

---

## 3. Window, layout, platform

- **macOS.** It should look like it belongs on the OS, not like a web page in a frame.
- **Default size 800 × 720**, resizable, **two panels**.
- The canvas states no minimum size that this revision was able to read. The repository currently
  uses **720 × 560** (`src/main/window.ts`) — a repo-side decision taken to keep both panels
  usable, not a measurement taken from the design. If the canvas states a minimum, it wins (§12).
- Light **and** dark, both first-class. Follow the system setting. Group D of §2 is the dark
  treatment as drawn, not as inferred.
- Type, colour and spacing come from the **bound design system** (§11), not from values invented
  here. The constraints this brief keeps are that the result must read as a macOS window and that
  no font is fetched over the network.

### The two panels

**Left — the notes.** The list of `.md` files in `notes/`. Each row carries one of three markers:

`EDITED` · `READING` · `UNCHANGED`

and the panel has a footer stating that the agent writes these files and VoiceDeskElectron does not. This
panel is the durable evidence of the thing being demonstrated: the reply scrolls away, the file
list does not. It is also the visible form of the constraint in §9 — the app shows what the agent
did to the folder, and never presents itself as the author.

**Right — the turn.** The exchange with the agent and the hold-to-talk control (§4). Every state
in §2 plays out here; the left panel changes only as a consequence of a turn.

The talk control is the largest thing in the right panel. Everything else defers to it.

### The title bar

It carries two read-only readouts and no controls:

- the **CLI model readout** — a cpu icon and the model the agent CLI was invoked with, rendered
  in the form `CLI model · <model>`, present on all fifteen artboards. It is read-only *because*
  §9 forbids a settings screen: the app states what it is using and offers no way to change it
  from the window. Its value must be **whatever the app actually invoked**, read back from the
  run, never a string typed into the UI. The canvas's rendered value and the model the app is
  pinned to currently differ — see §12, which is the one divergence a reader of this file must
  not miss;
- the **version badge** (§6).

---

## 4. The talk control — the one component that matters

It must communicate three things without a label: that it is **held, not clicked**; that the
microphone is **live right now**; and how loud the user is.

- at rest: an inviting, obviously-pressable target with the copy `Hold to talk` and the keyboard
  affordance, which the canvas renders as `⎵ Space`;
- held: visibly depressed/active, with a **level meter** driven by real microphone amplitude —
  the meter is part of the button, not a separate widget beside it. This meter is the only
  evidence the user has that the app is hearing them;
- a hold shorter than **250 ms** is discarded by the app (`docs/PLAN.md` §2); design a brief,
  non-alarming acknowledgement for that case (`Too short — hold and speak`);
- the release → transcribing transition should read as continuous, not as a page change.

Artboard `idle` (01) is **live on the canvas**: holding the control there, or pressing `Space`,
drives a real microphone level meter, with a fallback to a simulated one where the microphone is
unavailable. That is a property of the canvas as a prototype. The application has the real
microphone and needs no fallback of that kind.

---

## 5. The four failures

One layout, four contents. Each needs its own icon and colour treatment, its own action, and its
own error code.

| failure | headline | body | action |
|---|---|---|---|
| microphone denied | `Microphone access is off` | `VoiceDeskElectron needs the microphone to hear you. Turn it on in System Settings → Privacy & Security → Microphone.` | `Open System Settings` |
| setup incomplete | `<tool> was not found` | `VoiceDeskElectron needs it to <transcribe your voice / reach the agent>. See the README for the one-line install.` | `Copy install command` |
| agent failed | `The agent could not finish` | the trimmed error text from the agent, in a monospace block | `Try again` |
| timed out | `That took too long` | `The agent did not answer within 90 seconds and was stopped.` | `Try again` |

The first two are **the user's machine**; the last two are **this turn**. That distinction is the
point of the screen — design it so nobody debugs the wrong thing.

**Error codes.** The design project keeps a registry of error codes, and four are registered for
these four failures:

`1001` · `1101` · `1201` · `1211`

Each failure artboard carries its code, which is what lets an implementation be checked against
the design failure by failure rather than screen by screen. **Which code belongs to which row is
recorded on the canvas and in the design project's registry, and is not asserted here** (§12) —
in particular, the order of the table above is not a mapping. The implementation takes the
mapping from the canvas.

The headlines, body copy and action labels above are carried forward from the previous revision
of this brief. Where the canvas renders different strings, the canvas wins and this table is
corrected (§12).

`docs/PLAN.md` §7 declares **five** failure kinds, not four: `mic-denied`, `setup`,
`agent-failed`, `timeout` and `empty-speech`. Four have artboards. Whether `empty-speech` is meant
to be covered by §4's short-hold acknowledgement or needs a surface of its own is open (§12).

---

## 6. Version badge

A small, permanent `v<version> · dev` marker in the title bar (the number comes from
`package.json`; the canvas artboards render whatever was current when they were drawn), quiet enough to ignore and legible
enough to read across a desk. It exists so that during manual testing it is obvious at a glance
whether the running build is the one just changed.

It is the **app** version — the `version` field of `package.json` (`docs/PLAN.md` §9) — and is
deliberately decoupled from the design version in the header of this file. The two move for
different reasons, and rendering either one in place of the other is a defect, not a shortcut.

---

## 7. About / credits panel

Legally required, so it is a designed surface rather than a text dump: the app bundles
open-source components whose licences require their notices to travel with it. The panel needs a
readable list of **name · version · licence**, scrollable, with the full licence text reachable.
Design it as a sheet over the main window, not as a second window.

---

## 8. Copy

All strings are English, and English is the only language this build ships. They go through one
lookup table, so keep them short and self-contained — a second language should later cost a file,
not a redesign. **Do not design a language switcher**: there is nothing to switch between. Use
exactly the copy in §3–§7; where a string is missing, propose one and mark it as proposed.

This file is the authority on what a string has to accomplish. The canvas is the authority on the
string as rendered.

---

## 9. Constraints and non-goals

- **No settings screen.** Configuration is environment variables and a file, deliberately. This
  is why the model readout in the title bar (§3) is a readout and not a control.
- **No conversation UI.** History is the last few turns, plain, not a chat transcript with
  avatars.
- **No animation that delays interaction.** The waits in `transcribing` and `thinking` are real;
  make them legible, do not stretch them for effect.
- **Nothing that implies the app edits notes itself.** Every file change is the agent's. The left
  panel (§3) shows the `notes/` folder as *what the agent did*, and says so in its footer.
- Contrast must hold in both themes; the level meter must not be the only cue that recording is
  live (colour-blind and low-vision users get the state from shape and text too).

---

## 10. Deliverable

One multi-artboard canvas — `Voice Desktop.dc.html`, in the root of the design project, alongside
`VERSION.md` and `state-roles.css`. Fifteen artboards, in the four groups of §2: the turn (A), the
failures (B), setup and legal (C), and dark (D). `.snapshots/` holds dated copies of the whole
set; the file in the root is the live one.

Each artboard is named after its state, so the implementation can be checked against it state by
state rather than by eye. `VERSION.md` states these names: `idle`, `idle-empty`, `recording`,
`transcribing`, `thinking`, `reply`, `first-run`, `about`. The names of the four failure artboards
and the three dark ones are on the canvas (§12).

---

## 11. Design system binding

The canvas is not drawn from scratch. It is built in **TRYB A** — mode A — on a bound design
system called **Industry_indust**: the design *consumes* that system's tokens and components, and
the only layer the design itself owns is `state-roles.css`.

For the implementation this means: **take the values, do not invent them.** Colour, type, spacing
and component shape arrive through the canvas from the bound system. A value that appears nowhere
in the canvas is not a value this app gets to choose locally; something missing is raised against
the design rather than filled in with a plausible number.

**State roles.** `state-roles.css` defines four role tokens — aliases onto the bound system's
tokens — one per phase of the session:

| token | phase |
|---|---|
| `--state-idle` | at rest; nothing is running |
| `--state-listening` | the microphone is open |
| `--state-thinking` | a wait the user cannot shorten |
| `--state-error` | the turn failed (§5) |

These four do not map one-to-one onto the turn states of `docs/PLAN.md` §2, which are six. How
the two waits and `speaking` draw their colour is settled on the canvas (§12). The implementation
renders session state **through these roles**, not through literal colours, so that a change in
the design is a change to one alias rather than a search through the stylesheet.

The dark theme lives in the same file, built from existing steps of the bound system's ramps
rather than from new colours. That is why dark is a set of artboards (§2, group D) and not a
filter applied at the end.

---

## 12. Open items and known divergences

### The model readout, which is not resolved here

The canvas renders the title-bar readout as `CLI model · claude-sonnet-4-5` (design `0.3.1`, on
all fifteen artboards). The application is pinned to Haiku: `docs/PLAN.md` §5.2 passes
`--model haiku`, and §14 records that as a deliberate decision for a demonstration build — an
alias that "cannot resolve to an Opus-tier model", resolving today to `claude-haiku-4-5`.

So the canvas shows one model and the app runs another. Applying the rule from the header of this
file — the plan wins on behaviour — the consequences are:

- the readout must display **the model the app actually invoked**, read back from the run.
  `docs/PLAN.md` §5.2 records that the CLI's JSON envelope carries `modelUsage` keyed by the model
  that actually ran, with a `canonicalModel` field, so the value is available and does not have to
  be assumed;
- nothing in the implementation should be built to match the literal string on the canvas, and the
  string must not be hard-coded in the UI in either form;
- `claude-sonnet-4-5` is therefore **stale artboard copy on all fifteen artboards** and needs
  re-rendering by whoever owns the canvas. This file does not rewrite it, because a brief that
  quietly reports a design as saying something it does not say is worse than a design that is out
  of date.

### Items this revision could not verify

Each is settled by reading `Voice Desktop.dc.html`. Until then this file states no value for them:

- the names of the four failure artboards, and which of `1001` / `1101` / `1201` / `1211` belongs
  to which failure;
- whether the canvas's failure headlines, body copy and action labels match the table in §5;
- the exact name form of the three dark artboards;
- whether the canvas states a **minimum** window size, and whether it agrees with the 720 × 560
  the repository currently uses (§3);
- the English wording of the left panel's footer (§3);
- whether `empty-speech`, the fifth failure kind in `docs/PLAN.md` §7, has a designed surface;
- how `--state-thinking` and the `speaking` state are drawn (§11).

### Behaviour the canvas needs and the plan does not yet describe

The left panel (§3) asks for two things the plan's IPC contract does not currently provide:

- an enumeration of `notes/*.md` **at rest** — before a turn, and between turns. `docs/PLAN.md`
  §7 declares channels for transcribe, ask, speak, app info and turn state; none of them lists the
  notes folder;
- a **per-file distinction between read and written**. `AskRes` carries `notes: z.array(z.string())`,
  a flat list of names, which cannot separate `EDITED` from `READING` and says nothing about the
  `UNCHANGED` files that make up most of the panel.

This is a behavioural gap rather than a visual one, so by the rule in the header it is settled in
`docs/PLAN.md` first and reflected here afterwards. It is recorded in this file because the design
depends on it.
