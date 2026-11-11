import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppBars, AppIcon, Card, Empty, Stat, StatusBadge } from '../components/ui'
import { api, OPEN_SESSION, type ScreenSession } from '../lib/api'
import { dateTime, duration, relative, time } from '../lib/format'
import { useSummary } from '../lib/hooks'
import { useLive } from '../lib/live'

export function NoDevice() {
  return (
    <Empty title="Connect your child’s device">
      <p className="muted">
        Install the Family Monitor child app on your child’s Android phone, then create a pairing code in Settings.
        Your child reviews what will be shared and enters the code to connect.
      </p>
      <Link className="btn primary" to="/settings">Create a pairing code</Link>
    </Empty>
  )
}

const SESSION_LABEL: Record<string, string> = {
  requested: 'Waiting for your child to approve',
  approved: 'Approved, connecting',
  active: 'Sharing now',
}

export default function MyChild() {
  const { selected, devicesLoaded, sessions, setSession } = useLive()
  const { data, error } = useSummary(selected)
  const navigate = useNavigate()
  const [requestError, setRequestError] = useState<string | null>(null)

  if (devicesLoaded && !selected) return <NoDevice />
  if (!selected || !data) return <p className="muted">{error ?? 'Loading…'}</p>

  const device = selected
  const session = sessions[device.id] ?? data.session
  const open = session && OPEN_SESSION.includes(session.status)
  const currentIcon = data.today.apps.find((a) => a.package === device.current_app?.package)?.icon

  const requestShare = async () => {
    setRequestError(null)
    try {
      setSession(await api<ScreenSession>(`/api/devices/${device.id}/screen-sessions`, { method: 'POST' }))
      navigate('/live')
    } catch (e) {
      setRequestError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <h1>{device.name}</h1>
      <div className="grid">
        <Card title="Device">
          <div className="row">
            <StatusBadge connection={device.connection} lastSeen={device.last_seen_at} />
          </div>
          <dl className="facts">
            <dt>Model</dt><dd>{device.model || 'Unknown'}</dd>
            <dt>Last contact</dt><dd>{relative(device.last_seen_at)}</dd>
            <dt>Connected since</dt><dd>{dateTime(device.paired_at)}</dd>
          </dl>
          {!device.usage_permission && (
            <p className="warn">Usage access is off on this device, so app usage is not updating. Ask your child to enable it in the app.</p>
          )}
        </Card>

        <Card title="Current app">
          {device.current_app ? (
            <div className="current-app">
              <AppIcon app={{ name: device.current_app.name, icon: currentIcon }} size={44} />
              <div>
                <div className="strong">{device.current_app.name}</div>
                <div className="muted small">
                  Reported {device.current_app.since ? time(device.current_app.since) : ''}
                  {device.connection !== 'live' && ' · updates every 15 min while the app is closed'}
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">Not reported yet.</p>
          )}
        </Card>

        <Card title="Today’s screen time">
          <Stat label="Total" value={duration(data.today.total_ms)} sub={`${data.today.apps.length} apps used`} />
        </Card>

        <Card title="Live screen">
          <p className="strong">{open ? SESSION_LABEL[session!.status] : 'Not sharing'}</p>
          <p className="muted small">Your child must approve each session on their device, and sees an indicator while sharing.</p>
          {open ? (
            <Link className="btn primary" to="/live">Open live screen</Link>
          ) : (
            <button className="btn primary" onClick={() => void requestShare()} disabled={device.platform !== 'android'}>
              Request screen sharing
            </button>
          )}
          {device.platform !== 'android' && <p className="muted small">Live screen sharing is available for Android devices only.</p>}
          {requestError && <p className="error">{requestError}</p>}
        </Card>

        <Card title="Most-used apps today" className="span-2" action={<Link to="/apps" className="small">All apps</Link>}>
          <AppBars apps={data.today.apps} total={data.today.total_ms} limit={5} />
        </Card>

        <Card title="Recent activity" className="span-2" action={<Link to="/activity" className="small">View history</Link>}>
          {data.recent_events.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <ul className="timeline">
              {data.recent_events.map((e) => (
                <li key={e.id}>
                  <span className="muted small">{dateTime(e.created_at)}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
