import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ListScreen from '../components/ui/list-screen';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import useAuthUser from '../hooks/use-auth-user';

// Firebase
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { REQUEST_STATUS, STATUS_LABELS } from '../constants/access';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import { getLocationLabel } from '../utils/location';

const BADGE_BY_STATUS = {
  [REQUEST_STATUS.OPEN]: { bg: '#dbeafe', color: '#1d4ed8', label: 'Open' },
  [REQUEST_STATUS.ACCEPTED]: { bg: '#ffedd5', color: '#c2410c', label: 'Accepted' },
  [REQUEST_STATUS.IN_PROGRESS]: { bg: '#ede9fe', color: '#5b21b6', label: 'In Progress' },
  [REQUEST_STATUS.PENDING_CONFIRMATION]: { bg: '#fef3c7', color: '#b45309', label: 'Pending Confirmation' },
  [REQUEST_STATUS.PAID]: { bg: '#dcfce7', color: '#166534', label: 'Paid' },
  [REQUEST_STATUS.CANCELLED]: { bg: '#f1f5f9', color: '#475569', label: 'Cancelled' },
};

export default function MyRequests() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const [myRequests, setMyRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [tab, setTab] = useState('active'); // 'active' | 'completed' | 'all'
  const [isRefreshing, setIsRefreshing] = useState(false);

  const ACTIVE_STATUSES = [REQUEST_STATUS.OPEN, REQUEST_STATUS.ACCEPTED, REQUEST_STATUS.IN_PROGRESS, REQUEST_STATUS.PENDING_CONFIRMATION];
  const COMPLETED_STATUSES = [REQUEST_STATUS.PAID];

  const visibleRequests = useMemo(() => {
    return myRequests.filter((item) => {
      if (!item.location || !item.price) return false;
      const status = item.status || REQUEST_STATUS.OPEN;
      if (tab === 'all') {
        return true;
      }
      if (tab === 'completed') {
        return COMPLETED_STATUSES.includes(status) || item.paid;
      }
      return ACTIVE_STATUSES.includes(status);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequests, tab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  useEffect(() => {
    if (!isAuthReady) {
      return undefined;
    }

    if (!currentEmail) {
      setMyRequests([]);
      setIsLoading(false);
      return undefined;
    }

    const q = query(collection(db, 'requests'), where('user', '==', currentEmail));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

      setMyRequests(data);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentEmail, isAuthReady]);

  const handleCancel = async (item) => {
    try {
      const status = item.status || REQUEST_STATUS.OPEN;

      if (status !== REQUEST_STATUS.OPEN || item.paid) {
        setNotice({
          tone: 'warning',
          title: 'Cancel blocked',
          message: 'Only open and unpaid requests can be cancelled.',
        });
        return;
      }

      if (confirmDeleteId !== item.id) {
        setConfirmDeleteId(item.id);
        setNotice({
          tone: 'warning',
          title: 'Confirm cancellation',
          message: `Tap again to cancel ${item.title}. It will remain in history.`,
        });
        return;
      }

      setPendingDeleteId(item.id);
      setNotice(null);
      await updateDoc(doc(db, 'requests', item.id), {
        status: REQUEST_STATUS.CANCELLED,
        cancelledAt: new Date().toISOString(),
      });
      setConfirmDeleteId(null);
      setNotice({
        tone: 'success',
        title: 'Request cancelled',
        message: `${item.title} was cancelled and saved in your history.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Cancel failed',
        message: error.message || 'Could not cancel this request.',
      });
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <ListScreen
      eyebrow="TRACKER"
      title="My Requests"
      subtitle="Review the requests you created and manage open items."
      accentColor="#0f766e"
      accentTextColor="#ccfbf1"
      toolbar={(
        <View>
          <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} style={{ marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', marginBottom: 16 }}>
            <AppButton
              label="Active"
              variant={tab === 'active' ? 'primary' : 'neutral'}
              onPress={() => setTab('active')}
              style={{ flex: 1, marginRight: 8 }}
            />
            <AppButton
              label="Completed"
              variant={tab === 'completed' ? 'primary' : 'neutral'}
              onPress={() => setTab('completed')}
              style={{ flex: 1 }}
            />
          </View>
          <AppButton label="All" variant={tab === 'all' ? 'primary' : 'neutral'} onPress={() => setTab('all')} style={{ marginTop: -8, marginBottom: 12 }} />
          <AppNotice
            tone={notice?.tone}
            title={notice?.title}
            message={notice?.message}
          />
        </View>
      )}
      isLoading={isLoading}
      loadingView={(
        <AppCard>
          <LoadingSkeleton height={18} width="38%" style={{ marginBottom: 12 }} />
          <LoadingSkeleton height={44} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={44} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={44} width="100%" />
        </AppCard>
      )}
      hasItems={visibleRequests.length > 0}
      emptyTitle={tab === 'active' ? 'No active requests' : tab === 'completed' ? 'No completed jobs yet' : 'No requests yet'}
      emptyDescription={tab === 'active' ? 'Post a job to get started!' : tab === 'completed' ? 'Completed and paid requests will appear here.' : 'Create your first request to get started.'}
    >
        <FlatList
          data={visibleRequests}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AppCard style={{ marginBottom: 15 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: AppColors.ink900, flex: 1 }}>
                  {item.title}
                </Text>
                <View style={{ backgroundColor: (BADGE_BY_STATUS[item.status]?.bg || '#e2e8f0'), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: (BADGE_BY_STATUS[item.status]?.color || '#334155'), fontWeight: '800', fontSize: 11 }}>{BADGE_BY_STATUS[item.status]?.label || STATUS_LABELS[item.status] || 'Open'}</Text>
                </View>
              </View>

              {item.description ? (
                <Text style={{ color: AppColors.ink500, marginTop: 3, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}

              <Text style={{ color: AppColors.ink700, marginTop: 4 }}>Location: {getLocationLabel(item.location) || item.locationText || 'N/A'}</Text>
              <Text style={{ color: AppColors.ink700, marginTop: 2 }}>Amount: GHS {item.price}</Text>

              {item.acceptedBy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#dbeafe', justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                    <Text style={{ color: '#1d4ed8', fontWeight: '800' }}>{String(item.acceptedBy).charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ color: AppColors.green600 }}>Provider: {item.acceptedBy}</Text>
                </View>
              ) : (
                <Text style={{ color: '#c2410c', marginTop: 2, fontWeight: '700' }}>Seeking Provider</Text>
              )}

              {item.acceptedBy ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="💬 Open Chat"
                    variant="neutral"
                    onPress={() => router.push({ pathname: '/chat', params: { jobId: item.id } })}
                  />
                </View>
              ) : null}

              {(!item.status || item.status === REQUEST_STATUS.OPEN) && !item.paid ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label={confirmDeleteId === item.id ? 'Tap Again To Cancel' : 'Cancel'}
                    variant="danger"
                    onPress={() => handleCancel(item)}
                    disabled={Boolean(pendingDeleteId)}
                    loading={pendingDeleteId === item.id}
                  />
                </View>
              ) : null}

              {item.status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="Review Work & Confirm"
                    variant="success"
                    onPress={() => router.push({ pathname: '/confirm-completion', params: { requestId: item.id } })}
                  />
                </View>
              ) : null}

              {item.status === REQUEST_STATUS.ACCEPTED && !item.escrowFunded && !item.paid ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label="Fund Escrow"
                    variant="success"
                    onPress={() => router.push({ pathname: '/pay', params: { id: item.id, amount: item.price, email: currentEmail } })}
                    style={{ backgroundColor: '#16a34a' }}
                  />
                </View>
              ) : null}

              {(item.status === REQUEST_STATUS.PAID || item.paid) ? (
                <View style={{ marginTop: AppSpace.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#d97706', fontWeight: '800' }}>⭐ Leave a rating</Text>
                  <AppButton
                    label="Rate"
                    variant="warning"
                    onPress={() => router.push({ pathname: '/rate', params: { requestId: item.id, providerEmail: item.acceptedBy || '' } })}
                    style={{ minWidth: 100 }}
                  />
                </View>
              ) : null}

            </AppCard>
          )}
        />
    </ListScreen>
  );
}