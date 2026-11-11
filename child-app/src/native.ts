import { NativeModules } from 'react-native';

export interface StoredCredentials {
  serverUrl: string;
  deviceToken: string;
  deviceId: string;
  parentName: string;
}

interface FamilyMonitorNative {
  hasUsageAccess(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  /** JSON string matching the backend's /api/device/sync body. */
  getSyncPayload(days: number): Promise<string>;
  getIcons(packages: string[]): Promise<{ package: string; png_base64: string }[]>;
  getDeviceInfo(): Promise<{ model: string; osVersion: string; timezone: string }>;
  saveCredentials(serverUrl: string, deviceToken: string, deviceId: string, parentName: string): Promise<void>;
  getCredentials(): Promise<StoredCredentials | null>;
  clearCredentials(): Promise<void>;
  showShareRequestNotification(parentName: string): Promise<boolean>;
  cancelShareRequestNotification(): Promise<void>;
}

export const Native: FamilyMonitorNative = NativeModules.FamilyMonitor;
