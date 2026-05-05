import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';

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

  if (type === 'message') {
    return { borderLeftColor: '#2563eb', titleColor: '#1d4ed8', icon: '💬' };
  }
  if (type === 'payment') {
    return { borderLeftColor: '#16a34a', titleColor: '#166534', icon: '💰' };
  }
  if (type === 'review') {
    return { borderLeftColor: '#d97706', titleColor: '#92400e', icon: '⭐' };
  }
  return {
    borderLeftColor: '#94a3b8',
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const groupedRows = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const groups = { Today: [], Yesterday: [], Earlier: [] };

    notifications.forEach((item) => {
      const age = now - toEpoch(item.createdAt);
      if (age < dayMs) groups.Today.push(item);
      else if (age < dayMs * 2) groups.Yesterday.push(item);
      else groups.Earlier.push(item);
    });

    const rows = [];
    Object.entries(groups).forEach(([label, items]) => {
      if (items.length === 0) return;
      rows.push({ kind: 'header', id: `header-${label}`, label });
      items.forEach((item) => rows.push({ kind: 'item', id: item.id, payload: item }));
    });
    return rows;
  }, [notifications]);

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

  const markAllAsRead = async () => {
    const unread = notifications.filter((item) => !item.read);
    await Promise.all(unread.map((item) => updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(() => {})));
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 400);
  };

  return (
    <ListScreen
      eyebrow="UPDATES"
      title="Notifications"
      subtitle="Stay on top of request and payment activity."
      accentColor="#1d4ed8"
      accentTextColor="#dbeafe"
      toolbar={(
        <View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} style={{ flex: 1 }} />
            <AppButton label="Mark all as read" variant="primary" onPress={markAllAsRead} style={{ flex: 1 }} />
          </View>
        </View>
      )}
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
        data={groupedRows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return <Text style={{ color: '#475569', fontWeight: '800', marginBottom: 8, marginTop: 4 }}>{item.label}</Text>;
          }

          const payload = item.payload;
          const theme = getNotificationTheme(payload.type);
          const title = String(payload.title || 'Notification');
          const body = String(payload.body || payload.text || '');

          return (
            <TouchableOpacity onPress={() => handleMarkAsRead(payload)} activeOpacity={0.8}>
              <AppCard
                style={{
                  marginBottom: 10,
                  elevation: 2,
                  borderLeftWidth: 4,
                  borderLeftColor: theme.borderLeftColor,
                  backgroundColor: payload.read ? '#f8fafc' : '#ffffff',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ marginRight: 6 }}>{theme.icon}</Text>
                  <Text style={{ color: theme.titleColor, fontWeight: '700', flex: 1 }}>{title}</Text>
                  {!payload.read ? <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '700' }}>NEW</Text> : null}
                </View>

                <Text style={{ marginBottom: 8, color: '#0f172a', lineHeight: 20 }}>{body}</Text>

                <Text style={{ color: '#64748b', fontSize: 12, alignSelf: 'flex-end' }}>{toDisplayDateTime(payload.createdAt)}</Text>
              </AppCard>
            </TouchableOpacity>
          );
        }}
      />
    </ListScreen>
  );
}
