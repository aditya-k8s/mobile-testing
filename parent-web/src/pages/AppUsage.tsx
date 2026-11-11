import { useState } from 'react'
import { AppIcon, Card } from '../components/ui'
import { addDays, date, duration, relative, todayIn } from '../lib/format'
import { useUsage } from '../lib/hooks'
import { useLive } from '../lib/live'
import { NoDevice } from './MyChild'

const RANGES = [
  { key: 'today', label: 'Today', from: 0, to: 0 },
  { key: 'yesterday', label: 'Yesterday', from: -1, to: -1 },
  { key: '7', label: 'Last 7 days', from: -6, to: 0 },
  { key: '30', label: 'Last 30 days', from: -29, to: 0 },
] as const

export default function AppUsage() {
  const { selected, devicesLoaded } = useLive()
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0])
  const today = todayIn(selected?.timezone ?? 'UTC')
  const from = addDays(today, range.from)
  const to = addDays(today, range.to)
  const { data, error } = useUsage(selected, from, to)

  if (devicesLoaded && !selected) return <NoDevice />

  return (
    <div className="page">
      <h1>App Usage</h1>
      <div className="filters" role="group" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.key} className={`chip ${r.key === range.key ? 'active' : ''}`} onClick={() => setRange(r)}>
            {r.label}
          </button>
        ))}
      </div>
      <Card
        title={from === to ? date(from) : `${date(from)} to ${date(to)}`}
        action={data && <span className="muted">Total {duration(data.total_ms)}</span>}
      >
        {error && <p className="error">{error}</p>}
        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.apps.length === 0 ? (
          <p className="muted">No app usage recorded for this period.</p>
        ) : (
          <table className="table usage-table">
            <thead>
              <tr>
                <th>App</th>
                <th className="num">Time</th>
                <th className="num hide-sm">Share</th>
                <th className="hide-sm">Last used</th>
              </tr>
            </thead>
            <tbody>
              {data.apps.map((a) => {
                const share = data.total_ms ? (a.total_ms / data.total_ms) * 100 : 0
                return (
                  <tr key={a.package}>
                    <td>
                      <div className="app-cell">
                        <AppIcon app={a} size={28} />
                        <div>
                          <div>{a.name}</div>
                          <div className="bar-track thin"><div className="bar-fill" style={{ width: `${Math.max(1, (a.total_ms / data.apps[0].total_ms) * 100)}%` }} /></div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{duration(a.total_ms)}</td>
                    <td className="num hide-sm">{share.toFixed(0)}%</td>
                    <td className="hide-sm muted">{relative(a.last_used_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
      <p className="muted small">
        Time is measured by Android’s Usage Access (UsageStats) as foreground time per app. System apps without a launcher icon are excluded.
      </p>
    </div>
  )
}
