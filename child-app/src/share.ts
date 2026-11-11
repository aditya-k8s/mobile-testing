import {
  mediaDevices,
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import type { DeviceApi } from './api';

type Quality = 'high' | 'medium' | 'low';

const QUALITY: Record<Quality, { maxBitrate: number; scaleResolutionDownBy: number; maxFramerate: number }> = {
  high: { maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 24 },
  medium: { maxBitrate: 1_000_000, scaleResolutionDownBy: 1.5, maxFramerate: 15 },
  low: { maxBitrate: 350_000, scaleResolutionDownBy: 2.5, maxFramerate: 10 },
};

/**
 * One screen-sharing session on the child's device.
 *
 * start() shows Android's own screen-capture consent prompt (MediaProjection). react-native-webrtc
 * then runs capture inside a mediaProjection foreground service with an ongoing notification.
 * Capture stops when: the child taps Stop, the parent stops, either side disconnects, the session
 * time limit is reached, or Android revokes the projection (track "ended").
 */
export class ScreenShare {
  private stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [];
  private quality: Quality = 'high';
  private reportedStart = false;
  private stopped = false;

  constructor(
    private readonly api: DeviceApi,
    readonly sessionId: string,
    private readonly onEnd: (reason: string) => void,
  ) {}

  async start(): Promise<void> {
    // Throws if the child cancels the system prompt.
    this.stream = await mediaDevices.getDisplayMedia({});
    if (this.stopped) {
      this.releaseCapture();
      return;
    }
    const track = this.stream.getVideoTracks()[0];
    track.addEventListener('ended', () => void this.stop('Screen capture was stopped from Android'));

    const [{ iceServers }, { token }] = await Promise.all([
      this.api.rtcConfig(),
      this.api.streamToken(this.sessionId), // fresh short-lived token: the system prompt may have taken a while
    ]);
    this.iceServers = iceServers;

    const ws = new WebSocket(`${this.api.wsBase}/ws/stream`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (ev) => void this.onSignal(JSON.parse(String(ev.data)));
    ws.onclose = () => {
      if (!this.stopped) void this.stop('Connection to the server was lost');
    };
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async onSignal(msg: any) {
    try {
      switch (msg.type) {
        case 'peer_joined':
          await this.negotiate();
          break;
        case 'answer':
          await this.pc?.setRemoteDescription(new RTCSessionDescription(msg.description));
          break;
        case 'ice':
          if (msg.candidate) await this.pc?.addIceCandidate(new RTCIceCandidate(msg.candidate));
          break;
        case 'quality':
          if (msg.level in QUALITY) {
            this.quality = msg.level;
            await this.applyQuality();
          }
          break;
        case 'session_ended':
          await this.stop(msg.reason ?? 'Session ended', false);
          break;
      }
    } catch (e) {
      console.warn('signalling error', e);
    }
  }

  /** (Re)create the peer connection whenever the viewer (re)joins, and send an offer. */
  private async negotiate() {
    if (!this.stream) return;
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    for (const track of this.stream.getVideoTracks()) pc.addTrack(track, this.stream);

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) this.send({ type: 'ice', candidate: e.candidate });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected' && !this.reportedStart) {
        this.reportedStart = true;
        void this.api.started(this.sessionId).catch(() => undefined);
        void this.applyQuality();
      }
    });

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    this.send({ type: 'offer', description: pc.localDescription });
  }

  private async applyQuality() {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    const q = QUALITY[this.quality];
    for (const enc of params.encodings) {
      enc.maxBitrate = q.maxBitrate;
      enc.maxFramerate = q.maxFramerate;
      enc.scaleResolutionDownBy = q.scaleResolutionDownBy;
    }
    await sender.setParameters(params);
  }

  private releaseCapture() {
    this.stream?.getTracks().forEach((t) => t.stop()); // stops MediaProjection and its foreground service
    this.stream?.release();
    this.stream = null;
  }

  async stop(reason: string, notifyServer = true) {
    if (this.stopped) return;
    this.stopped = true;
    this.releaseCapture();
    this.pc?.close();
    this.pc = null;
    this.ws?.close();
    this.ws = null;
    if (notifyServer) await this.api.end(this.sessionId, reason).catch(() => undefined);
    this.onEnd(reason);
  }
}
