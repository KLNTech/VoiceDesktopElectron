/**
 * Float32 samples → a 16-bit PCM WAV, header and all.
 *
 * This is the whole reason the app needs no `ffmpeg`: `whisper-cli` decodes WAV itself and
 * resamples internally, so the alternative to these ~35 lines is a second binary to resolve, a
 * second setup-failure class, a second spawn per turn, and GPL-3.0-or-later in an otherwise
 * permissive dependency set (`docs/PLAN.md` §6).
 *
 * Pure, so it is tested without a microphone or a child process.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const channels = 1
  const dataBytes = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // file size minus the first 8 bytes
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // format 1 = uncompressed PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true) // byte rate
  view.setUint16(32, channels * bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a sample above 1.0 would otherwise wrap to the opposite extreme and
    // turn a loud moment into a click.
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * bytesPerSample, Math.round(sample * 0x7fff), true)
  }

  return new Uint8Array(buffer)
}
