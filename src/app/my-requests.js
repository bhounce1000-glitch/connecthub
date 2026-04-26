import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ListScreen from '../components/ui/list-screen';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import useAuthUser from '../hooks/use-auth-user';

// Firebase
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { REQUEST_STATUS, STATUS_LABELS } from '../constants/access';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';

export default function MyRequests() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const [myRequests, setMyRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [tab, setTab] = useState('active'); // 'active' | 'history'

  const ACTIVE_STATUSES = [REQUEST_STATUS.OPEN, REQUEST_STATUS.ACCEPTED, REQUEST_STATUS.IN_PROGRESS];
  const HISTORY_STATUSES = [REQUEST_STATUS.COMPLETED, REQUEST_STATUS.PAID];

  const visibleRequests = useMemo(() => {
    return myRequests.filter((item) => {
      if (!item.location || !item.price) return false;
      const status = item.status || REQUEST_STATUS.OPEN;
      return tab === 'active'
        ? ACTIVE_STATUSES.includes(status)
        : HISTORY_STATUSES.includes(status) || item.paid;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequests, tab]);

  useEffect(() => {
    if (!isAuthReady) {
      return undefined;
    }

    if (!currentEmail) {
      setMyRequests([]);
      setIsLoading(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(collection(db, 'requests'), (snapshot) => {
      const data = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        .filter((item) => item.user === currentEmail);

      setMyRequests(data);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentEmail, isAuthReady]);

  const handleDelete = async (item) => {
    try {
      const status = item.status || REQUEST_STATUS.OPEN;

      if (status !== REQUEST_STATUS.OPEN || item.paid) {
        setNotice({
          tone: 'warning',
          title: 'Delete blocked',
          message: 'Only open and unpaid requests can be deleted.',
        });
        return;
      }

      if (confirmDeleteId !== item.id) {
        setConfirmDeleteId(item.id);
        setNotice({
          tone: 'warning',
          title: 'Confirm deletion',
          message: `Tap delete again to permanently remove ${item.title}.`,
        });
        return;
      }

      setPendingDeleteId(item.id);
      setNotice(null);
      await deleteDoc(doc(db, 'requests', item.id));
      setConfirmDeleteId(null);
      setNotice({
        tone: 'success',
        title: 'Request deleted',
        message: `${item.title} was removed successfully.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Delete failed',
        message: error.message || 'Could not delete this request.',
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
              label="History"
              variant={tab === 'history' ? 'primary' : 'neutral'}
              onPress={() => setTab('history')}
              style={{ flex: 1 }}
            />
          </View>
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
      emptyTitle={tab === 'active' ? 'No active requests' : 'No history yet'}
      emptyDescription={tab === 'active' ? 'Your open and in-progress requests will appear here.' : 'Completed and paid requests will appear here.'}
    >
        <FlatList
          data={visibleRequests}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AppCard style={{ marginBottom: 15 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: AppColors.ink900 }}>
                {item.title}
              </Text>

              <Text style={{ color: AppColors.ink700, marginTop: 4 }}>Location: {item.location}</Text>
              <Text style={{ color: AppColors.ink700, marginTop: 2 }}>Amount: GHS {item.price}</Text>
              <Text style={{ color: AppColors.ink500, fontWeight: '600', marginTop: 2 }}>
                Status: {STATUS_LABELS[item.status] || item.status || 'Open'}
              </Text>

              {item.acceptedBy ? (
                <Text style={{ color: AppColors.green600, marginTop: 2 }}>
                  Provider: {item.acceptedBy}
                </Text>
              ) : (
                <Text style={{ color: AppColors.ink500, marginTop: 2, fontStyle: 'italic' }}>No provider yet</Text>
              )}

              {(!item.status || item.status === REQUEST_STATUS.OPEN) && !item.paid ? (
                <View style={{ marginTop: AppSpace.sm }}>
                  <AppButton
                    label={confirmDeleteId === item.id ? 'Tap Again To Delete' : 'Delete'}
                    variant="danger"
                    onPress={() => handleDelete(item)}
                    disabled={Boolean(pendingDeleteId)}
                    loading={pendingDeleteId === item.id}
                  />
                </View>
              ) : null}

            </AppCard>
          )}
        />
    </ListScreen>
  );
}