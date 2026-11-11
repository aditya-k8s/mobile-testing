import type { ReactNode } from 'react'
import type { AppUsage, Connection } from '../lib/api'
import { duration, relative } from '../lib/format'

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

const CONNECTION_LABEL: Record<Connection, string> = {
  live: 'Online',
  background: 'Online (background)',
  offline: 'Offline',
  revoked: 'Disconnected',
}

export function StatusBadge({ connection, lastSeen }: { connection: Connection; lastSeen?: string | null }) {
  return (
    <span className={`badge badge-${connection}`} title={lastSeen ? `Last contact ${relative(lastSeen)}` : undefined}>
      <span className="dot" aria-hidden="true" />
      {CONNECTION_LABEL[connection]}
    </span>
  )
}

export function AppIcon({ app, size = 32 }: { app: { name: string; icon?: string | null }; size?: number }) {
  if (app.icon) return <img className="app-icon" src={app.icon} alt="" width={size} height={size} />
  return (
    <span className="app-icon app-icon-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {app.name.charAt(0).toUpperCase()}
    </span>
  )
}

/** Ranked single-series bars: one hue, label and value in text ink, hover title for exact value. */
export function AppBars({ apps, total, limit }: { apps: AppUsage[]; total: number; limit?: number }) {
  const shown = limit ? apps.slice(0, limit) : apps
  const max = shown[0]?.total_ms || 1
  if (shown.length === 0) return <p className="muted">No app usage recorded for this period.</p>
  return (
    <ul className="app-bars">
      {shown.map((a) => (
        <li key={a.package} title={`${a.name}: ${duration(a.total_ms)}${total ? ` (${Math.round((a.total_ms / total) * 100)}%)` : ''}`}>
          <AppIcon app={a} />
          <div className="app-bar-body">
            <div className="app-bar-label">
              <span className="app-name">{a.name}</span>
              <span className="app-value">{duration(a.total_ms)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${Math.max(2, (a.total_ms / max) * 100)}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
