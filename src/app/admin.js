import { useRouter } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ListScreen from '../components/ui/list-screen';
import { REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiDelete, apiPost, assertApiSuccess } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

export default function Admin() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [requests, setRequests] = useState([]);
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const currentEmail = user?.email || '';
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);

  // Redirect unauthenticated users or non-admins
  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      router.replace('/auth');
      return;
    }
    if (!isAdmin) {
      router.replace('/home');
    }
  }, [isAuthReady, isAdmin, router, user]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return onSnapshot(collection(db, 'requests'), (snapshot) => {
      const rows = snapshot.docs
        .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
        .sort((a, b) => {
          const first = a.createdAt?.seconds || 0;
          const second = b.createdAt?.seconds || 0;
          return second - first;
        });

      setRequests(rows);
    });
  }, [isAdmin]);

  const setStatus = async (item, nextStatus) => {
    setPendingAction(`${item.id}:${nextStatus}`);
    setNotice(null);

    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/requests/${item.id}/moderate`, {
        status: nextStatus,
        note: 'Updated from admin screen',
      }, {
        requireAuth: true,
      });
      assertApiSuccess(response, data, 'Moderation request failed');
      setNotice({
        tone: 'success',
        title: 'Request updated',
        message: `${item.title || item.id} is now ${STATUS_LABELS[nextStatus] || nextStatus}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Moderation failed',
        message: formatApiMessage({ message: error.message }, 'Could not update this request status.'),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const deleteRequest = async (item) => {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      setNotice({
        tone: 'warning',
        title: 'Confirm deletion',
        message: `Tap delete again to permanently remove "${item.title || item.id}".`,
      });
      return;
    }

    setPendingAction(`${item.id}:delete`);
    setConfirmDeleteId(null);
    setNotice(null);

    try {
      const { response, data } = await apiDelete(`${API_BASE_URL}/admin/requests/${item.id}`, {
        requireAuth: true,
      });
      assertApiSuccess(response, data, 'Delete request failed');
      setNotice({
        tone: 'success',
        title: 'Request deleted',
        message: `${item.title || item.id} was removed successfully.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Delete failed',
        message: formatApiMessage({ message: error.message }, 'Could not delete this request.'),
      });
    } finally {
      setPendingAction(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Restricted</Text>
        <Text style={{ color: '#4b5563', textAlign: 'center' }}>
          This area is only available to admin accounts.
        </Text>
      </View>
    );
  }

  return (
    <ListScreen
      eyebrow="ADMIN DESK"
      title="Moderation"
      subtitle="Manage status and moderate request records."
      accentColor="#111827"
      accentTextColor="#cbd5e1"
      toolbar={(
        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />
      )}
      hasItems={requests.length > 0}
      emptyTitle="No requests found"
      emptyDescription="Requests will appear here once they are created."
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {requests.map((item) => (
          <AppCard key={item.id} style={{ marginBottom: 12 }}>
            <Text style={{ fontWeight: '700', marginBottom: 4 }}>{item.title || item.id}</Text>
            <Text>ID: {item.id}</Text>
            <Text>User: {item.user || 'Unavailable'}</Text>
            <Text>Provider: {item.acceptedBy || 'Unassigned'}</Text>
            <Text>Status: {STATUS_LABELS[item.status] || item.status || 'Open'}</Text>
            <Text>Paid: {item.paid ? 'Yes' : 'No'}</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: AppSpace.sm }}>
              <AppButton
                label="Reopen"
                variant="primary"
                onPress={() => setStatus(item, REQUEST_STATUS.OPEN)}
                disabled={Boolean(pendingAction)}
                loading={pendingAction === `${item.id}:${REQUEST_STATUS.OPEN}`}
                style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8 }}
              />

              <AppButton
                label="Complete"
                onPress={() => setStatus(item, REQUEST_STATUS.COMPLETED)}
                disabled={Boolean(pendingAction)}
                loading={pendingAction === `${item.id}:${REQUEST_STATUS.COMPLETED}`}
                style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: AppColors.teal700 }}
              />

              <AppButton
                label="Mark Paid"
                variant="success"
                onPress={() => setStatus(item, REQUEST_STATUS.PAID)}
                disabled={Boolean(pendingAction)}
                loading={pendingAction === `${item.id}:${REQUEST_STATUS.PAID}`}
                style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8 }}
              />

              <AppButton
                label="Cancel"
                variant="danger"
                onPress={() => setStatus(item, REQUEST_STATUS.CANCELLED)}
                disabled={Boolean(pendingAction)}
                loading={pendingAction === `${item.id}:${REQUEST_STATUS.CANCELLED}`}
                style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#b91c1c' }}
              />

              <AppButton
                label={confirmDeleteId === item.id ? 'Tap Again To Delete' : 'Delete'}
                variant="danger"
                onPress={() => deleteRequest(item)}
                disabled={Boolean(pendingAction)}
                loading={pendingAction === `${item.id}:delete`}
                style={{ marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#7f1d1d' }}
              />
            </View>
          </AppCard>
        ))}
      </ScrollView>
    </ListScreen>
  );
}
