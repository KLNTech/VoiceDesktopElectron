/**
 * Which voice `say` should read the reply in — decided here, never left to the system default.
 *
 * ## The defect this file exists for
 *
 * `say` was invoked as `say -- <text>`, with no voice. With no `-v`, macOS reads in the voice of
 * the **system language**, and on a Polish-language Mac that is a Polish voice. Every reply the
 * agent wrote — in English, from an English-only model, transcribed by an English-only Whisper
 * (`-l en`) — came out phoneme by phoneme as Polish. It is not an accent. English read with
 * Polish grapheme rules is not English that sounds foreign; it is not English.
 *
 * Nothing about the app was localised: `src/renderer/src/i18n/` holds one file, `en.json`. The
 * spoken half was the only part of the product that followed the operating system's language
 * instead of the product's, and it did so silently, on a machine where every other signal was
 * green.
 *
 * ## Why an allow-list and not "the first `en_*` voice"
 *
 * `say -v '?'` on a stock macOS lists two dozen `en_US` entries, and most of them are novelty
 * voices — a sheep, a church organ, a robot. "Take the first English voice" picks `Albert`,
 * which is one of those. So the choice runs down a list of the voices Apple actually ships as
 * speech voices, in order, and takes the first one installed.
 */

/** One row of `say -v '?'`: a name, which may contain spaces, and a BCP-47-ish locale. */
export interface Voice {
  readonly name: string
  readonly locale: string
}

/**
 * The standard system voices, best first. Regional English follows US English, because a
 * British or Australian voice reading American text is a preference; a Polish one is a defect.
 *
 * `Samantha` has been the stock `en_US` voice on every macOS this app supports. The list is
 * longer than it needs to be on any one machine on purpose: it is what makes the fallback below
 * — the system default, i.e. the bug — genuinely unreachable in practice rather than merely
 * unlikely.
 */
const PREFERRED = [
  'Samantha',
  'Alex',
  'Ava',
  'Allison',
  'Susan',
  'Tom',
  'Daniel',
  'Karen',
  'Moira',
  'Tessa',
  'Rishi',
] as const

/**
 * Parses the listing `say -v '?'` prints.
 *
 * The format is `<name> <locale>    # <sample sentence>`, and the split is anchored on the
 * COMMENT, which is the only part of a row whose position is reliable. Two easier readings both
 * fail against the real listing on this machine, where 112 of 184 rows look like
 * `Eddy (Angielski (USA)) en_US    # Hello! My name is Eddy.`:
 *
 *   - splitting on whitespace turns `Bad News` into the voice `Bad` in the locale `News`;
 *   - requiring two spaces before the locale — the column padding — drops every row whose name
 *     is long enough to eat the padding, which is most of the multilingual voices.
 *
 * Those parenthesised language names are themselves in the SYSTEM language: on the development
 * machine they read `Angielski (USA)`, not `English (US)`. Nothing here may depend on their
 * text, which is the second reason the anchor is the `#` and the locale code beside it.
 */
export function parseVoices(listing: string): Voice[] {
  // The region may be a UN M.49 NUMBER rather than letters: the real listing on this machine
  // carries `ar_001` — Arabic, "World" — and a letters-only region silently dropped that row.
  const row = /^(.+?)\s+([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?)\s+#/
  return listing
    .split('\n')
    .map((line) => row.exec(line.trimEnd()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[1]?.trim() ?? '', locale: match[2] ?? '' }))
    .filter((voice) => voice.name !== '')
}

/**
 * The voice to pass to `say -v`, or `null` to say nothing about it and take the system default.
 *
 * `null` is the honest answer when this machine has no English voice at all: reading the reply
 * in the wrong language still beats not reading it, and `speak` is a stretch goal whose failure
 * is never a failed turn. It is the branch the list above is sized to avoid.
 */
export function chooseVoice(voices: readonly Voice[], override: string | undefined): string | null {
  // An explicit choice is honoured verbatim, INCLUDING a non-English one: an operator who names
  // a voice has said something this file has no better information than.
  if (override !== undefined && override !== '') {
    const named = voices.find((voice) => voice.name.toLowerCase() === override.toLowerCase())
    return named?.name ?? override
  }

  const installed = new Map(voices.map((voice) => [voice.name.toLowerCase(), voice] as const))
  for (const candidate of PREFERRED) {
    const found = installed.get(candidate.toLowerCase())
    if (found !== undefined && isEnglish(found.locale)) return found.name
  }
  return null
}

/** `en`, `en_US`, `en-GB` — the language subtag is the whole question. */
function isEnglish(locale: string): boolean {
  return locale.toLowerCase().split(/[-_]/)[0] === 'en'
}
