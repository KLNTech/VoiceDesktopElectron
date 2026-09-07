import { createRequire } from 'node:module'

import type { NoticeSchema } from '../../shared/ipc'

const require_ = createRequire(import.meta.url)

/**
 * The open-source notices the about sheet shows, built from what is ACTUALLY running.
 *
 * The design draws this table with versions on it, and a version typed into a UI is a legal
 * notice that goes stale the first time anything is upgraded — silently, because nothing checks
 * a string. So every row here has a live source: the runtime numbers come from
 * `process.versions`, which is Electron reporting itself, and the package numbers are read from
 * the installed packages' own manifests.
 *
 * `whisper.cpp` is deliberately absent for the same reason it is absent from `package.json`: it
 * is not bundled. It is installed by the user with Homebrew and its notices travel with that
 * install, not with this app.
 */
export function readNotices(): NoticeSchema[] {
  const rows: NoticeSchema[] = [
    { name: 'Electron', version: process.versions['electron'] ?? 'unknown', licence: 'MIT' },
    { name: 'Chromium', version: process.versions['chrome'] ?? 'unknown', licence: 'BSD-3-Clause' },
    { name: 'Node.js', version: process.versions.node, licence: 'MIT' },
    { name: 'V8', version: process.versions.v8, licence: 'BSD-3-Clause' },
  ]

  for (const [name, id, licence] of PACKAGES) {
    rows.push({ name, version: versionOf(id), licence })
  }
  return rows
}

/** name shown · package to read the version from · the licence that package declares. */
const PACKAGES: readonly (readonly [string, string, string])[] = [
  ['React', 'react/package.json', 'MIT'],
  ['Zod', 'zod/package.json', 'MIT'],
  ['Barlow · Barlow Condensed', '@fontsource/barlow/package.json', 'OFL-1.1'],
]

/**
 * Reads a package's own declared version, and says so when it cannot.
 *
 * `'not installed'` rather than a guess: this table's whole value is that it reports the truth,
 * and a plausible number in a licence notice is worse than an obvious gap.
 */
function versionOf(manifest: string): string {
  try {
    const pkg: unknown = require_(manifest)
    const version =
      typeof pkg === 'object' && pkg !== null && 'version' in pkg
        ? Reflect.get(pkg, 'version')
        : undefined
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'not installed'
  }
}
