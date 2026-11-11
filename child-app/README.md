# Family Monitor: child app (Android)

See the main [README](../README.md) for setup, testing and release instructions.

Native code lives in `android/app/src/main/java/com/familymonitor/child/`:

- `UsageCollector.kt`: per-app foreground time from UsageEvents, split at local midnight
- `UsageSyncWorker.kt`: 15-minute WorkManager upload while the app is closed
- `MonitorModule.kt`: JS bridge (usage access, payloads, icons, credentials, request notification)

Screen capture uses react-native-webrtc `getDisplayMedia()` (MediaProjection), with its
foreground service enabled in `MainApplication.kt`.
