/// <reference types="vite/client" />

/** Present only when the dashboard runs inside the Family Monitor Parent Android app. */
interface FamilyMonitorAppBridge {
  notify(title: string, body: string): void
  isApp(): boolean
}
interface Window {
  FamilyMonitorApp?: FamilyMonitorAppBridge
}
