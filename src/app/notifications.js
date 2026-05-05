import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';

import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

function toMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().getTime(); } catch { return 0; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function timeAgo(value) {
  const ms = toMs(value);
  if (!ms) return 'Now';
  const diff = Date.now() - ms;
  const h = Math.floor(diff / (60 * 60 * 1000));
  if (h < 1) return 'Now';
  if (h < 24) return `${h}h ago`;
  if (h < 48) return 'Yesterday';
  return new Date(ms).toLocaleDateString();
}

function groupNotifications(rows) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const groups = { Today: [], Yesterday: [], Earlier: [] };
  rows.forEach((item) => {
    const age = now - toMs(item.createdAt);
    if (age < dayMs) groups.Today.push(item);
    else if (age < dayMs * 2) groups.Yesterday.push(item);
    else groups.Earlier.push(item);
  });

  const flat = [];
  Object.entries(groups).forEach(([label, items]) => {
    if (items.length === 0) return;
    flat.push({ kind: 'header', id: `h-${label}`, label });
    items.forEach((payload) => flat.push({ kind: 'item', id: payload.id, payload }));
  });
  return flat;
}

function iconByType(type) {
  switch (String(type || '')) {
    case 'kyc_approved': return { icon: '✅', bg: '#dcfce7' };
    case 'kyc_rejected': return { icon: '❌', bg: '#fee2e2' };
    case 'subscription_activated': return { icon: '⭐', bg: '#fef3c7' };
    case 'referral_bonus': return { icon: '💰', bg: '#dcfce7' };
    case 'payment': return { icon: '💵', bg: '#dcfce7' };
    case 'message':
    case 'chat': return { icon: '💬', bg: '#dbeafe' };
    case 'dispute': return { icon: '⚠️', bg: '#fee2e2' };
    default: return { icon: '🔔', bg: '#f1f5f9' };
  }
}

export default function Notifications() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();

  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!isAuthReady) return undefined;
    if (!currentEmail) {
      setRows([]);
      setIsLoading(false);
      return undefined;
    }

    const byUser = new Map();
    const byUserId = new Map();
    const flush = () => {
      const merged = new Map([...byUser.entries(), ...byUserId.entries()]);
      const list = Array.from(merged.values()).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
      setRows(list);
      setIsLoading(false);
      setIsRefreshing(false);
    };

    const unsubUser = onSnapshot(query(collection(db, 'notifications'), where('user', '==', currentEmail)), (snap) => {
      byUser.clear();
      snap.docs.forEach((d) => byUser.set(d.id, { id: d.id, ...d.data() }));
      flush();
    }, () => setIsLoading(false));

    const unsubUserId = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', currentEmail)), (snap) => {
      byUserId.clear();
      snap.docs.forEach((d) => byUserId.set(d.id, { id: d.id, ...d.data() }));
      flush();
    }, () => setIsLoading(false));

    return () => {
      unsubUser();
      unsubUserId();
    };
  }, [currentEmail, isAuthReady]);

  const grouped = useMemo(() => groupNotifications(rows), [rows]);

  const markAsRead = async (item) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, 'notifications', item.id), { read: true });
    } catch {}
  };

  const markAllRead = async () => {
    const unread = rows.filter((r) => !r.read);
    await Promise.all(unread.map((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {})));
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 450);
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={{ height: 80, borderRadius: AppRadius.md, backgroundColor: '#e2e8f0', marginBottom: 10 }} />
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: AppColors.ink900, fontSize: 26, fontWeight: '900' }}>Notifications</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={{ color: '#2563eb', fontWeight: '800', fontSize: 12 }}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={grouped}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 56 }}>
            <Text style={{ fontSize: 64 }}>🔔</Text>
            <Text style={{ marginTop: 10, fontSize: 18, fontWeight: '800', color: AppColors.ink900 }}>No notifications yet</Text>
            <Text style={{ marginTop: 6, color: '#94a3b8', textAlign: 'center' }}>Job and payment activity will appear here</Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return <Text style={{ color: '#64748b', fontWeight: '800', marginTop: 6, marginBottom: 8 }}>{item.label}</Text>;
          }

          const n = item.payload;
          const typeMeta = iconByType(n.type);
          const unread = !n.read;

          return (
            <TouchableOpacity
              onPress={() => markAsRead(n)}
              activeOpacity={0.85}
              style={{
                backgroundColor: unread ? '#fff' : '#f8fafc',
                borderRadius: AppRadius.md,
                padding: 12,
                marginBottom: 8,
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderLeftWidth: unread ? 3 : 1,
                borderLeftColor: unread ? '#2563eb' : '#e2e8f0',
                ...AppShadow.card,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: typeMeta.bg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Text>{typeMeta.icon}</Text>
                </View>

                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{n.title || 'Notification'}</Text>
                  <Text style={{ color: '#64748b', marginTop: 4, lineHeight: 18 }} numberOfLines={2}>{n.body || n.text || ''}</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, alignSelf: 'flex-end' }}>{timeAgo(n.createdAt)}</Text>
                </View>

                {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563eb', marginTop: 4 }} /> : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity onPress={() => router.replace('/home')} style={{ marginTop: 8, alignSelf: 'center' }}>
        <Text style={{ color: '#64748b', fontWeight: '700' }}>← Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}
