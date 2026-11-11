export const API_BASE: string = import.meta.env.VITE_API_URL ?? ''

export function wsUrl(path: string): string {
  const base = API_BASE || window.location.origin
  return base.replace(/^http/, 'ws') + path
}

const TOKEN_KEY = 'fm_token'
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()

export function getToken() {
  return token
}

export function setToken(value: string | null) {
  token = value
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: token lives in memory for this tab only */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(API_BASE + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401 && token) {
    setToken(null)
    window.dispatchEvent(new Event('fm:logout'))
  }
  if (!res.ok) {
    let message = res.statusText || 'Request failed'
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') message = j.detail
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) message = j.detail[0].msg
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type Connection = 'live' | 'background' | 'offline' | 'revoked'

export interface CurrentApp {
  package: string
  name: string
  since: string | null
}

export interface Device {
  id: string
  name: string
  model: string
  platform: 'android' | 'ios'
  os_version: string
  app_version: string
  timezone: string
  paired_at: string
  consent_at: string
  last_seen_at: string | null
  connection: Connection
  usage_permission: boolean
  current_app: CurrentApp | null
}

export interface AppUsage {
  package: string
  name: string
  total_ms: number
  last_used_at: string | null
  icon: string | null
}

export interface UsageReport {
  from: string
  to: string
  total_ms: number
  days: { date: string; total_ms: number }[]
  apps: AppUsage[]
}

export type SessionStatus = 'requested' | 'approved' | 'active' | 'ended' | 'rejected' | 'expired' | 'cancelled'

export interface ScreenSession {
  id: string
  device_id: string
  status: SessionStatus
  requested_at: string
  request_expires_at: string
  responded_at: string | null
  started_at: string | null
  ended_at: string | null
  end_reason: string | null
}

export interface ActivityEvent {
  id: number
  device_id: string | null
  type: string
  message: string
  notify: boolean
  created_at: string
  read: boolean
}

export interface Summary {
  device: Device
  today: UsageReport
  session: ScreenSession | null
  recent_events: ActivityEvent[]
}

export const OPEN_SESSION: SessionStatus[] = ['requested', 'approved', 'active']
