/*
 * "It runs on a clean machine following your README", as a CHECK rather than a claim.
 *
 * That sentence is the brief's acceptance criterion and it is the one thing a developer can
 * never test by running the project, because the machine they are testing on is the machine
 * that made it work. Every failure this catches is invisible locally by construction:
 *
 *   - a file the app needs that is gitignored, so it exists here and not in the clone;
 *   - a dependency that is installed here from an earlier branch and absent from the lockfile;
 *   - a postinstall that never ran because `node_modules` was already populated — which is
 *     exactly how Electron 44's lazily-fetched binary hides (see `scripts/postinstall.mjs`);
 *   - a build output someone has been running against for days without rebuilding.
 *
 * So this clones the repository as git would hand it to a reviewer — committed files only —
 * installs from the lockfile, and then checks the ARTEFACTS rather than the exit codes: a step
 * that prints nothing and exits 0 having produced no file is the failure mode `ci-artifact-truth`
 * exists for.
 *
 * Usage: npm run verify:clone [-- --keep]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const work = mkdtempSync(join(tmpdir(), 'voicedesk-clone-'))
const clone = join(work, 'repo')

/** Every check is a real file on disk, with the reason it is being looked for. */
const ARTEFACTS = [
  ['node_modules/electron/path.txt', 'the Electron binary marker — Electron 44 ships no install script, so `scripts/postinstall.mjs` has to fetch it'],
  ['out/main/index.js', 'the main-process bundle'],
  ['out/preload/index.js', 'the preload bundle — the one that must be self-contained'],
  ['out/renderer/index.html', 'the renderer entry'],
]

function step(label, run) {
  process.stdout.write(`\n── ${label}\n`)
  const started = Date.now()
  run()
  process.stdout.write(`   ok (${Math.round((Date.now() - started) / 1000)}s)\n`)
}

function sh(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })
}

let failed = false
try {
  step('clone (committed files only — this is what a reviewer receives)', () => {
    // `git clone` and not `cp -r`: the whole point is to leave behind everything gitignored.
    // A local clone still resolves the working tree's HEAD, so uncommitted work is excluded —
    // which is the property being tested.
    sh('git', ['clone', '--quiet', '--no-hardlinks', repoRoot, clone])
  })

  step('npm ci (from the lockfile, into an empty node_modules)', () => {
    sh('npm', ['ci'], clone)
  })

  step('typecheck', () => sh('npm', ['run', 'typecheck'], clone))
  step('build', () => sh('npm', ['run', 'build'], clone))

  step('the artefacts exist', () => {
    for (const [path, why] of ARTEFACTS) {
      const full = join(clone, path)
      if (!existsSync(full) || statSync(full).size === 0) {
        failed = true
        process.stdout.write(`   MISSING  ${path}\n            ${why}\n`)
      } else {
        process.stdout.write(`   ${String(statSync(full).size).padStart(9)}  ${path}\n`)
      }
    }
    if (failed) throw new Error('a step exited 0 but produced no artefact')
  })

  step('the test suite, in the clone', () => sh('npx', ['vitest', 'run'], clone))
} catch (error) {
  failed = true
  process.stdout.write(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  if (keep) {
    process.stdout.write(`\nclone kept at ${clone}\n`)
  } else {
    rmSync(work, { recursive: true, force: true })
  }
}

process.stdout.write(
  failed
    ? '\nverify:clone FAILED — the README\'s promise does not hold on a clean machine.\n'
    : '\nverify:clone passed — a fresh clone installs, builds and tests.\n',
)
process.exit(failed ? 1 : 0)
