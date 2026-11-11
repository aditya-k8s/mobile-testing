import { useEffect, useState } from 'react'
import { api, type Device, type Summary, type UsageReport } from './api'
import { useLive } from './live'

function useAsync<T>(fetcher: (() => Promise<T>) | null, deps: unknown[], pollMs = 60000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!fetcher) return
    let alive = true
    const load = () =>
      fetcher()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message))
    void load()
    const t = window.setInterval(load, pollMs)
    return () => {
      alive = false
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error }
}

export function useSummary(device: Device | null) {
  const { eventTick, setSession } = useLive()
  return useAsync<Summary>(
    device
      ? async () => {
          const s = await api<Summary>(`/api/devices/${device.id}/summary`)
          if (s.session) setSession(s.session)
          return s
        }
      : null,
    [device?.id, device?.last_seen_at, eventTick],
  )
}

export function useUsage(device: Device | null, from: string, to: string) {
  return useAsync<UsageReport>(
    device ? () => api<UsageReport>(`/api/devices/${device.id}/usage?from=${from}&to=${to}`) : null,
    [device?.id, device?.last_seen_at, from, to],
  )
}
