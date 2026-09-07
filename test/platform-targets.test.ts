import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * This app ships for macOS and for nothing else — declared, not assumed.
 *
 * The question that produced this gate: *are there build options for systems we have never
 * tested on?* Today the honest answer is that there is no packaging configuration at all — no
 * `electron-builder`, no `electron-forge`, no `build` key — so nothing produces an artifact for
 * any platform, and `docs/WORK-BREAKDOWN.md` records that as F1.
 *
 * That answer has a short shelf life. The day somebody adds a packager, its scaffolding offers
 * Windows and Linux targets by default, and taking the default is how a build for an untested
 * platform gets published without anybody deciding to publish one. Three things in this app are
 * macOS and only macOS: the spoken reply is the system `say`, the microphone permission is
 * macOS's TCC, and the failure board opens `x-apple.systempreferences:`. A Windows build would
 * install, launch, and fail at the first hold.
 *
 * So the constraint is written where it is enforced — `package.json`'s `os` field, which npm
 * honours at install time — and this file keeps the two from drifting apart.
 */
const manifest = z
  .object({
    os: z.array(z.string()).optional(),
    build: z.unknown().optional(),
    devDependencies: z.record(z.string(), z.string()).default({}),
    dependencies: z.record(z.string(), z.string()).default({}),
  })
  .parse(JSON.parse(readFileSync('package.json', 'utf8')))

/** Every packager whose default scaffolding offers a Windows or Linux target. */
const PACKAGERS = ['electron-builder', '@electron-forge/cli', 'electron-packager', '@electron/packager']

describe('the platforms this app is built for', () => {
  it('declares macOS and nothing else', () => {
    // npm refuses to install on any other platform, so an attempt to build this on Windows fails
    // at `npm ci` with a sentence naming the reason, rather than at the first spoken reply.
    expect(manifest.os).toEqual(['darwin'])
  })

  it('has no packaging configuration to carry a stray target', () => {
    // If this ever reddens, it is not a defect: it means packaging arrived, and the assertion
    // below is the one that then has to hold.
    const packagers = PACKAGERS.filter(
      (name) => name in manifest.devDependencies || name in manifest.dependencies,
    )
    expect({ packagers, buildKey: manifest.build }).toEqual({ packagers: [], buildKey: undefined })
  })

  it('names no Windows or Linux target anywhere in the tracked configuration', () => {
    // The check that survives packaging being added, because it reads the config rather than
    // asserting the config is absent.
    const config = JSON.stringify(manifest.build ?? {})
    expect(config).not.toMatch(/\b(win|win32|windows|nsis|appx|squirrel|msi|linux|deb|rpm|appimage|snap)\b/i)
  })
})
