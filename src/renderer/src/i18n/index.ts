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
 */
export function t(key: MessageKey): string {
  return en[key]
}
