import { z } from 'zod'

/**
 * The model tiers this app will pass to `claude --model`, as a closed set.
 *
 * Before this existed the tier was a bare string — `env['VOICEDESK_AGENT_MODEL'] ?? 'haiku'` —
 * and a string has two defects here that an enumeration does not. It is not enumerable, so
 * nothing in the app could answer "what may I set this to?"; and it is not checkable, so
 * `VOICEDESK_AGENT_MODEL=hiaku` reached `--model` untouched and came back as an *agent failure*
 * — the CLI rejecting an unknown model — when the actual fault is a typo in a configuration
 * value. That is precisely the collapsing of distinguishable outcomes `docs/PLAN.md` §5.6
 * refuses everywhere else: it sends the operator to debug the agent instead of their own env.
 *
 * **Aliases, never dated snapshots.** Each member is the CLI's tier alias. An alias cannot
 * resolve to a tier above the one it names, it follows its tier as the tier moves, and it
 * outlives the retirement of any one snapshot (`docs/PLAN.md` §5.2). What actually ran is a
 * different question with a different answer — the reply envelope's `modelUsage` — and
 * `AgentReply.model` carries that, so "which tier did you ask for" and "which model answered"
 * never share a variable.
 */
export enum AgentModel {
  /** The cheapest current tier. The default, and the only one this delivery is exercised on. */
  Haiku = 'haiku',
  /** The middle tier. Reachable by configuration; nothing in the app selects it by itself. */
  Sonnet = 'sonnet',
  /** The most capable and most expensive tier. Opt-in, and opt-in only. */
  Opus = 'opus',
}

/**
 * Haiku, and the reason is cost rather than taste.
 *
 * This is a demonstration build, and a demo that quietly reaches for an expensive tier bills
 * someone for a decision nobody made. At list rates Haiku 4.5 is $1/$5 per million input/output
 * tokens against Opus 5's $5/$25 — five times cheaper on both halves. The other two members
 * above exist so that raising the tier is a deliberate act an operator performs, which is what
 * `docs/WORK-BREAKDOWN.md` F9 promises; nothing in this delivery raises it by itself.
 */
export const DEFAULT_AGENT_MODEL = AgentModel.Haiku

/** The legal values, in tier order. Used to tell a misconfigured operator what to type. */
export const AGENT_MODELS: readonly AgentModel[] = Object.values(AgentModel)

/**
 * Parsed at the boundary, never cast — an environment variable is caller-supplied text, and
 * `as AgentModel` would be a claim about a string the compiler cannot check.
 */
export const AgentModelSchema = z.enum(AgentModel)
