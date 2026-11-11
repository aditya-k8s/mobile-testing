import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, getToken, wsUrl, type ActivityEvent, type Device, type ScreenSession } from './api'

export interface Toast {
  id: number
  message: string
}

interface LiveValue {
  connected: boolean
  devices: Device[]
  devicesLoaded: boolean
  selected: Device | null
  selectDevice: (id: string) => void
  refreshDevices: () => Promise<void>
  sessions: Record<string, ScreenSession | null>
  setSession: (s: ScreenSession) => void
  notifications: ActivityEvent[]
  unread: number
  markAllRead: () => Promise<void>
  /** Increments on every activity event so pages can refresh derived data. */
  eventTick: number
  toasts: Toast[]
  dismissToast: (id: number) => void
}

const LiveContext = createContext<LiveValue | null>(null)
const SELECTED_KEY = 'fm_selected_device'

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoaded, setDevicesLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(readSelected)
  const [sessions, setSessions] = useState<Record<string, ScreenSession | null>>({})
  const [notifications, setNotifications] = useState<ActivityEvent[]>([])
  const [unread, setUnread] = useState(0)
  const [eventTick, setEventTick] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const refreshDevices = useCallback(async () => {
    const list = await api<Device[]>('/api/devices')
    setDevices(list)
    setDevicesLoaded(true)
  }, [])

  const pushToast = useCallback((message: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, message }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  const setSession = useCallback((s: ScreenSession) => {
    setSessions((prev) => ({ ...prev, [s.device_id]: s }))
  }, [])

  useEffect(() => {
    void refreshDevices()
    api<{ events: ActivityEvent[]; unread: number }>('/api/events?notify_only=true&limit=30')
      .then((r) => {
        setNotifications(r.events)
        setUnread(r.unread)
      })
      .catch(() => undefined)

    let ws: WebSocket | null = null
    let stopped = false
    let retry = 1000
    let ping: number | undefined
    let reconnect: number | undefined

    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/parent'))
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token: getToken() }))
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        switch (msg.type) {
          case 'ready':
            setConnected(true)
            retry = 1000
            void refreshDevices() // catch up on anything missed while disconnected
            ping = window.setInterval(() => ws?.send(JSON.stringify({ type: 'ping' })), 25000)
            break
          case 'device':
            setDevices((list) => {
              const d: Device = msg.device
              if (d.connection === 'revoked') return list.filter((x) => x.id !== d.id)
              const i = list.findIndex((x) => x.id === d.id)
              return i === -1 ? [...list, d] : list.map((x) => (x.id === d.id ? d : x))
            })
            break
          case 'device_removed':
            setDevices((list) => list.filter((x) => x.id !== msg.device_id))
            break
          case 'session':
            setSession(msg.session)
            break
          case 'event': {
            const e: ActivityEvent = msg.event
            setEventTick((n) => n + 1)
            if (e.notify) {
              setNotifications((n) => [e, ...n].slice(0, 50))
              setUnread((n) => n + 1)
              pushToast(e.message)
              // Inside the Parent Android app: native notification (shown only while backgrounded).
              window.FamilyMonitorApp?.notify('Family Monitor', e.message)
              if (!window.FamilyMonitorApp && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Family Monitor', { body: e.message, tag: String(e.id) })
              }
            }
            break
          }
        }
      }
      ws.onclose = (ev) => {
        setConnected(false)
        window.clearInterval(ping)
        if (stopped || ev.code === 4401) return
        reconnect = window.setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30000)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(reconnect)
      ws?.close()
    }
  }, [refreshDevices, pushToast, setSession])

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0] ?? null

  const selectDevice = (id: string) => {
    setSelectedId(id)
    try {
      localStorage.setItem(SELECTED_KEY, id)
    } catch {
      /* ignore */
    }
  }

  const markAllRead = async () => {
    await api('/api/events/read-all', { method: 'POST' })
    setUnread(0)
    setNotifications((n) => n.map((e) => ({ ...e, read: true })))
  }

  return (
    <LiveContext.Provider
      value={{
        connected, devices, devicesLoaded, selected, selectDevice, refreshDevices, sessions, setSession,
        notifications, unread, markAllRead, eventTick, toasts,
        dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
      }}
    >
      {children}
    </LiveContext.Provider>
  )
}

export function useLive() {
  const v = useContext(LiveContext)
  if (!v) throw new Error('useLive outside LiveProvider')
  return v
}
