import { useAppInfo } from './lib/use-app-info.js'

/**
 * Skeleton shell. The two-pane chat layout replaces this — see the surfaces
 * list in CLAUDE.md. What matters here is that the IPC round trip works.
 */
export function App(): React.JSX.Element {
  const info = useAppInfo()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="drag" />
        <p className="label">Chats</p>
      </aside>

      <main className="pane">
        <div className="drag" />
        <div className="center">
          <h1>Luna</h1>
          {info === undefined && <p className="muted">Loading…</p>}
          {info?.ok === false && <p className="muted">IPC failed: {info.code}</p>}
          {info?.ok === true && (
            <p className="muted">
              v{info.value.version} · Electron {info.value.electron} · {info.value.platform}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
