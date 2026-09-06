import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Finds a program without trusting `PATH`.
 *
 * An Electron app launched from Finder inherits a minimal `PATH` that contains neither
 * `/opt/homebrew/bin` nor `~/.local/bin`, so a binary that works in the terminal is simply
 * missing inside the app (`docs/PLAN.md` §5.6). The order below is explicit: an operator's
 * override wins, then `PATH`, then the places these tools actually install to.
 */
export function resolveBinary(name: string, override: string | undefined): string | null {
  if (override !== undefined && override !== '') {
    return isExecutable(override) ? override : null
  }

  const fromPath = (process.env['PATH'] ?? '').split(delimiter).filter((entry) => entry !== '')
  const knownLocations = [
    '/opt/homebrew/bin', // Homebrew on Apple Silicon
    '/usr/local/bin', // Homebrew on Intel
    join(homedir(), '.local/bin'), // the Claude Code installer's default
    '/usr/bin',
  ]

  for (const directory of [...fromPath, ...knownLocations]) {
    const candidate = join(directory, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
