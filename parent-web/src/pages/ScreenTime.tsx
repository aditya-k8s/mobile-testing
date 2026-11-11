import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AppBars, Card, Stat } from '../components/ui'
import { addDays, date, duration, shortDuration, todayIn, weekday } from '../lib/format'
import { useUsage } from '../lib/hooks'
import { useLive } from '../lib/live'
import { NoDevice } from './MyChild'

export default function ScreenTime() {
  const { selected, devicesLoaded } = useLive()
  const [days, setDays] = useState<7 | 30>(7)
  const [asTable, setAsTable] = useState(false)
  const today = todayIn(selected?.timezone ?? 'UTC')
  const { data, error } = useUsage(selected, addDays(today, -(days - 1)), today)

  if (devicesLoaded && !selected) return <NoDevice />

  const todayMs = data?.days.find((d) => d.date === today)?.total_ms ?? 0
  const week = data?.days.slice(-7) ?? []
  const weekMs = week.reduce((s, d) => s + d.total_ms, 0)
  const activeDays = data?.days.filter((d) => d.total_ms > 0).length || 1
  const chartData = data?.days.map((d) => ({ ...d, label: days === 7 ? weekday(d.date) : d.date.slice(8), hours: d.total_ms / 3600000 })) ?? []

  return (
    <div className="page">
      <h1>Screen Time</h1>
      {error && <p className="error">{error}</p>}
      <div className="stats-row">
        <Card><Stat label="Today" value={duration(todayMs)} /></Card>
        <Card><Stat label="Last 7 days" value={duration(weekMs)} /></Card>
        <Card><Stat label={`Daily average (${days} days)`} value={duration((data?.total_ms ?? 0) / activeDays)} sub="Days with usage only" /></Card>
        <Card><Stat label={`Total device usage (${days} days)`} value={duration(data?.total_ms ?? 0)} /></Card>
      </div>

      <Card
        title="Daily usage"
        action={
          <div className="filters">
            <button className={`chip ${days === 7 ? 'active' : ''}`} onClick={() => setDays(7)}>7 days</button>
            <button className={`chip ${days === 30 ? 'active' : ''}`} onClick={() => setDays(30)}>30 days</button>
            <button className="chip" onClick={() => setAsTable((t) => !t)}>{asTable ? 'Chart' : 'Table'}</button>
          </div>
        }
      >
        {asTable ? (
          <table className="table">
            <thead><tr><th>Date</th><th className="num">Screen time</th></tr></thead>
            <tbody>
              {[...(data?.days ?? [])].reverse().map((d) => (
                <tr key={d.date}><td>{weekday(d.date)} {date(d.date)}</td><td className="num">{duration(d.total_ms)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="chart" role="img" aria-label="Daily screen time bar chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap={days === 7 ? '35%' : '20%'}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} interval={days === 30 ? 2 : 0} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={(h: number) => `${h}h`} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'var(--hover)' }}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                  labelFormatter={(_, p) => (p?.[0] ? `${weekday(p[0].payload.date)} ${date(p[0].payload.date)}` : '')}
                  formatter={(_v, _n, p) => [duration(p.payload.total_ms), 'Screen time']}
                />
                <Bar dataKey="hours" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {data && <p className="muted small">Peak: {shortDuration(Math.max(0, ...data.days.map((d) => d.total_ms)))} in a day</p>}
      </Card>

      <Card title={`Most-used apps (${days} days)`}>
        {data ? <AppBars apps={data.apps} total={data.total_ms} limit={10} /> : <p className="muted">Loading…</p>}
      </Card>
    </div>
  )
}
