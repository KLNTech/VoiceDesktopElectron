import en from './en.json'

/**
 * Exactly one language ships, and it is English (`docs/PLAN.md` §10). What is built here is the
 * seam that makes a second language cheap — a JSON file and a switch — and nothing beyond it.
 * There is deliberately no language switcher, because there is nothing to switch between.
 */
export type MessageKey = keyof typeof en

/**
 * `MessageKey` is derived from the dictionary, so a typo in a key is a compile error and a
 * string that reaches the UI without an entry does not build.
 *
 * Placeholders are `{name}` and are substituted here rather than by concatenating at the call
 * site. That is the whole reason a lookup table beats string literals: a language that orders
 * the sentence differently reorders it in the JSON, and no caller has to change.
 */
export function t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const message: string = en[key]
  if (values === undefined) return message
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // An unknown placeholder is left visible rather than blanked: a missing value should look
    // wrong in the window, not read as a finished sentence with a hole in it.
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  )
}

/**
 * English plurals, in the one place the app needs them.
 *
 * Deliberately not a general pluralisation engine — that is the speculative version of this
 * function. It handles the single count this interface renders, and a language with more than
 * two forms gets a real rule when a second locale is actually added (§10).
 */
export function plural(count: number, one: MessageKey, many: MessageKey): string {
  return count === 1 ? t(one) : t(many, { n: count })
}
