import { useRouter } from 'expo-router';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

function toMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function ago(value) {
  const ms = toMs(value);
  if (!ms) return 'Now';
  const diffMins = Math.floor((Date.now() - ms) / 60000);
  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const h = Math.floor(diffMins / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  if (h < 48) return 'Yesterday';
  return new Date(ms).toLocaleDateString();
}

function icon(type) {
  const key = String(type || '').toLowerCase();
  if (key.includes('job')) return '💼';
  if (key.includes('payment')) return '💰';
  if (key.includes('message')) return '💬';
  if (key.includes('confirm')) return '✅';
  if (key.includes('kyc')) return '🪪';
  if (key.includes('withdraw')) return '💸';
  return '🔔';
}

function bucketForDate(value) {
  const ms = toMs(value);
  if (!ms) return 'Older';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  if (ms >= todayStart) return 'Today';
  if (ms >= yStart) return 'Yesterday';
  if (ms >= weekStart) return 'Earlier This Week';
  return 'Older';
}

function routeForNotification(n) {
  const type = String(n.type || '').toLowerCase();
  const jobId = String(n.jobId || n.requestId || '').trim();
  if (type === 'job_accepted' || type === 'job_done' || type === 'auto_confirmed') {
    return jobId ? { pathname: '/job-details', params: { requestId: jobId } } : '/my-requests';
  }
  if (type === 'payment_received' || type === 'withdrawal_paid') return '/wallet';
  if (type === 'new_message') return jobId ? { pathname: '/chat', params: { requestId: jobId } } : '/chat';
  if (type === 'kyc_approved') return '/profile';
  return '/notifications';
}

export default function Notifications() {
  const router = useRouter();
  const { user } = useAuthUser();
  const currentEmail = String(user?.email || '').trim().toLowerCase();

  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    if (!currentEmail) return undefined;

    const q1 = query(collection(db, 'notifications'), where('userId', '==', currentEmail), orderBy('createdAt', 'desc'), limit(50));
    const q2 = query(collection(db, 'notifications'), where('recipientId', '==', currentEmail), orderBy('createdAt', 'desc'), limit(30));
    const q3 = query(collection(db, 'notifications'), where('user', '==', currentEmail), orderBy('createdAt', 'desc'), limit(30));

    const mergeSnapshots = (...snapshots) => {
      const merged = new Map();
      snapshots.forEach((snap) => {
        snap.docs.forEach((entry) => merged.set(entry.id, { id: entry.id, ...entry.data() }));
      });
      return [...merged.values()].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    };

    const unsub1 = onSnapshot(q1, (snap) => {
      setItems((previous) => mergeSnapshots({ docs: previous.map((item) => ({ id: item.id, data: () => item })) }, snap));
    });

    const unsub2 = onSnapshot(q2, (snap) => {
      setItems((previous) => mergeSnapshots({ docs: previous.map((item) => ({ id: item.id, data: () => item })) }, snap));
    });

    const unsub3 = onSnapshot(q3, (snap) => {
      setItems((previous) => mergeSnapshots({ docs: previous.map((item) => ({ id: item.id, data: () => item })) }, snap));
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [currentEmail]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const visible = useMemo(() => (tab === 'unread' ? items.filter((i) => !i.read) : items), [items, tab]);
  const groupedRows = useMemo(() => {
    const groups = {
      Today: [],
      Yesterday: [],
      'Earlier This Week': [],
      Older: [],
    };
    visible.forEach((row) => {
      groups[bucketForDate(row.createdAt)].push(row);
    });

    const ordered = [];
    Object.keys(groups).forEach((key) => {
      if (groups[key].length) {
        ordered.push({ type: 'header', id: `header:${key}`, label: key });
        groups[key].forEach((item) => ordered.push({ type: 'item', id: item.id, item }));
      }
    });
    return ordered;
  }, [visible]);

  const openNotification = async (item) => {
    if (!item.read) {
      await updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(() => {});
    }
    router.push(routeForNotification(item));
  };

  const markAllRead = async () => {
    await Promise.all(items.filter((i) => !i.read).map((item) => {
      const payload = { read: true };
      if (item.userId) payload.userId = item.userId;
      if (item.recipientId) payload.recipientId = item.recipientId;
      if (item.user) payload.user = item.user;
      return updateDoc(doc(db, 'notifications', item.id), payload).catch(() => {});
    }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#1e3a8a', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: -1 }}>←</Text>
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 22, flex: 1 }}>Notifications</Text>
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={markAllRead}
              style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Mark all read</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {unreadCount > 0 ? (
          <Text style={{ color: '#93c5fd', fontSize: 12, marginTop: 6, marginLeft: 48 }}>
            {unreadCount} unread notification{unreadCount > 1 ? 's' : ''}
          </Text>
        ) : (
          <Text style={{ color: '#93c5fd', fontSize: 12, marginTop: 6, marginLeft: 48 }}>All caught up</Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12 }}>
        <Tab text="All" active={tab === 'all'} onPress={() => setTab('all')} />
        <Tab text={`Unread (${unreadCount})`} active={tab === 'unread'} onPress={() => setTab('unread')} />
      </View>

      <FlatList
        style={{ flex: 1, paddingHorizontal: 16 }}
        data={groupedRows}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text style={{ fontSize: 44 }}>🎉</Text>
            <Text style={{ color: '#0f172a', fontWeight: '900', marginTop: 8 }}>You&apos;re all caught up!</Text>
          </View>
        }
        renderItem={({ item: row }) => {
          if (row.type === 'header') {
            return (
              <Text style={{ marginTop: 14, marginBottom: 2, color: '#334155', fontSize: 12, fontWeight: '800' }}>
                {row.label}
              </Text>
            );
          }

          const item = row.item;
          return (
            <TouchableOpacity
              onPress={() => openNotification(item)}
              style={{
                backgroundColor: item.read ? '#f8fafc' : '#ffffff',
                borderWidth: 1,
                borderColor: item.read ? '#e2e8f0' : '#bfdbfe',
                borderRadius: 12,
                padding: 12,
                marginTop: 10,
                borderLeftWidth: item.read ? 1 : 4,
                borderLeftColor: item.read ? '#e2e8f0' : '#2563eb',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 24 }}>{icon(item.type)}</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: '#0f172a', fontWeight: item.read ? '700' : '900' }}>{item.title || 'Notification'}</Text>
                  <Text style={{ color: '#475569', marginTop: 2 }} numberOfLines={2}>{item.body || item.text || ''}</Text>
                </View>
                {!item.read ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#2563eb' }} /> : null}
              </View>
              <Text style={{ color: '#94a3b8', marginTop: 6, marginLeft: 34, fontSize: 12 }}>{ago(item.createdAt)}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function Tab({ text, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        borderBottomWidth: 2,
        borderBottomColor: active ? '#2563eb' : 'transparent',
        paddingVertical: 10,
        marginRight: 20,
      }}
    >
      <Text style={{ color: active ? '#2563eb' : '#64748b', fontWeight: '900' }}>{text}</Text>
    </TouchableOpacity>
  );
}
