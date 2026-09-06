import { ipcMain, type BrowserWindow } from 'electron'

import {
  AppInfoRes,
  AskReq,
  CH,
  SpeakReq,
  TranscribeReq,
  TurnStatePush,
  type AskRes,
  type SpeakRes,
  type TranscribeRes,
} from '../../shared/ipc'
import { failed } from '../domain/model/turn'
import type { Env, Ports } from './composition-root'

/**
 * IPC handlers are adapters, and nothing more: unwrap, validate, call the port, wrap.
 *
 * Every inbound payload is parsed here before it reaches anything else. The renderer is the
 * least-trusted process in the app — one XSS in the app's own UI is a compromised client — so
 * shapes are validated and sizes bounded at this line rather than three layers in.
 */
export function registerIpcHandlers(env: Env, ports: Ports): void {
  ipcMain.handle(CH.transcribe, async (_event, payload: unknown): Promise<TranscribeRes> => {
    const parsed = TranscribeReq.safeParse(payload)
    if (!parsed.success) {
      return failed({ kind: 'transcribe-failed', stderr: 'malformed audio payload' })
    }

    const { pcm, sampleRate, heldMs } = parsed.data
    return ports.transcriber.transcribe(
      { samples: new Float32Array(pcm), sampleRate, heldMs },
      AbortSignal.timeout(60_000),
    )
  })

  ipcMain.handle(CH.ask, async (_event, payload: unknown): Promise<AskRes> => {
    const parsed = AskReq.safeParse(payload)
    if (!parsed.success) return failed({ kind: 'agent-failed', stderr: 'malformed request' })

    const outcome = await ports.agent.run(parsed.data, AbortSignal.timeout(90_000))
    if (outcome.k === 'failed') return outcome
    const { text, notes, model, sessionId, costUsd } = outcome.value
    return { k: 'ok', value: { reply: text, notes: [...notes], model, sessionId, costUsd } }
  })

  ipcMain.handle(CH.speak, async (_event, payload: unknown): Promise<SpeakRes> => {
    const parsed = SpeakReq.safeParse(payload)
    if (!parsed.success) return failed({ kind: 'agent-failed', stderr: 'malformed request' })

    const outcome = await ports.voice.speak(parsed.data.text, AbortSignal.timeout(120_000))
    return outcome.k === 'ok' ? { k: 'ok', value: null } : outcome
  })

  ipcMain.handle(CH.appInfo, async (): Promise<AppInfoRes> => {
    return AppInfoRes.parse({
      version: env.version,
      stage: env.stage,
      notesDir: env.notesDir,
      agentModel: env.agentModel,
    })
  })
}

/** The one message main pushes rather than answers. Parsed on the way out as well as in. */
export function pushTurnState(window: BrowserWindow, state: TurnStatePush): void {
  if (window.isDestroyed()) return
  window.webContents.send(CH.state, TurnStatePush.parse(state))
}
