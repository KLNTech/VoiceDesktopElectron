import { describe, expect, it } from 'vitest'

import { encodeWav } from '../src/infrastructure/transcribe/wav'

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.slice(at, at + length))

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const wav = encodeWav(samples, 16_000)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

  it('writes a 44-byte header and two bytes per sample', () => {
    expect(wav.byteLength).toBe(44 + samples.length * 2)
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 36, 4)).toBe('data')
  })

  it('declares mono 16-bit PCM at the rate it was given', () => {
    expect(view.getUint16(20, true)).toBe(1) // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1) // one channel
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(view.getUint32(28, true)).toBe(16_000 * 2) // byte rate
  })

  it('carries the declared rate through rather than assuming 16 kHz', () => {
    // §6: a 48 kHz device is written as a 48 kHz WAV; whisper resamples. Pinning the rate here
    // would silently pitch-shift that recording.
    const at48k = encodeWav(samples, 48_000)
    expect(new DataView(at48k.buffer).getUint32(24, true)).toBe(48_000)
  })

  it('clamps out-of-range samples instead of wrapping them', () => {
    const loud = encodeWav(new Float32Array([2, -2]), 16_000)
    const loudView = new DataView(loud.buffer)
    // Without the clamp these wrap to the opposite extreme and a loud moment becomes a click.
    expect(loudView.getInt16(44, true)).toBe(32_767)
    expect(loudView.getInt16(46, true)).toBe(-32_767)
  })
})
