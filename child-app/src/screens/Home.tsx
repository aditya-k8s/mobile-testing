import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Modal, PermissionsAndroid, Platform, ScrollView, Text, View } from 'react-native';
import { ApiError, DeviceApi } from '../api';
import { Bullets, Button, StatusRow } from '../components';
import { Native, type StoredCredentials } from '../native';
import { registerPush } from '../push';
import { ScreenShare } from '../share';
import { colours, s } from '../theme';
import { NOT_SHARED } from './Consent';

interface Request {
  id: string;
  expiresAt: number;
  parentName: string;
}

interface TodayPreview {
  total: number;
  apps: { name: string; ms: number }[];
}

function fmt(ms: number) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

const SYNC_INTERVAL = 5 * 60 * 1000;

export default function Home({ creds, onDisconnected }: {
  creds: StoredCredentials;
  onDisconnected: (why: 'revoked' | 'unpaired') => void;
}) {
  const api = useMemo(() => new DeviceApi(creds.serverUrl, creds.deviceToken), [creds]);
  const [connected, setConnected] = useState(false);
  const [usageAccess, setUsageAccess] = useState<boolean | null>(null);
  const [notificationsOk, setNotificationsOk] = useState(true);
  const [today, setToday] = useState<TodayPreview | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const shareRef = useRef<ScreenShare | null>(null);
  const firstSync = useRef(true);
  const disconnectedRef = useRef(onDisconnected);
  disconnectedRef.current = onDisconnected;

  const isRevoked = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      disconnectedRef.current('revoked');
      return true;
    }
    return false;
  };

  const sync = useCallback(async () => {
    try {
      const payload = JSON.parse(await Native.getSyncPayload(firstSync.current ? 7 : 2));
      setUsageAccess(payload.usage_permission);
      const todayData = payload.days?.[payload.days.length - 1];
      if (todayData) {
        const apps = todayData.apps
          .map((a: { name: string; foreground_ms: number }) => ({ name: a.name, ms: a.foreground_ms }))
          .sort((a: { ms: number }, b: { ms: number }) => b.ms - a.ms);
        setToday({ total: apps.reduce((t: number, a: { ms: number }) => t + a.ms, 0), apps: apps.slice(0, 5) });
      }
      const r = await api.sync(payload);
      firstSync.current = false;
      if (r.missing_icons.length) {
        const icons = await Native.getIcons(r.missing_icons.slice(0, 60));
        if (icons.length) await api.sync({ usage_permission: payload.usage_permission, icons });
      }
      setLastSync(new Date());
    } catch (e) {
      isRevoked(e);
    }
  }, [api]);

  const checkPending = useCallback(async () => {
    try {
      const r = await api.pending();
      if (r.session?.status === 'requested') {
        setRequest({ id: r.session.id, expiresAt: Date.parse(r.session.request_expires_at), parentName: r.parent_name ?? creds.parentName });
      }
    } catch (e) {
      isRevoked(e);
    }
  }, [api, creds.parentName]);

  const checkNotifications = useCallback(async () => {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      setNotificationsOk(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS));
    }
  }, []);

  // Control channel: share requests, cancellation and revocation arrive here.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 1000;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const sock = new WebSocket(`${api.wsBase}/ws/device`);
      ws = sock;
      sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token: api.deviceToken }));
      sock.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        switch (m.type) {
          case 'ready':
            setConnected(true);
            retry = 1000;
            heartbeat = setInterval(() => sock.send(JSON.stringify({ type: 'heartbeat' })), 60000);
            break;
          case 'share_request':
            setRequest({ id: m.session.id, expiresAt: Date.parse(m.session.request_expires_at), parentName: m.parent_name });
            if (AppState.currentState !== 'active') void Native.showShareRequestNotification(m.parent_name);
            break;
          case 'session_closed':
            setRequest((r) => (r?.id === m.session_id ? null : r));
            void Native.cancelShareRequestNotification();
            if (shareRef.current?.sessionId === m.session_id) void shareRef.current?.stop(m.reason, false);
            break;
          case 'revoked':
            disconnectedRef.current('revoked');
            break;
        }
      };
      sock.onclose = (ev) => {
        setConnected(false);
        clearInterval(heartbeat);
        if (stopped) return;
        if (ev.code === 4401 || ev.code === 4003) {
          disconnectedRef.current('revoked');
          return;
        }
        reconnect = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(reconnect);
      ws?.close();
    };
  }, [api]);

  useEffect(() => {
    void sync();
    void checkPending();
    void checkNotifications();
    let unsubscribePush = () => {};
    void registerPush(api).then((u) => (unsubscribePush = u));
    const timer = setInterval(() => void sync(), SYNC_INTERVAL);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void sync();
        void checkPending();
        void checkNotifications();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      unsubscribePush();
      void shareRef.current?.stop('The app was closed');
    };
  }, [api, sync, checkPending, checkNotifications]);

  // Countdown for an open request.
  useEffect(() => {
    if (!request) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() > request.expiresAt) setRequest(null);
    }, 1000);
    return () => clearInterval(t);
  }, [request]);

  const respond = async (approve: boolean) => {
    const req = request;
    if (!req) return;
    setRequest(null);
    void Native.cancelShareRequestNotification();
    try {
      await api.respond(req.id, approve);
      if (!approve) return;
      const share = new ScreenShare(api, req.id, (reason) => {
        shareRef.current = null;
        setSharing(null);
        setNotice(`Screen sharing ended: ${reason}`);
      });
      shareRef.current = share;
      setSharing(req.parentName);
      try {
        await share.start();
      } catch {
        await share.stop('Not started at the Android screen-capture prompt');
      }
    } catch (e) {
      if (!isRevoked(e)) setNotice((e as Error).message);
    }
  };

  const disconnect = () => {
    Alert.alert(
      'Disconnect this phone?',
      `${creds.parentName} will be told that monitoring was turned off, and will no longer receive data from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await shareRef.current?.stop('Device disconnected');
            await api.unpair().catch(() => undefined);
            onDisconnected('unpaired');
          },
        },
      ],
    );
  };

  const secondsLeft = request ? Math.max(0, Math.round((request.expiresAt - now) / 1000)) : 0;

  return (
    <View style={{ flex: 1 }}>
      {sharing && (
        <View style={{ backgroundColor: colours.live, padding: 16, gap: 10 }} accessibilityLiveRegion="polite">
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Your screen is being shared</Text>
          <Text style={{ color: '#fff' }}>{sharing} can see everything on your screen right now. No sound is shared.</Text>
          <Button title="Stop sharing" onPress={() => void shareRef.current?.stop('Stopped by child')} />
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Family Monitor</Text>

        <View style={[s.card, { backgroundColor: colours.goodBg, borderColor: colours.goodBg }]}>
          <Text style={[s.h2, { color: colours.good }]}>Monitoring is on</Text>
          <Text style={s.body}>Connected to {creds.parentName}.</Text>
          <Text style={s.muted}>
            {connected ? 'Live connection active.' : 'Connecting…'}
            {lastSync ? ` Last update ${lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : ''}
          </Text>
        </View>

        {notice && (
          <View style={[s.card, { backgroundColor: colours.warnBg, borderColor: colours.warnBg }]}>
            <Text style={s.body}>{notice}</Text>
            <Button title="Dismiss" onPress={() => setNotice(null)} />
          </View>
        )}

        <View style={s.card}>
          <Text style={s.h2}>Permissions</Text>
          <StatusRow
            ok={!!usageAccess}
            label={usageAccess ? 'Usage access is on' : 'Usage access is off'}
            detail="Lets this app read how long each app is used. Required for screen-time reports."
          />
          {usageAccess === false && <Button title="Turn on usage access" kind="primary" onPress={() => void Native.openUsageAccessSettings()} />}
          <View style={{ height: 8 }} />
          <StatusRow
            ok={notificationsOk}
            label={notificationsOk ? 'Notifications are on' : 'Notifications are off'}
            detail="Needed to show screen-sharing requests and the sharing indicator."
          />
          {!notificationsOk && (
            <Button
              title="Allow notifications"
              onPress={() =>
                void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).then(() => checkNotifications())
              }
            />
          )}
          <View style={{ height: 8 }} />
          <StatusRow ok label="Camera and microphone are never used" detail="This app does not request them." />
        </View>

        <View style={s.card}>
          <Text style={s.h2}>What {creds.parentName} sees today</Text>
          {today ? (
            <>
              <Text style={s.body}>Screen time: {fmt(today.total)}</Text>
              {today.apps.map((a) => (
                <Text key={a.name} style={s.muted}>{a.name}: {fmt(a.ms)}</Text>
              ))}
            </>
          ) : (
            <Text style={s.muted}>{usageAccess === false ? 'Turn on usage access to see this.' : 'Loading…'}</Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.h2}>Never shared</Text>
          <Bullets items={NOT_SHARED} />
        </View>

        <Button title="Disconnect this phone" onPress={disconnect} />
      </ScrollView>

      <Modal visible={!!request} transparent animationType="fade" onRequestClose={() => void respond(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={[s.card, { gap: 12 }]}>
            <Text style={s.h2}>{request?.parentName} would like to see your screen</Text>
            <Text style={s.body}>
              If you accept, Android will ask you to confirm. Your parent will then see your screen live until you or they stop
              it. A notification stays visible the whole time. Nothing is recorded and no sound is shared.
            </Text>
            <Text style={s.muted}>This request expires in {secondsLeft}s.</Text>
            <Button title="Accept" kind="primary" onPress={() => void respond(true)} />
            <Button title="Decline" onPress={() => void respond(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
