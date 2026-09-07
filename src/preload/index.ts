import { contextBridge, ipcRenderer } from 'electron'

import {
  CH,
  type AppInfoRes,
  type AskReq,
  type AskRes,
  type MicAccessRes,
  type NotesListRes,
  type SpeakReq,
  type SpeakRes,
  type TranscribeReq,
  type TranscribeRes,
  type VoiceDeskBridge,
} from '../../shared/ipc'

/**
 * The entire contract between the page and the machine (`docs/PLAN.md` §7).
 *
 * One named method per message. `ipcRenderer` itself is never handed over, and no function here
 * takes a channel name from its caller — otherwise the surface would be "whatever the renderer
 * can think of" rather than the five messages below.
 */
const bridge: VoiceDeskBridge = {
  transcribe: (request: TranscribeReq): Promise<TranscribeRes> =>
    ipcRenderer.invoke(CH.transcribe, request),

  ask: (request: AskReq): Promise<AskRes> => ipcRenderer.invoke(CH.ask, request),

  speak: (request: SpeakReq): Promise<SpeakRes> => ipcRenderer.invoke(CH.speak, request),

  appInfo: (): Promise<AppInfoRes> => ipcRenderer.invoke(CH.appInfo),

  notes: (): Promise<NotesListRes> => ipcRenderer.invoke(CH.notes),

  micAccess: (): Promise<MicAccessRes> => ipcRenderer.invoke(CH.micAccess),

  openSettings: (): Promise<void> => ipcRenderer.invoke(CH.openSettings),
}

contextBridge.exposeInMainWorld('voicedesk', bridge)
