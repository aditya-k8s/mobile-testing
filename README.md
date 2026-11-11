# Family Monitor

A lightweight parental monitoring application, built on consent. A parent can see how their child's
Android phone is used and can view the child's screen live. Live viewing happens only during a
session the child approves on the phone, and the phone shows an indicator for as long as sharing runs.

| Component | Path | Stack |
|---|---|---|
| Backend API | `backend/` | Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL |
| Parent dashboard | `parent-web/` | React 19, TypeScript, Vite, Recharts |
| Child app (Android) | `child-app/` | React Native 0.88, Kotlin native module, react-native-webrtc |

## How it works

```
 Child phone (Android)                 Backend (FastAPI)                Parent dashboard (browser)
 ---------------------                 -----------------                --------------------------
 UsageEvents -> /api/device/sync  ---> PostgreSQL  <---  REST  ------->  My Child, App Usage,
 (app open: every 5 min;                                                 Screen Time, Activity
  closed: WorkManager, 15 min)
 /ws/device  <---- share_request ----  /ws/parent ---- events ------->  notifications, live status
 MediaProjection + WebRTC  <======= /ws/stream (signalling only) =====>  WebRTC viewer
          \___________________ video, peer-to-peer or via TURN ________/
```

* **Screen video never passes through, and is never stored on, the API server.** The server only relays
  WebRTC signalling (SDP and ICE) inside a room. A short-lived stream token (60 seconds by default),
  issued only after the child approves, admits each side to that room.
* **Usage data** comes from Android's `UsageEvents` (Usage Access permission). Foreground intervals
  are split at the child's local midnight. Totals are uploaded as absolute values, so re-sending is
  idempotent.
* **Online status**: `Online` means the child app's live connection is open. `Online (background)`
  means the background sync reached the server within the last 20 minutes. Otherwise the device is
  `Offline`, and the parent is notified when it goes offline and when it reconnects.

### Screen-sharing session lifecycle

1. The parent clicks **Request screen sharing**. The session is `requested`, and the request expires
   after 90 seconds.
2. The child app shows Accept or Decline. If the app is closed, the request arrives via FCM (if
   configured) or when the child next opens the app.
3. If the child accepts, the session is `approved`. Android then shows its own screen-capture
   confirmation (MediaProjection).
4. Capture runs inside a `mediaProjection` foreground service, which shows an ongoing notification.
   The app also shows a red "Your screen is being shared" banner with a Stop button. When the peer
   connection is established, the session becomes `active`.
5. The session ends when any of the following happens:
   * the child taps Stop;
   * the parent clicks Stop or leaves the page;
   * either side disconnects;
   * Android revokes the projection;
   * the parent revokes access;
   * the 30-minute limit is reached.

The parent receives a notification for each step: approved, declined, started, ended.

## Prerequisites

* Python 3.12 and Node.js 22 or newer.
* PostgreSQL 14 or newer, or Docker.
* For the child app: JDK 17, Android Studio (SDK 36, NDK 27.1), and a physical Android 10+ phone.
  An emulator works for usage data, but screen capture should be tested on real hardware.

## Local development

### 1. Database

```bash
docker run -d --name fm-db -e POSTGRES_DB=family_monitor -e POSTGRES_USER=family \
  -e POSTGRES_PASSWORD=family -p 5432:5432 postgres:16-alpine
```

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate            # Windows; use  source .venv/bin/activate  on macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env              # set DATABASE_URL and JWT_SECRET
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pytest -q                         # end-to-end API tests (SQLite, no Postgres needed)
```

The API creates its tables on start-up. Interactive API documentation is served at
http://localhost:8000/docs.

### 3. Parent dashboard

```bash
cd parent-web
npm install
npm run dev                       # http://localhost:5173 (proxies /api and /ws to :8000)
```

Create an account, then go to **Settings > Create pairing code**.

### 4. Child app (Android)

```bash
cd child-app
npm install
npx react-native run-android      # with the phone connected via USB debugging
```

On the phone:

1. Read the monitoring notice with your child and tick the box to agree.
2. Enter the pairing code, a name for the phone, and the server address:
   * **USB-connected phone:** run `adb reverse tcp:8000 tcp:8000`, then use `http://localhost:8000`.
   * **Emulator:** use `http://10.0.2.2:8000` (the default).
   * **Same Wi-Fi:** use `http://<your-PC-LAN-IP>:8000`.
3. Turn on **Usage access** for Family Monitor when prompted, and allow notifications.

Debug builds allow cleartext HTTP. Release builds require HTTPS.

## Testing checklist on a real Android device

| # | Test | Expected |
|---|---|---|
| 1 | Pair with an expired or reused code | "This pairing code is invalid or has expired" |
| 2 | Pair with a valid code | Device appears on My Child; parent gets a "connected" notification |
| 3 | Use a few apps for a few minutes, reopen Family Monitor | App Usage and Screen Time show matching per-app totals and icons |
| 4 | Leave the app closed for 20 minutes or more | Device stays Online (background); usage keeps updating every ~15 min |
| 5 | Switch the phone to aeroplane mode for 25 minutes | Parent gets "went offline"; on reconnect, "back online" |
| 6 | Request sharing, then Decline on the phone | Parent notified "declined" |
| 7 | Request sharing, then Accept and confirm the Android prompt | Notification and red banner on the phone; live video on the dashboard; "started" notification |
| 8 | Change Quality to Low on the dashboard | Resolution and bitrate drop in the Connection panel |
| 9 | Rotate the phone during sharing | Viewer adapts its aspect ratio |
| 10 | Tap Stop on the phone, or stop via the system notification | Video stops; parent notified "ended" |
| 11 | Accept, then press Cancel at the Android prompt | Session ends with "Not started at the Android screen-capture prompt" |
| 12 | Parent closes the Live Screen page during sharing | Capture stops on the phone; notification disappears |
| 13 | Turn off Usage access in system settings | Parent warned that usage access is off |
| 14 | Parent: Settings > Revoke access | Phone shows "Monitoring is off"; background sync stops |
| 15 | Child: Disconnect this phone | Parent notified; device disappears from the dashboard |

## Deployment

```bash
cp .env.example .env              # set POSTGRES_PASSWORD, JWT_SECRET, ICE_SERVERS
docker compose up -d --build      # dashboard and API on http://<host>:8080
```

* **TLS is mandatory in production.** Put the stack behind HTTPS, for example Caddy, a cloud load
  balancer, or certbot with nginx. Browsers and Android release builds need `https://` and `wss://`.
* **TURN server.** STUN alone fails when the phone is on mobile data or behind a strict NAT. Run
  [coturn](https://github.com/coturn/coturn), or use a managed TURN service, and add it to
  `ICE_SERVERS`. Without TURN, sessions only work reliably when both devices are on the same
  network.
* **Single instance.** Live sockets are tracked in-process, so run one API worker. To scale out,
  replace `app/hub.py` with a Redis pub/sub fan-out.
* **Schema migrations.** Tables are created on start-up. Add Alembic before changing the schema.
* **Registration.** After creating the family's account(s), set `ALLOW_REGISTRATION=false`.
* **Android release build.** Create your own upload keystore, configure `signingConfigs.release` in
  `child-app/android/app/build.gradle`, then run `cd android && ./gradlew bundleRelease`. The
  default `DEFAULT_SERVER_URL` in `child-app/src/theme.ts` should point to your HTTPS domain.

### Optional: push notifications (FCM)

Without FCM, a request reaches the child app only while it is running. With FCM, it arrives as a
notification even when the app is closed.

1. Create a Firebase project and add an Android app with package `com.familymonitor.child`.
2. Put `google-services.json` in `child-app/android/app/`. The Gradle plugin is applied only when
   this file exists.
3. Create a service-account key with the *Firebase Cloud Messaging API* enabled, mount it into the
   API container, and set `FCM_SERVICE_ACCOUNT_FILE` to its path.

Parent notifications are delivered in the dashboard in real time. Browser notifications can also be
switched on under Settings and show while the tab is open in the background. Web Push for a closed
browser is not implemented.

## Security and privacy model

| Requirement | Implementation |
|---|---|
| Parent authentication | bcrypt (cost 12) password hashes; HS256 JWT (12 h); rate-limited login; constant-time handling of unknown emails |
| Device pairing | 8-character single-use code, 10-minute expiry, stored as SHA-256, rate-limited; issuing a new code invalidates the old one |
| Device credentials | 256-bit random token per device, stored server-side as SHA-256 and on the phone in app-private storage |
| Short-lived stream tokens | 60-second JWT scoped to one session and one role; only issued for `approved` or `active` sessions |
| Encrypted communication | HTTPS/WSS in production (TLS at the proxy); WebRTC media is always DTLS-SRTP encrypted |
| Explicit child consent | Consent screen before pairing (timestamp stored); per-session Accept; Android's own capture prompt |
| Visible indicator | Foreground-service notification, plus in-app banner with Stop, for the whole session |
| No hidden recording | No server-side media path. Video is not recorded or stored anywhere |
| No microphone or camera | Audio and camera are never requested. `CAMERA`, `RECORD_AUDIO` and Bluetooth permissions are stripped from the merged manifest |
| No private messages | Only app package names, labels, icons and foreground durations are collected |
| Session history | Every request and session is kept with outcome, duration and end reason (Activity History) |
| Access revocation | Parent: Revoke, or Remove and delete data (erases all collected data). Child: Disconnect, and the parent is notified. Both invalidate the device token immediately |
| WebSocket auth | First-message authentication, so tokens never appear in URLs or logs |

This application processes personal data about a child. Before using it, confirm your obligations
under the applicable data-protection law (for example UK GDPR or GDPR, including the ICO Children's
Code). Areas to check include retention periods, the lawful basis for processing, and the child's
rights. Qualified legal review is advisable before any wider distribution. Google Play also has
specific policies for apps that use `PACKAGE_USAGE_STATS` and screen capture.

## iOS limitations

An iOS child app is **not** included. These platform constraints apply:

* **Live screen sharing.** iOS does not allow an app to capture the whole screen in the background
  on request. The only supported method is a **ReplayKit Broadcast Upload Extension**. The child
  must start it manually from Control Centre (Screen Recording, long-press, choose the app) every
  time, and iOS shows a red status-bar indicator. The extension has a memory limit of about 50 MB,
  so a WebRTC encoder must be implemented carefully in native code. A parent request can only
  *ask* the child to start a broadcast; it cannot start one.
* **App usage.** iOS does not expose per-app usage to third-party apps. Apple's **Screen Time API**
  (FamilyControls, DeviceActivity, ManagedSettings) requires the Family Controls entitlement, which
  must be requested from Apple, and Family Sharing authorisation. Even then, usage data can only be
  *displayed* on the device inside a sandboxed `DeviceActivityReport` extension. It cannot be
  exported to a server. A remote usage dashboard like the Android one is therefore not possible on
  iOS.
* **Current app.** Not available on iOS.

The backend already models `platform: ios`. The dashboard disables live sharing for iOS devices.

## Known limitations of this MVP

* "Current app" refreshes in real time while the child app is open. With the app closed it is the
  value from the last background sync, up to about 15 minutes old.
* Android caps background work. Aggressive battery optimisation on some brands can delay the
  15-minute sync. Ask the child to exclude Family Monitor from battery optimisation if updates lag.
* Leaving the Live Screen page, or reloading it, ends the session deliberately. A new request is
  needed to view again.
* Android 14+ may let the child share a single app instead of the entire screen. This is the
  child's choice and is respected.
* The rate limiter is in-memory and per-process.

## API overview

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register`, `/login`; `GET /api/auth/me` | parent | account |
| `POST /api/pairing-codes` | parent | create a pairing code |
| `GET/PATCH/DELETE /api/devices/{id}` (`?purge=true`) | parent | device management and revocation |
| `GET /api/devices/{id}/summary` | parent | dashboard data |
| `GET /api/devices/{id}/usage?from=&to=` | parent | per-day and per-app usage |
| `POST /api/devices/{id}/screen-sessions`; `POST /api/screen-sessions/{sid}/end`, `/stream-token` | parent | sessions |
| `GET /api/devices/{id}/screen-sessions`; `GET /api/events`; `POST /api/events/read-all` | parent | history and notifications |
| `POST /api/device/pair` | child | pair with code and consent |
| `POST /api/device/sync`, `/fcm-token`; `GET/DELETE /api/device/me` | child | usage upload, push token, unpair |
| `GET /api/device/screen-sessions/pending`; `POST .../{sid}/respond`, `/started`, `/end`, `/stream-token` | child | session handling |
| `WS /ws/parent`, `/ws/device`, `/ws/stream` | both | live status, requests, WebRTC signalling |
