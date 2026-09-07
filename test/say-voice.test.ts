import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { chooseVoice, parseVoices } from '../src/infrastructure/speak/voice'

/**
 * The reply is read in English, on a Mac whose system language is not English.
 *
 * The defect: `say` was called with no `-v`, so macOS read in the voice of the SYSTEM language.
 * On a Polish-language Mac — `AppleLanguages = (pl-PL)`, `LANG=pl_PL.UTF-8`, verified on the
 * development machine — every reply came out in Polish phonemes. English read by a Polish voice
 * is not English with an accent; the grapheme rules are different and the words are not the
 * words. Meanwhile the model is English-only, Whisper is invoked `-l en`, and `i18n/` holds one
 * file called `en.json`: the spoken half was the only part of the product that took its language
 * from the operating system instead of from the product.
 */
const listing = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Alice               it_IT    # Ciao! Mi chiamo Alice.',
  'Bad News            en_US    # Hello! My name is Bad News.',
  'Daniel              en_GB    # Hello! My name is Daniel.',
  'Samantha            en_US    # Hello! My name is Samantha.',
  'Zosia               pl_PL    # Witaj, nazywam się Zosia.',
].join('\n')

describe('parsing what `say -v ?` prints', () => {
  it('reads the name and the locale off each row', () => {
    expect(parseVoices(listing)).toContainEqual({ name: 'Samantha', locale: 'en_US' })
    expect(parseVoices(listing)).toContainEqual({ name: 'Zosia', locale: 'pl_PL' })
  })

  it('keeps a name that contains spaces whole', () => {
    // Split on whitespace and `Bad News` becomes the voice `Bad` in the locale `News`.
    expect(parseVoices(listing)).toContainEqual({ name: 'Bad News', locale: 'en_US' })
  })

  it('ignores lines that are not voice rows', () => {
    expect(parseVoices('\n   \nnot a row\n')).toEqual([])
  })
})

describe('choosing the voice', () => {
  const voices = parseVoices(listing)

  it('reads English on a Polish machine', () => {
    const chosen = chooseVoice(voices, undefined)
    expect(chosen).not.toBeNull()
    expect(voices.find((voice) => voice.name === chosen)?.locale).toMatch(/^en/)
  })

  it('prefers a standard voice over a novelty one', () => {
    // `Albert` and `Bad News` are both `en_US` and both come alphabetically before `Samantha`,
    // so "the first English voice" would pick a joke voice on a stock macOS.
    expect(chooseVoice(voices, undefined)).toBe('Samantha')
  })

  it('honours an operator naming a voice, whatever its language', () => {
    expect(chooseVoice(voices, 'Zosia')).toBe('Zosia')
  })

  it('matches an override case-insensitively but passes the real name', () => {
    expect(chooseVoice(voices, 'daniel')).toBe('Daniel')
  })

  it('passes an override through even when this machine has never heard of it', () => {
    // So `say` reports the unknown voice by name, instead of this file silently ignoring the
    // one instruction it was given.
    expect(chooseVoice(voices, 'Vocalizer Pro')).toBe('Vocalizer Pro')
  })

  it('falls back to the system voice when no English voice is installed', () => {
    // The bug, deliberately: still speaking in the wrong language beats not speaking at all,
    // and this is the branch the preference list is sized to keep unreachable.
    expect(chooseVoice(parseVoices('Zosia               pl_PL    # Witaj.'), undefined)).toBeNull()
  })

  it('is not fooled by a locale that merely starts with the letters e and n', () => {
    const eo = parseVoices('Enrique             en-US    # Hi.\nEsperanto           eno_XX    # Saluton.')
    expect(chooseVoice([...eo, { name: 'Samantha', locale: 'eno_XX' }], undefined)).toBeNull()
  })
})

/**
 * The parser, against the real thing.
 *
 * Everything above is a fixture I wrote, so everything above is a test of my own idea of the
 * format. This one asks the binary that will actually be spawned, on the machine the app runs
 * on — the only check that reddens if Apple changes the layout of that listing.
 */
describe('against the real `say` on this machine', () => {
  const listed = execFileSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8', timeout: 10_000 })
  const voices = parseVoices(listed)

  it('parses every row the binary printed', () => {
    const rows = listed.split('\n').filter((line) => line.trim() !== '').length
    expect(voices).toHaveLength(rows)
  })

  it('finds an English voice to read the reply in', () => {
    const chosen = chooseVoice(voices, undefined)
    expect(chosen).not.toBeNull()
    expect(voices.find((voice) => voice.name === chosen)?.locale).toMatch(/^en/)
  })
})
