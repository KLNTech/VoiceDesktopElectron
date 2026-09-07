import { ipcMain, shell, systemPreferences, type BrowserWindow } from 'electron'

import {
  AppInfoRes,
  AskReq,
  CH,
  MicAccessRes,
  NotesListRes,
  SpeakReq,
  TranscribeReq,
  TurnStatePush,
  type AskRes,
  type SpeakRes,
  type TranscribeRes,
} from '../../shared/ipc'
import { failed } from '../domain/model/turn'
import type { Env, Ports } from './composition-root'
import { DEADLINES } from './deadlines'
import { readNotices } from './notices'

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
      AbortSignal.timeout(DEADLINES.transcribe),
    )
  })

  ipcMain.handle(CH.ask, async (_event, payload: unknown): Promise<AskRes> => {
    const parsed = AskReq.safeParse(payload)
    if (!parsed.success) return failed({ kind: 'agent-failed', stderr: 'malformed request' })

    const outcome = await ports.agent.run(parsed.data, AbortSignal.timeout(DEADLINES.agent))
    if (outcome.k === 'failed') return outcome
    const { text, notes, model, sessionId, costUsd } = outcome.value
    return { k: 'ok', value: { reply: text, notes: [...notes], model, sessionId, costUsd } }
  })

  ipcMain.handle(CH.speak, async (_event, payload: unknown): Promise<SpeakRes> => {
    const parsed = SpeakReq.safeParse(payload)
    if (!parsed.success) return failed({ kind: 'agent-failed', stderr: 'malformed request' })

    const outcome = await ports.voice.speak(parsed.data.text, AbortSignal.timeout(DEADLINES.speak))
    return outcome.k === 'ok' ? { k: 'ok', value: null } : outcome
  })

  ipcMain.handle(CH.appInfo, async (): Promise<AppInfoRes> => {
    return AppInfoRes.parse({
      version: env.version,
      stage: env.stage,
      notesDir: env.notesDir,
      // What the operator configured, valid or not. A turn reports the model that actually ran.
      agentModel: env.agentModelRaw,
      notices: readNotices(),
    })
  })

  /**
   * The notes folder at rest, which the panel needs before any turn has happened.
   *
   * Parsed on the way OUT as well as in. The names come from the filesystem rather than from
   * this app, and the renderer draws them, so the one bound worth having is right here: a file
   * name is a bare name, and anything the schema refuses is a bug caught before it reaches a
   * window rather than after.
   */
  ipcMain.handle(CH.notes, async (): Promise<NotesListRes> => {
    return NotesListRes.parse({ files: await ports.notes.list() })
  })

  /**
   * What macOS says about the microphone — the only side of the app that can find out.
   *
   * The renderer classified a denial from `navigator.permissions.query`, which answers about
   * CHROMIUM's per-origin permission. macOS's own decision is not visible from a page at all, so
   * a user who had switched the permission off in System Settings was told to *"hold the control
   * again and allow access when macOS asks"* — and macOS never asks again once the answer is
   * recorded. The advice was a loop with no exit.
   *
   * `getMediaAccessStatus` does not prompt and does not spawn anything; it reads TCC's answer.
   */
  ipcMain.handle(CH.micAccess, async (): Promise<MicAccessRes> => {
    // macOS-only API. The app is macOS-only too, but saying so twice is cheaper than a crash on
    // a platform where this app is not supported and the pane it points at does not exist.
    if (process.platform !== 'darwin') return 'unknown'
    return MicAccessRes.parse(systemPreferences.getMediaAccessStatus('microphone'))
  })

  /**
   * The microphone privacy pane, and nothing else.
   *
   * The URL is a constant HERE rather than a parameter from the renderer: a bridge method that
   * took a URL would be `shell.openExternal` with extra steps, and that is the renderer asking
   * the OS to launch arbitrary things. This asks it to launch exactly one.
   */
  ipcMain.handle(CH.openSettings, async (): Promise<void> => {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    )
  })
}

/** The one message main pushes rather than answers. Parsed on the way out as well as in. */
export function pushTurnState(window: BrowserWindow, state: TurnStatePush): void {
  if (window.isDestroyed()) return
  window.webContents.send(CH.state, TurnStatePush.parse(state))
}
