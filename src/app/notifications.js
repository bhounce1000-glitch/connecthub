import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

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
    case 'referral_bonus': return { icon: '🎁', bg: '#dcfce7' };
    case 'payment': return { icon: '💵', bg: '#dcfce7' };
    case 'message':
    case 'chat': return { icon: '💬', bg: '#dbeafe' };
    case 'dispute': return { icon: '⚠️', bg: '#fee2e2' };
    case 'withdrawal_request': return { icon: '📤', bg: '#ffedd5' };
    case 'withdrawal_pending': return { icon: '⏳', bg: '#fef3c7' };
    case 'withdrawal_completed': return { icon: '💸', bg: '#dcfce7' };
    case 'withdrawal_rejected': return { icon: '↩️', bg: '#fee2e2' };
    default: return { icon: '🔔', bg: '#f1f5f9' };
  }
}

function getRoute(n) {
  const type = String(n.type || '');
  if (
    type === 'withdrawal_request' ||
    type === 'withdrawal_pending' ||
    type === 'withdrawal_completed' ||
    type === 'withdrawal_rejected'
  ) {
    return '/wallet';
  }
  if (type === 'payment' || type === 'wallet_topup') {
    return '/wallet';
  }
  if (type === 'referral_bonus') {
    return '/referral';
  }
  if (type === 'subscription_activated') {
    return '/subscription';
  }
  if (type === 'kyc_approved' || type === 'kyc_rejected') {
    return '/profile';
  }
  if (type === 'message' || type === 'chat') {
    if (n.requestId || n.jobId) {
      return { pathname: '/chat', params: { requestId: n.requestId || n.jobId } };
    }
    return '/chat';
  }
  if (type === 'dispute') {
    if (n.requestId) {
      return { pathname: '/job-details', params: { id: n.requestId } };
    }
    return '/history';
  }
  if (n.requestId) {
    return { pathname: '/job-details', params: { id: n.requestId } };
  }
  return null;
}

export default function Notifications() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();

  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

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
  const stickyHeaderIndices = useMemo(
    () => grouped.map((item, index) => (item.kind === 'header' ? index : -1)).filter((index) => index >= 0),
    [grouped]
  );

  const markAsRead = async (item) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, 'notifications', item.id), { read: true });
    } catch {}
  };

  const handlePress = async (n) => {
    // Toggle expand/collapse
    setExpandedId((prev) => (prev === n.id ? null : n.id));
    // Mark read in background (non-blocking)
    markAsRead(n);
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
        stickyHeaderIndices={stickyHeaderIndices}
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
            return (
              <View style={{ backgroundColor: '#f8fafc', paddingTop: 6, paddingBottom: 8 }}>
                <Text style={{ color: '#64748b', fontWeight: '800' }}>{item.label}</Text>
              </View>
            );
          }

          const n = item.payload;
          const typeMeta = iconByType(n.type);
          const unread = !n.read;
          const route = getRoute(n);
          const isExpanded = expandedId === n.id;

          const rightAction = !unread ? null : (
            <View style={{ justifyContent: 'center', alignItems: 'center', width: 96, marginBottom: 8, borderRadius: AppRadius.md, backgroundColor: '#2563eb' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Mark Read</Text>
            </View>
          );

          return (
            <Swipeable overshootRight={false} renderRightActions={() => rightAction} onSwipeableOpen={() => markAsRead(n)}>
            <TouchableOpacity
              onPress={() => handlePress(n)}
              activeOpacity={0.85}
              style={{
                backgroundColor: unread ? '#fff' : '#f8fafc',
                borderRadius: AppRadius.md,
                padding: 12,
                marginBottom: 8,
                borderWidth: 1,
                borderColor: isExpanded ? '#93c5fd' : '#e2e8f0',
                borderLeftWidth: unread ? 3 : 1,
                borderLeftColor: unread ? '#2563eb' : '#e2e8f0',
                ...AppShadow.card,
              }}
            >
              {/* Header row */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: typeMeta.bg, alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 }}>
                  <Text style={{ fontSize: 18 }}>{typeMeta.icon}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 14 }}>{n.title || 'Notification'}</Text>
                  <Text
                    style={{ color: '#64748b', marginTop: 3, lineHeight: 18, fontSize: 13 }}
                    numberOfLines={isExpanded ? undefined : 2}
                  >
                    {n.body || n.text || ''}
                  </Text>
                </View>

                <View style={{ alignItems: 'flex-end', marginLeft: 8, flexShrink: 0 }}>
                  {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563eb', marginBottom: 4 }} /> : null}
                  <Text style={{ color: '#94a3b8', fontSize: 10 }}>{isExpanded ? '▲' : '▼'}</Text>
                </View>
              </View>

              {/* Timestamp always visible */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginLeft: 50 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>{timeAgo(n.createdAt)}</Text>
                {!isExpanded && route ? <Text style={{ color: '#2563eb', fontSize: 11, fontWeight: '700' }}>Tap to expand</Text> : null}
              </View>

              {/* Expanded section */}
              {isExpanded ? (
                <View style={{ marginTop: 10, marginLeft: 50, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 }}>
                  {route ? (
                    <TouchableOpacity
                      onPress={() => {
                        setExpandedId(null);
                        router.push(route);
                      }}
                      style={{
                        backgroundColor: '#2563eb',
                        borderRadius: 8,
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        alignSelf: 'flex-start',
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>View →</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>No further action needed.</Text>
                  )}
                </View>
              ) : null}
            </TouchableOpacity>
            </Swipeable>
          );
        }}
      />

      <TouchableOpacity onPress={() => router.replace('/home')} style={{ marginTop: 8, alignSelf: 'center' }}>
        <Text style={{ color: '#64748b', fontWeight: '700' }}>← Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}
