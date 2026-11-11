import { useEffect, useState } from 'react'
import { Card, StatusBadge } from '../components/ui'
import { api, type Device } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import { useLive } from '../lib/live'

function PairingCode() {
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    const tick = () => setLeft(Math.max(0, Math.round((new Date(code.expires_at).getTime() - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [code])

  const create = async () => {
    setError(null)
    try {
      setCode(await api('/api/pairing-codes', { method: 'POST' }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card title="Connect a device">
      <ol className="steps small">
        <li>Install the Family Monitor child app on your child’s Android device.</li>
        <li>Sit down with your child and go through the monitoring notice together.</li>
        <li>Your child enters this code in the app.</li>
      </ol>
      {code && left > 0 ? (
        <div className="pair-code">
          <div className="code" aria-label="Pairing code">{code.code}</div>
          <div className="muted small">Single use. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
        </div>
      ) : (
        <button className="btn primary" onClick={() => void create()}>{code ? 'Create a new code' : 'Create pairing code'}</button>
      )}
      {error && <p className="error">{error}</p>}
    </Card>
  )
}

function DeviceRow({ device }: { device: Device }) {
  const { refreshDevices } = useLive()
  const [name, setName] = useState(device.name)
  const [error, setError] = useState<string | null>(null)

  const rename = async () => {
    if (name.trim() === device.name) return
    try {
      await api(`/api/devices/${device.id}`, { method: 'PATCH', body: { name } })
      await refreshDevices()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const revoke = async (purge: boolean) => {
    const msg = purge
      ? `Remove ${device.name} and permanently delete all usage data and history collected from it?`
      : `Revoke access to ${device.name}? Monitoring stops immediately. History is kept.`
    if (!window.confirm(msg)) return
    try {
      await api(`/api/devices/${device.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' })
      await refreshDevices()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <li className="device-row">
      <div className="device-row-main">
        <input aria-label="Device name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} maxLength={80} />
        <StatusBadge connection={device.connection} lastSeen={device.last_seen_at} />
      </div>
      <div className="muted small">
        {device.model} · Android {device.os_version} · Child accepted the monitoring notice on {dateTime(device.consent_at)}
      </div>
      <div className="row">
        <button className="btn" onClick={() => void revoke(false)}>Revoke access</button>
        <button className="btn danger" onClick={() => void revoke(true)}>Remove and delete data</button>
      </div>
      {error && <p className="error">{error}</p>}
    </li>
  )
}

export default function Settings() {
  const { parent, logout } = useAuth()
  const { devices } = useLive()
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')

  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="grid">
        <PairingCode />

        <Card title="Notifications">
          <p className="small">
            Notifications appear in the dashboard while it is open. You can also allow browser notifications so you are
            alerted while this tab is in the background.
          </p>
          {perm === 'granted' ? (
            <p className="muted small">Browser notifications are on.</p>
          ) : perm === 'denied' ? (
            <p className="muted small">Browser notifications are blocked. Change this in your browser’s site settings.</p>
          ) : (
            <button className="btn" onClick={() => void Notification.requestPermission().then(setPerm)}>Allow browser notifications</button>
          )}
        </Card>

        <Card title="Connected devices" className="span-2">
          {devices.length === 0 ? <p className="muted">No devices connected.</p> : <ul className="device-list">{devices.map((d) => <DeviceRow key={d.id} device={d} />)}</ul>}
        </Card>

        <Card title="What is collected">
          <ul className="plain small">
            <li>App names, icons and daily foreground time, from Android Usage Access.</li>
            <li>The app currently in use, at each sync.</li>
            <li>Screen video only during a session your child approves. It is not recorded or stored.</li>
            <li>Never collected: messages, browsing content, keystrokes, location, audio, camera or microphone.</li>
          </ul>
        </Card>

        <Card title="Account">
          <p className="small">{parent?.name}<br /><span className="muted">{parent?.email}</span></p>
          <button className="btn" onClick={logout}>Sign out</button>
        </Card>
      </div>
    </div>
  )
}
