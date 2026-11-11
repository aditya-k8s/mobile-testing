import { useEffect, useRef, useState } from 'react'
import { Card, StatusBadge } from '../components/ui'
import { api, OPEN_SESSION, type ScreenSession } from '../lib/api'
import { dateTime } from '../lib/format'
import { useSummary } from '../lib/hooks'
import { useLive } from '../lib/live'
import { useViewer, type Quality } from '../lib/viewer'
import { NoDevice } from './MyChild'

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000))
  return <span>{s}s</span>
}

const ENDED_TEXT: Record<string, string> = {
  rejected: 'Your child declined the request.',
  expired: 'The request expired without a response.',
  cancelled: 'The request was cancelled.',
}

export default function LiveScreen() {
  const { selected, devicesLoaded, sessions, setSession } = useLive()
  useSummary(selected) // loads any open session on first visit
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const session = selected ? sessions[selected.id] ?? null : null
  const { state, error, endReason, info, setQuality } = useViewer(session, videoRef)
  const [quality, setQ] = useState<Quality>('high')
  const [actionError, setActionError] = useState<string | null>(null)

  if (devicesLoaded && !selected) return <NoDevice />
  if (!selected) return <p className="muted">Loading…</p>

  const open = session && OPEN_SESSION.includes(session.status)

  const request = async () => {
    setActionError(null)
    try {
      setSession(await api<ScreenSession>(`/api/devices/${selected.id}/screen-sessions`, { method: 'POST' }))
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  const stop = async () => {
    if (!session) return
    try {
      setSession(await api<ScreenSession>(`/api/screen-sessions/${session.id}/end`, { method: 'POST' }))
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  const changeQuality = (q: Quality) => {
    setQ(q)
    setQuality(q)
  }

  const live = session?.status === 'active' && state === 'live'
  const aspect = info && info.width && info.height ? `${info.width} / ${info.height}` : '9 / 19.5'

  let statusText = 'Not sharing'
  if (session?.status === 'requested') statusText = 'Waiting for your child to approve on their device'
  else if (session?.status === 'approved' || (session?.status === 'active' && state !== 'live')) statusText = 'Connecting…'
  else if (live) statusText = 'Live'
  else if (session && ENDED_TEXT[session.status]) statusText = ENDED_TEXT[session.status]
  else if (session?.status === 'ended') statusText = `Session ended${session.end_reason ? `: ${session.end_reason}` : ''}`

  return (
    <div className="page">
      <h1>Live Screen</h1>
      <div className="live-layout">
        <Card className="live-card">
          <div className="live-status-row">
            <span className={`live-pill ${live ? 'on' : ''}`}>{live ? 'LIVE' : 'OFF'}</span>
            <span>{statusText}</span>
            {session?.status === 'requested' && (
              <span className="muted">· expires in <Countdown until={session.request_expires_at} /></span>
            )}
          </div>

          <div className="screen-frame" ref={frameRef} style={{ aspectRatio: aspect }}>
            <video ref={videoRef} autoPlay playsInline muted className={live ? '' : 'hidden'} />
            {!live && (
              <div className="screen-placeholder">
                {open ? 'The screen appears here once your child starts sharing.' : 'Request a session to view your child’s screen.'}
              </div>
            )}
          </div>

          {(error || actionError) && <p className="error">{error ?? actionError}</p>}
          {state === 'ended' && endReason && session?.status !== 'ended' && <p className="muted">{endReason}</p>}

          <div className="live-actions">
            {open ? (
              <button className="btn danger" onClick={() => void stop()}>
                {session?.status === 'requested' ? 'Cancel request' : 'Stop session'}
              </button>
            ) : (
              <button className="btn primary" onClick={() => void request()} disabled={selected.platform !== 'android'}>
                Request screen sharing
              </button>
            )}
            {live && (
              <>
                <label className="inline">
                  Quality
                  <select value={quality} onChange={(e) => changeQuality(e.target.value as Quality)}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low (slow networks)</option>
                  </select>
                </label>
                <button className="btn" onClick={() => void frameRef.current?.requestFullscreen()}>Full screen</button>
              </>
            )}
          </div>
        </Card>

        <div className="live-side">
          <Card title="Connection">
            <StatusBadge connection={selected.connection} lastSeen={selected.last_seen_at} />
            <dl className="facts">
              <dt>Resolution</dt><dd>{info && info.width ? `${info.width} × ${info.height}` : '-'}</dd>
              <dt>Frame rate</dt><dd>{info ? `${info.fps} fps` : '-'}</dd>
              <dt>Bitrate</dt><dd>{info ? `${info.kbps} kbps` : '-'}</dd>
              <dt>Started</dt><dd>{session?.started_at ? dateTime(session.started_at) : '-'}</dd>
            </dl>
          </Card>
          <Card title="How it works">
            <ul className="plain small">
              <li>Your child sees the request and chooses whether to share.</li>
              <li>Android shows its own screen-capture prompt and a persistent notification while sharing.</li>
              <li>Your child can stop at any time. Leaving this page also ends the session.</li>
              <li>Only the screen image is shared. No audio, camera or microphone.</li>
              <li>Sessions end automatically after 30 minutes.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
