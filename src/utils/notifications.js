import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidNotificationChannel() {
  if (Device.osName !== 'Android') {
    return;
  }

  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4f46e5',
    sound: 'default',
  });
}

export function resolveNotificationRoute(notificationData = {}) {
  const screen = String(notificationData?.screen || '').trim().toLowerCase();
  const jobId = String(notificationData?.jobId || notificationData?.requestId || '').trim();

  if (screen === 'chat' && jobId) {
    return {
      pathname: '/chat',
      params: { jobId },
    };
  }

  if (screen === 'wallet') {
    return '/wallet';
  }

  if (screen === 'subscription') {
    return '/subscription';
  }

  if (screen === 'referral') {
    return '/referral';
  }

  if (screen === 'kyc') {
    return '/kyc/step1';
  }

  if (screen === 'admin') {
    return '/admin';
  }

  if (screen === 'confirm-completion' && jobId) {
    return {
      pathname: '/confirm-completion',
      params: { requestId: jobId },
    };
  }

  if (jobId) {
    return {
      pathname: '/job-details',
      params: { requestId: jobId },
    };
  }

  return '/notifications';
}

export async function registerForPushNotifications() {
  const currentUser = auth.currentUser;
  const userEmail = String(currentUser?.email || '').trim().toLowerCase();

  if (!currentUser || !userEmail) {
    return null;
  }

  try {
    await ensureAndroidNotificationChannel();

    if (!Device.isDevice) {
      return null;
    }

    const existingPermission = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermission.status;

    if (finalStatus !== 'granted') {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermission.status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      undefined;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {});
    const pushToken = tokenResponse?.data;

    if (!pushToken) {
      return null;
    }

    await setDoc(
      doc(db, 'users', userEmail),
      {
        email: userEmail,
        pushToken,
        fcmToken: pushToken,
        pushTokenUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return pushToken;
  } catch {
    return null;
  }
}

export const registerPushToken = registerForPushNotifications;
