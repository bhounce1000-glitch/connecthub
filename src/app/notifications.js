import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import ListScreen from '../components/ui/list-screen.js';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

function toEpoch(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof value === 'object' && typeof value?.seconds === 'number') {
    return value.seconds * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getNotificationTheme(type) {
  if (type === 'kyc_approved') {
    return {
      borderLeftColor: '#16a34a',
      titleColor: '#166534',
      icon: '✅',
    };
  }

  if (type === 'kyc_rejected') {
    return {
      borderLeftColor: '#dc2626',
      titleColor: '#7f1d1d',
      icon: '❌',
    };
  }

  return {
    borderLeftColor: '#2563eb',
    titleColor: '#0f172a',
    icon: '🔔',
  };
}

export default function Notifications() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = useMemo(() => (user?.email || '').trim().toLowerCase(), [user?.email]);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady) return undefined;

    if (!currentEmail) {
      setNotifications([]);
      setIsLoading(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(collection(db, 'notifications'), (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => {
          const owner = String(item.userId || item.user || '').trim().toLowerCase();
          return owner === currentEmail;
        })
        .sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt));

      setNotifications(rows);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentEmail, isAuthReady]);

  const handleMarkAsRead = async (item) => {
    if (item.read === true) return;
    try {
      await updateDoc(doc(db, 'notifications', item.id), { read: true });
    } catch {
      // non-blocking
    }
  };

  return (
    <ListScreen
      eyebrow="UPDATES"
      title="Notifications"
      subtitle="Stay on top of request and payment activity."
      accentColor="#1d4ed8"
      accentTextColor="#dbeafe"
      toolbar={<AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} style={{ marginBottom: 12 }} />}
      isLoading={isLoading}
      loadingView={(
        <AppCard>
          <LoadingSkeleton height={18} width="42%" style={{ marginBottom: 12 }} />
          <LoadingSkeleton height={42} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={42} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={42} width="100%" />
        </AppCard>
      )}
      hasItems={notifications.length > 0}
      emptyTitle="No notifications yet"
      emptyDescription="When request updates or payment events arrive, they will appear here."
    >
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const theme = getNotificationTheme(item.type);
          const title = String(item.title || 'Notification');
          const body = String(item.body || item.text || '');

          return (
            <TouchableOpacity onPress={() => handleMarkAsRead(item)} activeOpacity={0.8}>
              <AppCard
                style={{
                  marginBottom: 10,
                  elevation: 2,
                  borderLeftWidth: 4,
                  borderLeftColor: theme.borderLeftColor,
                  backgroundColor: item.read ? '#f8fafc' : '#eff6ff',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ marginRight: 6 }}>{theme.icon}</Text>
                  <Text style={{ color: theme.titleColor, fontWeight: '700', flex: 1 }}>{title}</Text>
                  {!item.read ? <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '700' }}>NEW</Text> : null}
                </View>

                <Text style={{ marginBottom: 8, color: '#0f172a', lineHeight: 20 }}>{body}</Text>

                <Text style={{ color: '#64748b', fontSize: 12 }}>{toDisplayDateTime(item.createdAt)}</Text>
              </AppCard>
            </TouchableOpacity>
          );
        }}
      />
    </ListScreen>
  );
}
