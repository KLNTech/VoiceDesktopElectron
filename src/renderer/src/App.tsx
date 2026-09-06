/**
 * The S1 shell: a window that opens, and a version badge that proves which build is on screen.
 *
 * It is deliberately not a sketch of the interface. The design canvas ("Voice Desktop", 0.3.1)
 * is implemented in one pass in S8, against the approved artboards — drawing an approximation
 * of it here would mean designing the UI twice and throwing one away.
 */
export function App(): React.JSX.Element {
  const stage = import.meta.env.DEV ? 'dev' : 'build'

  return (
    <main className="shell">
      <header className="bar">
        <h1>VoiceDesk</h1>
        <span className="version">
          v{__APP_VERSION__} · {stage}
        </span>
      </header>
      <p className="note">
        Toolchain and window only. Push-to-talk capture and on-device transcription arrive in this
        same iteration; the interface is implemented against the design canvas afterwards.
      </p>
    </main>
  )
}
