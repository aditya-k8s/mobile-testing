export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SessionInfo {
  id: string;
  status: string;
  request_expires_at: string;
}

export interface SyncResult {
  missing_icons: string[];
}

async function request<T>(url: string, method: string, token: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === 'string') message = j.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function normaliseServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function pair(serverUrl: string, body: Record<string, unknown>) {
  return request<{ device_id: string; device_token: string; parent_name: string }>(
    `${normaliseServerUrl(serverUrl)}/api/device/pair`, 'POST', null, body,
  );
}

export class DeviceApi {
  constructor(readonly serverUrl: string, private readonly token: string) {}

  get wsBase() {
    return this.serverUrl.replace(/^http/, 'ws');
  }

  get deviceToken() {
    return this.token;
  }

  private call<T>(path: string, method = 'GET', body?: unknown) {
    return request<T>(this.serverUrl + path, method, this.token, body);
  }

  me = () => this.call<{ device_id: string; name: string; parent_name: string }>('/api/device/me');
  unpair = () => this.call<void>('/api/device/me', 'DELETE');
  sync = (body: unknown) => this.call<SyncResult>('/api/device/sync', 'POST', body);
  setFcmToken = (token: string) => this.call<void>('/api/device/fcm-token', 'POST', { token });
  rtcConfig = () => this.call<{ iceServers: { urls: string | string[]; username?: string; credential?: string }[] }>('/api/device/rtc-config');
  pending = () => this.call<{ session: SessionInfo | null; parent_name?: string }>('/api/device/screen-sessions/pending');
  respond = (sid: string, approve: boolean) =>
    this.call<{ session: SessionInfo; stream_token: string | null }>(`/api/device/screen-sessions/${sid}/respond`, 'POST', { approve });
  streamToken = (sid: string) => this.call<{ token: string }>(`/api/device/screen-sessions/${sid}/stream-token`, 'POST');
  started = (sid: string) => this.call<SessionInfo>(`/api/device/screen-sessions/${sid}/started`, 'POST');
  end = (sid: string, reason: string) => this.call<SessionInfo>(`/api/device/screen-sessions/${sid}/end`, 'POST', { reason });
}
