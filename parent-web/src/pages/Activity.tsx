import { useCallback, useEffect, useState } from 'react'
import { Card } from '../components/ui'
import { api, type ActivityEvent, type ScreenSession } from '../lib/api'
import { dateTime, duration } from '../lib/format'
import { useLive } from '../lib/live'
import { NoDevice } from './MyChild'

const STATUS_TEXT: Record<string, string> = {
  requested: 'Waiting', approved: 'Approved', active: 'Live', ended: 'Ended',
  rejected: 'Declined', expired: 'No response', cancelled: 'Cancelled',
}

export default function Activity() {
  const { selected, devicesLoaded, eventTick } = useLive()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [more, setMore] = useState(false)
  const [notifyOnly, setNotifyOnly] = useState(false)
  const [sessions, setSessions] = useState<ScreenSession[]>([])

  const load = useCallback(
    async (beforeId?: number) => {
      if (!selected) return
      const q = new URLSearchParams({ device_id: selected.id, limit: '50', notify_only: String(notifyOnly) })
      if (beforeId) q.set('before_id', String(beforeId))
      const r = await api<{ events: ActivityEvent[] }>(`/api/events?${q}`)
      setEvents((prev) => (beforeId ? [...prev, ...r.events] : r.events))
      setMore(r.events.length === 50)
    },
    [selected, notifyOnly],
  )

  useEffect(() => {
    void load()
    if (selected) void api<ScreenSession[]>(`/api/devices/${selected.id}/screen-sessions`).then(setSessions)
  }, [load, selected, eventTick])

  if (devicesLoaded && !selected) return <NoDevice />

  return (
    <div className="page">
      <h1>Activity History</h1>
      <div className="grid">
        <Card
          title="Events"
          className="span-2"
          action={
            <div className="filters">
              <button className={`chip ${!notifyOnly ? 'active' : ''}`} onClick={() => setNotifyOnly(false)}>All</button>
              <button className={`chip ${notifyOnly ? 'active' : ''}`} onClick={() => setNotifyOnly(true)}>Notifications</button>
            </div>
          }
        >
          {events.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="muted small">{dateTime(e.created_at)}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          )}
          {more && <button className="btn" onClick={() => void load(events[events.length - 1]?.id)}>Load more</button>}
        </Card>

        <Card title="Screen-sharing sessions" className="span-2">
          {sessions.length === 0 ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Requested</th><th>Outcome</th><th className="num">Duration</th><th className="hide-sm">Ended because</th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{dateTime(s.requested_at)}</td>
                    <td>{STATUS_TEXT[s.status] ?? s.status}</td>
                    <td className="num">
                      {s.started_at && s.ended_at ? duration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) : '-'}
                    </td>
                    <td className="hide-sm muted">{s.end_reason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
