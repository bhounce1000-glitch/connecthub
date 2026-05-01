import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

export async function registerPushToken() {
  const currentUser = auth.currentUser;
  const userEmail = String(currentUser?.email || '').trim().toLowerCase();

  if (!currentUser || !userEmail) {
    return null;
  }

  try {
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
        pushToken,
        pushTokenUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return pushToken;
  } catch {
    return null;
  }
}
