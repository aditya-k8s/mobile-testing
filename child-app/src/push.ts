import { getApp } from '@react-native-firebase/app';
import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import type { DeviceApi } from './api';

/**
 * Registers this device for Firebase Cloud Messaging so screen-sharing requests can reach it while
 * the app is closed. Optional: without google-services.json Firebase is not initialised and this
 * quietly does nothing; requests are then delivered when the child opens the app.
 */
export async function registerPush(api: DeviceApi): Promise<() => void> {
  try {
    const messaging = getMessaging(getApp());
    await api.setFcmToken(await getToken(messaging));
    return onTokenRefresh(messaging, (t) => void api.setFcmToken(t).catch(() => undefined));
  } catch {
    return () => undefined;
  }
}
