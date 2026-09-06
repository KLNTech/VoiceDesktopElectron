/*
 * Collects mono Float32 from the microphone and hands it to the page in batches.
 *
 * Plain JavaScript on purpose: this runs in the AudioWorklet global scope, which is a separate
 * realm with no bundler and no module resolution of its own. It is loaded by URL.
 *
 * Batching matters. `process` is called every 128 frames — about 125 times a second at 16 kHz —
 * and one postMessage per call floods the main thread with tiny transfers. Buffering to 4096
 * frames turns that into roughly four messages a second for the same bytes.
 */
const BATCH = 4096

class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(BATCH)
    this.used = 0
    this.port.onmessage = (event) => {
      // The hold has ended: send whatever is left, then say so, so the page knows the tail
      // has arrived and is not still in flight.
      if (event.data === 'flush') {
        this.emit()
        this.port.postMessage('done')
      }
    }
  }

  emit() {
    if (this.used === 0) return
    this.port.postMessage(this.buffer.slice(0, this.used))
    this.used = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel === undefined) return true

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.used] = channel[i]
      this.used += 1
      if (this.used === BATCH) this.emit()
    }
    return true
  }
}

registerProcessor('pcm-collector', PcmCollector)
