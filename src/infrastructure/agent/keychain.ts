import { execFileSync } from 'node:child_process'

/**
 * The keychain item Claude Code's own login leaves behind: a generic password under this
 * service name in the user's login keychain. `docs/PLAN.md` §5.5.
 */
const SERVICE = 'Claude Code-credentials'

/**
 * Whether anyone has ever signed `claude` in on this machine.
 *
 * **This never reads the credential.** `security find-generic-password` without `-w` prints the
 * item's attributes and not its value, and the only thing consulted here is whether the lookup
 * succeeded. That is the entire point of §5.5: VoiceDesk passes no API key, reads no token, and
 * puts no secret in an argument or an environment variable, so "we mishandled a key" is not
 * among this application's failure modes at all. The credential belongs to Claude Code.
 *
 * It exists to separate one failure from another. A CLI that is installed, runs, and has never
 * been logged into fails every turn while nothing about this app is broken — and the fix is a
 * one-time `claude` in a terminal. Reported as an agent failure, that sends the user to debug
 * the wrong program, which is the mistake §5.6 exists to prevent.
 */
export function hasClaudeLogin(): boolean {
  try {
    execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE], {
      stdio: 'ignore',
      timeout: 5_000,
    })
    return true
  } catch {
    // Exit 44 is "item not found", which is the case this function is for. Every other failure
    // — no `security` binary, a locked keychain, a timeout — lands here too, and deliberately
    // reads the same way: the app cannot show that a login exists, so it says so rather than
    // spawning a turn that will fail later for a reason the user cannot see.
    return false
  }
}

/**
 * Signed in, unless the operator says otherwise.
 *
 * The preflight is macOS-specific and checks a keychain this app deliberately cannot read, so
 * there has to be a way past it: a CI machine authenticating by some other means, or a future
 * platform, would otherwise be told to run a login that would not help. It is an ESCAPE HATCH
 * and not a mode — nothing is disabled by taking it, the turn simply proceeds and any real
 * authentication problem then arrives as the agent failure it actually is.
 */
export function makeLoginCheck(skip: boolean): () => boolean {
  return skip ? () => true : hasClaudeLogin
}
