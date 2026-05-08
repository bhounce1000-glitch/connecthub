import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { CATEGORY_ICONS, REQUEST_STATUS, STATUS_LABELS } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost, assertApiSuccess } from '../utils/api-client';
import { getLocationLabel } from '../utils/location';

import { collection, onSnapshot, query, where } from 'firebase/firestore';

const STATUS_STYLE = {
  [REQUEST_STATUS.OPEN]: { border: '#2563eb', badgeBg: '#dbeafe', badgeText: '#1d4ed8', label: 'Open' },
  [REQUEST_STATUS.ACCEPTED]: { border: '#ea580c', badgeBg: '#ffedd5', badgeText: '#c2410c', label: 'Accepted' },
  [REQUEST_STATUS.IN_PROGRESS]: { border: '#7c3aed', badgeBg: '#ede9fe', badgeText: '#5b21b6', label: 'In Progress' },
  [REQUEST_STATUS.PENDING_CONFIRMATION]: { border: '#d97706', badgeBg: '#fef3c7', badgeText: '#b45309', label: 'Pending Confirmation' },
  [REQUEST_STATUS.COMPLETED]: { border: '#16a34a', badgeBg: '#dcfce7', badgeText: '#166534', label: 'Completed' },
  [REQUEST_STATUS.PAID]: { border: '#16a34a', badgeBg: '#dcfce7', badgeText: '#166534', label: 'Paid' },
  [REQUEST_STATUS.CANCELLED]: { border: '#64748b', badgeBg: '#f1f5f9', badgeText: '#475569', label: 'Cancelled' },
};
const AVATAR_COLORS = ['#dbeafe', '#fef3c7', '#dcfce7', '#ede9fe', '#fee2e2', '#e0f2fe'];

function postedAgo(value) {
  const ms = value?.seconds ? value.seconds * 1000 : new Date(value || 0).getTime();
  if (!ms || Number.isNaN(ms)) return 'Posted recently';
  const diffDays = Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
  if (diffDays === 0) return 'Posted today';
  if (diffDays === 1) return 'Posted 1 day ago';
  return `Posted ${diffDays} days ago`;
}

function isOverduePending(item) {
  const status = item.status || REQUEST_STATUS.OPEN;
  if (status !== REQUEST_STATUS.PENDING_CONFIRMATION) return false;
  const completedMs = item?.completedAt?.seconds
    ? item.completedAt.seconds * 1000
    : new Date(item?.completedAt || 0).getTime();
  if (!Number.isFinite(completedMs) || completedMs <= 0) return false;
  return (Date.now() - completedMs) > (48 * 60 * 60 * 1000);
}

function EmptyState({ emoji, title, subtitle, actionLabel, onAction }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 56 }}>{emoji}</Text>
      <Text style={{ marginTop: 10, fontSize: 18, fontWeight: '800', color: AppColors.ink900, textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 6, color: '#64748b', textAlign: 'center' }}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          style={{ marginTop: 14, backgroundColor: '#2563eb', borderRadius: AppRadius.md, paddingHorizontal: 16, paddingVertical: 10 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function MyRequests() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';

  const [myRequests, setMyRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('active');
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (!isAuthReady) return undefined;
    if (!currentEmail) {
      setMyRequests([]);
      setIsLoading(false);
      return undefined;
    }

    const q = query(collection(db, 'requests'), where('user', '==', currentEmail));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMyRequests(rows);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentEmail, isAuthReady]);

  const visibleRequests = useMemo(() => {
    return myRequests.filter((item) => {
      const status = item.status || REQUEST_STATUS.OPEN;
      if (tab === 'completed') return status === REQUEST_STATUS.COMPLETED;
      if (tab === 'paid') return status === REQUEST_STATUS.PAID || item.paid;
      if (tab === 'active') return status !== REQUEST_STATUS.PAID && status !== REQUEST_STATUS.CANCELLED && !item.paid;
      return true;
    });
  }, [myRequests, tab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 450);
  };

  const handleCancel = async (item) => {
    try {
      const status = item.status || REQUEST_STATUS.OPEN;
      if (status !== REQUEST_STATUS.OPEN || item.paid) {
        setNotice({ tone: 'warning', title: 'Cancel blocked', message: 'Only open unpaid requests can be cancelled.' });
        return;
      }

      if (confirmDeleteId !== item.id) {
        setConfirmDeleteId(item.id);
        setNotice({ tone: 'warning', title: 'Confirm cancellation', message: `Tap again to cancel ${item.title}.` });
        return;
      }

      setPendingDeleteId(item.id);
      setNotice(null);
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/cancel`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not cancel this request');
      setConfirmDeleteId(null);
      setNotice({ tone: 'success', title: 'Request cancelled', message: `${item.title} was cancelled and kept in history.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Cancel failed', message: error.message || 'Could not cancel this request.' });
    } finally {
      setPendingDeleteId(null);
    }
  };

  const TabButton = ({ keyName, label }) => {
    const active = tab === keyName;
    return (
      <TouchableOpacity
        onPress={() => setTab(keyName)}
        style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: active ? '#2563eb' : 'transparent' }}
      >
        <Text style={{ color: active ? '#2563eb' : '#94a3b8', fontWeight: '800' }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        {[1, 2, 3].map((n) => (
          <AppCard key={n} style={{ marginBottom: 12 }}>
            <LoadingSkeleton height={20} width="50%" style={{ marginBottom: 10 }} />
            <LoadingSkeleton height={14} width="70%" style={{ marginBottom: 8 }} />
            <LoadingSkeleton height={40} width="100%" />
          </AppCard>
        ))}
      </View>
    );
  }

  const listEmpty = () => {
    if (tab === 'active') {
      return <EmptyState emoji="📋" title="No active requests" subtitle="Post a job to get started" actionLabel="Post a Job" onAction={() => router.push('/request-wizard')} />;
    }
    if (tab === 'completed') {
      return <EmptyState emoji="✅" title="No completed jobs yet" subtitle="Confirmed jobs waiting for payout will appear here" />;
    }
    if (tab === 'paid') {
      return <EmptyState emoji="💸" title="No paid jobs yet" subtitle="Paid jobs will appear here once wallet payout is done" />;
    }
    return <EmptyState emoji="📭" title="No requests yet" />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.md }}>
        <Text style={{ color: '#93c5fd', fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>CONNECTHUB</Text>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>My Requests</Text>
      </View>

      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderRadius: AppRadius.md, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
        <TabButton keyName="active" label="Active" />
        <TabButton keyName="completed" label="Completed" />
        <TabButton keyName="paid" label="Paid" />
        <TabButton keyName="all" label="All" />
      </View>

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

      <FlatList
        data={visibleRequests}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={listEmpty}
        renderItem={({ item }) => {
          const status = item.status || REQUEST_STATUS.OPEN;
          const style = STATUS_STYLE[status] || STATUS_STYLE[REQUEST_STATUS.OPEN];
          const categoryIcon = CATEGORY_ICONS[item.category] || '✨';
          const locationLabel = getLocationLabel(item.location) || item.locationText || 'N/A';
          const providerEmail = item.acceptedBy || '';
          const avatarBg = providerEmail ? AVATAR_COLORS[(providerEmail.charCodeAt(0) || 0) % AVATAR_COLORS.length] : '#dbeafe';

          return (
            <AppCard style={{ marginBottom: 12, borderLeftWidth: 4, borderLeftColor: style.border, ...AppShadow.card }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ flex: 1, fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>{item.title}</Text>
                <View style={{ backgroundColor: style.badgeBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 }}>
                  <Text style={{ color: style.badgeText, fontWeight: '800', fontSize: 11 }}>{style.label || STATUS_LABELS[status] || 'Open'}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <View style={{ backgroundColor: '#eef2ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#3730a3', fontSize: 12, fontWeight: '700' }}>{categoryIcon} {item.category || 'Other'}</Text>
                </View>
              </View>

              <Text style={{ marginTop: 8, color: '#475569', fontSize: 13 }}>📍 {locationLabel}</Text>
              <Text style={{ marginTop: 4, color: '#166534', fontWeight: '900', fontSize: 16 }}>GHS {Number(item.price || 0).toFixed(2)}</Text>
              <Text style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>{postedAgo(item.createdAt)}</Text>

              {!providerEmail ? (
                <Text style={{ marginTop: 8, color: '#c2410c', fontWeight: '800' }}>Seeking Provider...</Text>
              ) : (
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: avatarBg, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                    <Text style={{ color: '#1d4ed8', fontWeight: '800' }}>{String(providerEmail).charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ color: '#475569', fontSize: 13 }}>{providerEmail}</Text>
                </View>
              )}

              {providerEmail ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="💬 Open Chat"
                    variant="neutral"
                    onPress={() => router.push({ pathname: '/chat', params: { jobId: item.id } })}
                  />
                </View>
              ) : null}

              {status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  {isOverduePending(item) ? (
                    <View style={{ backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <Text style={{ color: '#be123c', fontSize: 12, fontWeight: '800' }}>Overdue - waiting 48h+ for customer confirmation</Text>
                    </View>
                  ) : null}
                  <AppButton
                    label="Confirm Work ✅"
                    onPress={() => router.push({ pathname: '/confirm-completion', params: { requestId: item.id } })}
                    style={{ backgroundColor: '#2563eb' }}
                  />
                </View>
              ) : null}

              {status === REQUEST_STATUS.ACCEPTED && !item.escrowFunded && !item.paid ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="Fund Escrow 💰"
                    onPress={() => router.push({ pathname: '/pay', params: { id: item.id, amount: item.price, email: currentEmail } })}
                    style={{ backgroundColor: '#16a34a' }}
                  />
                </View>
              ) : null}

              {(status === REQUEST_STATUS.PAID || item.paid) && !item.rating ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="⭐ Leave Review"
                    variant="warning"
                    onPress={() => router.push({ pathname: '/rate', params: { requestId: item.id, providerEmail } })}
                  />
                </View>
              ) : null}

              {status === REQUEST_STATUS.OPEN && !item.paid ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label={confirmDeleteId === item.id ? 'Tap Again To Cancel' : 'Cancel'}
                    variant="danger"
                    onPress={() => handleCancel(item)}
                    loading={pendingDeleteId === item.id}
                    disabled={Boolean(pendingDeleteId)}
                  />
                </View>
              ) : null}
            </AppCard>
          );
        }}
      />

      <AppButton label="← Back to Home" variant="neutral" onPress={() => router.replace('/home')} style={{ marginTop: 8 }} />
    </View>
  );
}
