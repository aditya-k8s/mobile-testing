import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import { useLive } from '../lib/live'

const NAV = [
  { to: '/', label: 'My Child', end: true },
  { to: '/live', label: 'Live Screen' },
  { to: '/apps', label: 'App Usage' },
  { to: '/screen-time', label: 'Screen Time' },
  { to: '/activity', label: 'Activity History' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { parent, logout } = useAuth()
  const { devices, selected, selectDevice, connected, notifications, unread, markAllRead, toasts, dismissToast } = useLive()
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Family Monitor</div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted small">{parent?.name}</span>
          <button className="link-btn" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {devices.length > 1 ? (
            <select aria-label="Child device" value={selected?.id ?? ''} onChange={(e) => selectDevice(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          ) : (
            <span className="topbar-device">{selected?.name ?? 'No device connected'}</span>
          )}
          <div className="topbar-right">
            {!connected && <span className="muted small">Reconnecting…</span>}
            <button className="bell" aria-label={`Notifications, ${unread} unread`} onClick={() => setPanelOpen((o) => !o)}>
              Notifications{unread > 0 && <span className="count">{unread}</span>}
            </button>
          </div>
          {panelOpen && (
            <div className="notif-panel" role="dialog" aria-label="Notifications">
              <div className="notif-head">
                <strong>Notifications</strong>
                {unread > 0 && <button className="link-btn" onClick={() => void markAllRead()}>Mark all read</button>}
              </div>
              {notifications.length === 0 && <p className="muted">No notifications yet.</p>}
              <ul>
                {notifications.map((n) => (
                  <li key={n.id} className={n.read ? '' : 'unread'}>
                    <div>{n.message}</div>
                    <div className="muted small">{dateTime(n.created_at)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => dismissToast(t.id)}>{t.message}</div>
        ))}
      </div>
    </div>
  )
}
