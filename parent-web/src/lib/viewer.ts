import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { api, wsUrl, type ScreenSession } from './api'

export type ViewerState = 'idle' | 'connecting' | 'waiting' | 'live' | 'ended' | 'error'
export type Quality = 'high' | 'medium' | 'low'

export interface StreamInfo {
  width: number
  height: number
  fps: number
  kbps: number
}

/**
 * Receive-only WebRTC viewer. Joins the session's signalling room with a short-lived stream
 * token; the child's device sends the offer, this side answers. Media flows peer-to-peer
 * (or through TURN), never through the API server.
 */
export function useViewer(session: ScreenSession | null, videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<ViewerState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [endReason, setEndReason] = useState<string | null>(null)
  const [info, setInfo] = useState<StreamInfo | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const joinableId = session && (session.status === 'approved' || session.status === 'active') ? session.id : null

  useEffect(() => {
    if (!joinableId) return
    let cancelled = false
    let pc: RTCPeerConnection | null = null
    let ws: WebSocket | null = null
    let statsTimer: number | undefined
    const pending: RTCIceCandidateInit[] = []
    const send = (m: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

    setState('connecting')
    setError(null)
    setEndReason(null)
    setInfo(null)

    const run = async () => {
      const [{ token }, { iceServers }] = await Promise.all([
        api<{ token: string }>(`/api/screen-sessions/${joinableId}/stream-token`, { method: 'POST' }),
        api<{ iceServers: RTCIceServer[] }>('/api/rtc-config'),
      ])
      if (cancelled) return

      pc = new RTCPeerConnection({ iceServers })
      pc.ontrack = (e) => {
        const video = videoRef.current
        if (video) {
          video.srcObject = e.streams[0] ?? new MediaStream([e.track])
          void video.play().catch(() => undefined)
        }
        setState('live')
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() })
      }
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'failed') {
          setError('The video connection could not be established. On different networks a TURN server is required (see README).')
          setState('error')
        }
      }

      let lastBytes = 0
      let lastTs = 0
      statsTimer = window.setInterval(async () => {
        if (!pc) return
        const stats = await pc.getStats()
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            const kbps = lastTs ? ((r.bytesReceived - lastBytes) * 8) / (r.timestamp - lastTs) : 0
            lastBytes = r.bytesReceived
            lastTs = r.timestamp
            setInfo({ width: r.frameWidth ?? 0, height: r.frameHeight ?? 0, fps: Math.round(r.framesPerSecond ?? 0), kbps: Math.round(kbps) })
          }
        })
      }, 2000)

      ws = new WebSocket(wsUrl('/ws/stream'))
      wsRef.current = ws
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }))
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data)
        if (!pc) return
        switch (msg.type) {
          case 'joined':
            setState((s) => (s === 'live' ? s : 'waiting'))
            break
          case 'offer':
            await pc.setRemoteDescription(msg.description)
            await pc.setLocalDescription(await pc.createAnswer())
            send({ type: 'answer', description: pc.localDescription })
            for (const c of pending.splice(0)) await pc.addIceCandidate(c)
            break
          case 'ice':
            if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate)
            else pending.push(msg.candidate)
            break
          case 'session_ended':
            setEndReason(msg.reason ?? null)
            setState('ended')
            break
        }
      }
      ws.onclose = (ev) => {
        if (cancelled) return
        if (ev.code === 4403) setEndReason('The session is no longer available')
        setState((s) => (s === 'error' ? s : 'ended'))
      }
    }

    run().catch((e: Error) => {
      if (!cancelled) {
        setError(e.message)
        setState('error')
      }
    })

    return () => {
      cancelled = true
      window.clearInterval(statsTimer)
      wsRef.current = null
      ws?.close()
      pc?.close()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [joinableId, videoRef])

  const setQuality = useCallback((level: Quality) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'quality', level }))
  }, [])

  return { state, error, endReason, info, setQuality }
}
