export function duration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (ms > 0 && totalMin === 0) return 'Under 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function shortDuration(ms: number): string {
  const h = ms / 3600000
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(ms / 60000)}m`
}

/** DD/MM/YYYY */
export function date(iso: string): string {
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso)
  return d.toLocaleDateString('en-GB')
}

export function weekday(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function dateTime(iso: string): string {
  return `${date(iso)} ${time(iso)}`
}

export function relative(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return date(iso)
}

/** YYYY-MM-DD for a day offset from a base ISO date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Today's date in the child's time zone, which is what usage days are keyed by. */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}
