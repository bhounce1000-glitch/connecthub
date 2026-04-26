import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

const STATUS_COLORS = {
  [REQUEST_STATUS.OPEN]: '#d97706',
  [REQUEST_STATUS.ACCEPTED]: '#1d4ed8',
  [REQUEST_STATUS.IN_PROGRESS]: '#7c3aed',
  [REQUEST_STATUS.COMPLETED]: '#0f766e',
  [REQUEST_STATUS.PAID]: '#166534',
  [REQUEST_STATUS.CANCELLED]: '#b91c1c',
};

function getEffectiveStatus(item) {
  if (item.status) return item.status;
  if (item.paid) return REQUEST_STATUS.PAID;
  if (item.acceptedBy) return REQUEST_STATUS.ACCEPTED;
  return REQUEST_STATUS.OPEN;
}

export default function Home() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const profileFetchQueue = useRef(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const currentEmail = user?.email || '';
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  const formatPaidAt = (value) => {
    if (!value) return 'Unavailable';
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return String(value);
    return parsedDate.toLocaleString();
  };

  useEffect(() => {
    if (!currentEmail) return undefined;
    const q = query(
      collection(db, 'notifications'),
      where('user', '==', currentEmail),
      where('read', '==', false),
    );
    return onSnapshot(q, (snap) => setUnreadCount(snap.size), () => setUnreadCount(0));
  }, [currentEmail]);

  useEffect(() => {
    return onSnapshot(collection(db, 'requests'), (snapshot) => {
      const data = snapshot.docs
        .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setRequests(data);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    const emails = new Set();
    requests.forEach((item) => {
      if (item.user) emails.add(item.user);
      if (item.acceptedBy) emails.add(item.acceptedBy);
    });
    if (currentEmail) emails.add(currentEmail);

    const toFetch = [...emails].filter(
      (e) => !userProfiles[e] && !profileFetchQueue.current.has(e)
    );
    if (toFetch.length === 0) return;

    toFetch.forEach((e) => profileFetchQueue.current.add(e));
    Promise.all(
      toFetch.map(async (e) => {
        try {
          const snap = await getDoc(doc(db, 'users', e));
          return [e, snap.exists() ? snap.data() : {}];
        } catch {
          return [e, {}];
        }
      })
    ).then((results) => {
      setUserProfiles((prev) => {
        const next = { ...prev };
        results.forEach(([e, data]) => { next[e] = data; });
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, currentEmail]);

  const handleLogout = async () => {
    await signOut(auth);
    router.replace('/auth');
  };

  const createNotification = async (recipientEmail, text) => {
    if (!recipientEmail || !text) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        user: recipientEmail,
        text,
        read: false,
        createdAt: new Date().toISOString(),
      });
    } catch (_error) {
      // Non-blocking — notification failure should not interrupt the main action
    }
  };

  const runRequestAction = async (item, actionKey, successTitle, successMessage, updater) => {
    setPendingAction(`${item.id}:${actionKey}`);
    setConfirmDeleteId(null);
    setNotice(null);
    try {
      await updater();
      setNotice({ tone: 'success', title: successTitle, message: successMessage });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Request update failed', message: error.message || 'Could not update this request right now.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleAccept = async (item) => {
    if (!currentEmail) {
      setNotice({ tone: 'warning', title: 'Missing account context', message: 'Sign in again before accepting a request.' });
      return;
    }
    await runRequestAction(
      item, 'accept', 'Request accepted', `You are now assigned to ${item.title}.`,
      async () => {
        await updateDoc(doc(db, 'requests', item.id), {
          acceptedBy: currentEmail,
          status: REQUEST_STATUS.ACCEPTED,
          acceptedAt: new Date().toISOString(),
        });
        await createNotification(item.user, `${currentEmail} accepted your request "${item.title}".`);
      }
    );
  };

  const handleStartWork = async (item) => {
    await runRequestAction(
      item, 'start', 'Work started', `${item.title} is now in progress.`,
      async () => {
        await updateDoc(doc(db, 'requests', item.id), {
          status: REQUEST_STATUS.IN_PROGRESS,
          startedAt: new Date().toISOString(),
        });
        await createNotification(item.user, `Work has started on your request "${item.title}".`);
      }
    );
  };

  const handleCompleteWork = async (item) => {
    await runRequestAction(
      item, 'complete', 'Work marked complete', `${item.title} is ready for payment.`,
      async () => {
        await updateDoc(doc(db, 'requests', item.id), {
          status: REQUEST_STATUS.COMPLETED,
          completedAt: new Date().toISOString(),
        });
        await createNotification(item.user, `Work on "${item.title}" is complete. You can now pay your provider.`);
      }
    );
  };

  const handleDelete = async (item) => {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      setNotice({ tone: 'warning', title: 'Confirm deletion', message: `Tap delete again to permanently remove ${item.title}.` });
      return;
    }
    await runRequestAction(
      item, 'delete', 'Request deleted', `${item.title} was removed successfully.`,
      () => deleteDoc(doc(db, 'requests', item.id))
    );
  };

  const handlePay = (item) => {
    router.push({ pathname: '/pay', params: { id: item.id, amount: item.price, email: currentEmail } });
  };

  const openRateScreen = (item) => {
    router.push({ pathname: '/rate', params: { requestId: item.id, providerEmail: item.acceptedBy || '' } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 18 }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: 18, padding: 18, marginBottom: 14 }}>
        <Text style={{ fontSize: 14, color: '#93c5fd', letterSpacing: 0.5, fontFamily: 'serif' }}>CONNECTHUB</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#f8fafc' }}>Dashboard</Text>
          <Avatar src={userProfiles[currentEmail]?.profilePicture} email={currentEmail} size={48} style={{ borderColor: '#334155' }} />
        </View>
        <Text style={{ color: '#cbd5e1', marginTop: 6 }}>{currentEmail || 'Guest'}</Text>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: AppSpace.sm }}>
        <AppButton label="+ New Request" variant="primary" onPress={() => router.push('/request')} style={{ flex: 1, marginRight: 8 }} />
        <AppButton label="Payments" variant="neutral" onPress={() => router.push('/payments')} style={{ flex: 1 }} />
      </View>

      <View style={{ flexDirection: 'row', marginBottom: AppSpace.sm }}>
        <AppButton label="My Requests" variant="neutral" onPress={() => router.push('/my-requests')} style={{ flex: 1, marginRight: 8 }} />
        <View style={{ flex: 1, marginRight: 8 }}>
          <AppButton label="Notifications" variant="neutral" onPress={() => router.push('/notifications')} />
          {unreadCount > 0 ? (
            <View style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#dc2626', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          ) : null}
        </View>
        <AppButton label="Profile" variant="neutral" onPress={() => router.push('/profile')} style={{ flex: 1 }} />
      </View>

      {isAdmin ? (
        <AppButton label="Admin Moderation" variant="warning" onPress={() => router.push('/admin')} style={{ marginBottom: AppSpace.sm }} />
      ) : null}

      <AppButton label="Logout" variant="danger" onPress={handleLogout} style={{ marginBottom: 15 }} />

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} />

      <Text style={{ fontSize: 20, marginBottom: 10, color: '#0f172a', fontWeight: '700' }}>Service Requests</Text>
      <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12, marginTop: -6 }}>
        Showing open jobs you can accept, plus your own requests and jobs you are working on.
      </Text>

      {isLoading ? (
        <View>
          {[1, 2, 3].map((n) => (
            <AppCard key={n} style={{ marginBottom: 14 }}>
              <LoadingSkeleton height={18} width="65%" style={{ marginBottom: 10 }} />
              <LoadingSkeleton height={14} width="45%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={14} width="35%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={14} width="40%" style={{ marginBottom: 12 }} />
              <LoadingSkeleton height={42} width="100%" />
            </AppCard>
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={requests.filter((item) => {
            if (!item.title || !item.location || !item.price) return false;
            const status = getEffectiveStatus(item);
            // Never show finished requests on the dashboard
            if (status === REQUEST_STATUS.PAID || status === REQUEST_STATUS.COMPLETED) return false;
            const isOwner = item.user === currentEmail;
            const isProvider = item.acceptedBy === currentEmail;
            const isOpen = status === REQUEST_STATUS.OPEN;
            // Show open jobs others posted (to accept), or active jobs the user owns/works on
            return isOwner || isProvider || (isOpen && !isOwner);
          })}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Text style={{ fontSize: 16, color: '#64748b', textAlign: 'center', marginBottom: 6 }}>No active requests right now.</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>Post a new request or check back later.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const status = getEffectiveStatus(item);
            const color = STATUS_COLORS[status] || '#d97706';
            const isOwner = item.user === currentEmail;
            const isProvider = item.acceptedBy === currentEmail;
            const activeAction = pendingAction?.startsWith(`${item.id}:`) ? pendingAction.split(':')[1] : null;
            const isConfirmingDelete = confirmDeleteId === item.id;

            return (
              <AppCard style={{ marginBottom: 14 }}>
                <Text style={{ fontWeight: '700', fontSize: 17, color: '#111827' }}>{item.title}</Text>
                <Text style={{ marginTop: 5, color: '#334155' }}>Location: {item.location}</Text>
                <Text style={{ marginTop: 5, color: '#334155' }}>Amount: GHS {item.price}</Text>
                <Text style={{ marginTop: 7, color, fontWeight: '700' }}>Status: {STATUS_LABELS[status] || status}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, gap: 8 }}>
                  <Avatar src={userProfiles[item.user]?.profilePicture} email={item.user} size={24} />
                  <Text style={{ color: '#4b5563', fontSize: 13 }}>Owner: {item.user || 'Unavailable'}</Text>
                </View>

                {item.acceptedBy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                    <Avatar src={userProfiles[item.acceptedBy]?.profilePicture} email={item.acceptedBy} size={24} />
                    <Text style={{ color: '#4b5563', fontSize: 13 }}>Provider: {item.acceptedBy}</Text>
                  </View>
                ) : null}

                {!item.acceptedBy && !isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label="Accept" variant="primary" onPress={() => handleAccept(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'accept'} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.ACCEPTED ? (
                  <AppButton label="Start Work" onPress={() => handleStartWork(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'start'} style={{ marginTop: AppSpace.sm, backgroundColor: AppColors.violet600 }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.IN_PROGRESS ? (
                  <AppButton label="Mark Completed" onPress={() => handleCompleteWork(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'complete'} style={{ marginTop: AppSpace.sm, backgroundColor: AppColors.teal700 }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.COMPLETED && !item.paid ? (
                  <AppButton label="Pay Provider" variant="success" onPress={() => handlePay(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label={isConfirmingDelete ? 'Tap Again To Delete' : 'Delete Request'} variant="danger" onPress={() => handleDelete(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'delete'} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.PAID && item.acceptedBy && !item.rating ? (
                  <AppButton label="Rate Provider" variant="warning" onPress={() => openRateScreen(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {(isOwner || isProvider) && item.acceptedBy ? (
                  <AppButton label="Open Chat" variant="neutral" onPress={() => router.push({ pathname: '/chat', params: { requestId: item.id } })} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {item.paid ? (
                  <View style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#ecfdf5' }}>
                    <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 6 }}>Payment Completed</Text>
                    <Text style={{ color: '#166534', marginBottom: 4 }}>Status: {item.paymentStatus || 'success'}</Text>
                    <Text style={{ color: '#166534', marginBottom: 4 }}>Reference: {item.paymentReference || 'Unavailable'}</Text>
                    <Text style={{ color: '#166534', marginBottom: 4 }}>Channel: {item.paymentChannel || 'Unavailable'}</Text>
                    <Text style={{ color: '#166534', marginBottom: 4 }}>Paid at: {formatPaidAt(item.paidAt)}</Text>
                    <Text style={{ color: '#166534', marginBottom: 4 }}>Gateway: {item.gatewayResponse || 'Unavailable'}</Text>
                    {item.rating ? (
                      <Text style={{ color: '#166534' }}>Review: {item.rating}/5{item.review ? ` - ${item.review}` : ''}</Text>
                    ) : null}
                  </View>
                ) : null}
              </AppCard>
            );
          }}
        />
      )}
    </View>
  );
}
