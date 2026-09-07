/**
 * Mono audio captured from one hold, at whatever rate the device gave.
 *
 * It lives in `model/` and not in `ports/Transcriber.ts`, where it started, because it is a
 * pure data shape rather than a seam — the same kind of thing as `Transcript`, which was
 * already here. The distinction is load-bearing rather than tidy: the renderer is allowed to
 * name the domain's MODEL and forbidden to reach its PORTS (`docs/PLAN.md` §3, and the gate in
 * `test/architecture.test.ts`), and the capture path needs this type. Left in the ports file,
 * de-duplicating the recorder's identical `CapturedClip` onto it meant the renderer importing
 * from `domain/ports` — which is how the boundary gate found it.
 */
export interface AudioClip {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly heldMs: number
}
