import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
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

    const a = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', currentEmail)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt));
      setItems(rows);
    });

    const b = onSnapshot(query(collection(db, 'notifications'), where('recipientId', '==', currentEmail)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setItems((previous) => {
        const merged = new Map();
        [...previous, ...rows].forEach((entry) => merged.set(entry.id, entry));
        return [...merged.values()].sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt));
      });
    });

    const c = onSnapshot(query(collection(db, 'notifications'), where('user', '==', currentEmail)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setItems((previous) => {
        const merged = new Map();
        [...previous, ...rows].forEach((entry) => merged.set(entry.id, entry));
        return [...merged.values()].sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt));
      });
    });

    return () => {
      a();
      b();
      c();
    };
  }, [currentEmail]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const visible = useMemo(() => (tab === 'unread' ? items.filter((i) => !i.read) : items), [items, tab]);

  const openNotification = async (item) => {
    if (!item.read) {
      await updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(() => {});
    }
    router.push(routeForNotification(item));
  };

  const markAllRead = async () => {
    await Promise.all(items.filter((i) => !i.read).map((item) => updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(() => {})));
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#0f172a', fontWeight: '900', fontSize: 26 }}>Notifications</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={{ color: '#2563eb', fontWeight: '800' }}>Mark all as read</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Tab text="All" active={tab === 'all'} onPress={() => setTab('all')} />
        <Tab text={`Unread (${unreadCount})`} active={tab === 'unread'} onPress={() => setTab('unread')} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text style={{ fontSize: 44 }}>🎉</Text>
            <Text style={{ color: '#0f172a', fontWeight: '900', marginTop: 8 }}>You&apos;re all caught up!</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => openNotification(item)}
            style={{
              backgroundColor: '#fff',
              borderWidth: 1,
              borderColor: '#e2e8f0',
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
        )}
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
