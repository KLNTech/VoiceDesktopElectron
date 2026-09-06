import type { VoiceDeskBridge } from '../../../shared/ipc'

declare global {
  interface Window {
    /** Exposed by `src/preload/index.ts`. The only way the page reaches the machine. */
    readonly voicedesk: VoiceDeskBridge
  }
}

export {}
