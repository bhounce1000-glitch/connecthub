import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import JobStepper from '../components/ui/job-stepper';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { CATEGORY_ICONS, REQUEST_STATUS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost, assertApiSuccess } from '../utils/api-client';
import { registerPushToken } from '../utils/notifications';

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
  const [providers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
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
    if (!currentEmail) return;

    registerPushToken().catch(() => {
      // Non-blocking: app should remain usable even if push registration fails.
    });
  }, [currentEmail]);

  useEffect(() => {
    if (!currentEmail) return undefined;

    // Admins see all requests; regular users see open requests + requests they own or accepted
    const baseCollection = collection(db, 'requests');

    if (isAdmin) {
      return onSnapshot(baseCollection, (snapshot) => {
        const data = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setRequests(data);
        setIsLoading(false);
      });
    }

    // For regular users: listen to open requests + their own requests in parallel
    const openQuery = query(baseCollection, where('status', '==', REQUEST_STATUS.OPEN));
    const ownQuery = query(baseCollection, where('user', '==', currentEmail));
    const acceptedQuery = query(baseCollection, where('acceptedBy', '==', currentEmail));

    const mergeSnapshots = (...snapshots) => {
      const seen = new Map();
      snapshots.forEach((snap) => {
        snap.docs.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
      });
      return [...seen.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    };

    const snapMap = { open: null, own: null, accepted: null };
    const emit = () => {
      if (snapMap.open && snapMap.own && snapMap.accepted) {
        setRequests(mergeSnapshots(snapMap.open, snapMap.own, snapMap.accepted));
        setIsLoading(false);
      }
    };

    const unsubOpen = onSnapshot(openQuery, (s) => { snapMap.open = s; emit(); });
    const unsubOwn = onSnapshot(ownQuery, (s) => { snapMap.own = s; emit(); });
    const unsubAccepted = onSnapshot(acceptedQuery, (s) => { snapMap.accepted = s; emit(); });

    return () => { unsubOpen(); unsubOwn(); unsubAccepted(); };
  }, [currentEmail, isAdmin]);

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
        const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/accept`, {}, { requireAuth: true });
        assertApiSuccess(response, data, 'Could not accept this request');
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
      item, 'complete', 'Completion submitted', `${item.title} is now awaiting customer confirmation.`,
      async () => {
        const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/mark-complete`, {}, { requireAuth: true });
        assertApiSuccess(response, data, 'Could not mark this job complete');
      }
    );
  };

  const handleCancel = async (item) => {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      setNotice({ tone: 'warning', title: 'Confirm cancellation', message: `Tap again to cancel ${item.title}. This keeps the job in history.` });
      return;
    }
    await runRequestAction(
      item, 'cancel', 'Request cancelled', `${item.title} was cancelled and moved to history.`,
      async () => {
        await updateDoc(doc(db, 'requests', item.id), {
          status: REQUEST_STATUS.CANCELLED,
          cancelledAt: new Date().toISOString(),
        });
      }
    );
  };

  const handlePay = (item) => {
    router.push({ pathname: '/pay', params: { id: item.id, amount: item.price, email: currentEmail } });
  };

  const openRateScreen = (item) => {
    router.push({ pathname: '/rate', params: { requestId: item.id, providerEmail: item.acceptedBy || '' } });
  };

  const openRateCustomerScreen = (item) => {
    router.push({ pathname: '/rate', params: { requestId: item.id, mode: 'customer' } });
  };

  const openWallet = () => {
    router.push('/wallet');
  };

  const CATEGORIES = ['All', ...Object.keys(CATEGORY_ICONS)];

  const visibleRequests = useMemo(() => {
    return requests.filter((item) => {
      if (!item.title || !item.location || !item.price) return false;
      const status = getEffectiveStatus(item);
      if (status === REQUEST_STATUS.PAID || status === REQUEST_STATUS.COMPLETED || status === REQUEST_STATUS.CANCELLED) return false;
      const isOwner = item.user === currentEmail;
      const isProvider = item.acceptedBy === currentEmail;
      const isOpen = status === REQUEST_STATUS.OPEN;
      if (!isOwner && !isProvider && !(isOpen && !isOwner)) return false;
      // Search filter
      const q = searchText.trim().toLowerCase();
      if (q) {
        const match =
          (item.title || '').toLowerCase().includes(q) ||
          (item.location || '').toLowerCase().includes(q) ||
          (item.description || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      // Category filter
      if (activeCategory !== 'All' && item.category !== activeCategory) return false;
      return true;
    });
  }, [requests, currentEmail, searchText, activeCategory]);

  const renderListHeader = () => (
    <View>
      {/* Hero header */}
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.md }}>
        <Text style={{ fontSize: 13, color: '#93c5fd', letterSpacing: 1, fontWeight: '700' }}>CONNECTHUB</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: '800', color: '#f8fafc' }}>Dashboard</Text>
            <Text style={{ color: '#94a3b8', marginTop: 2, fontSize: 13 }}>{currentEmail || 'Guest'}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={() => router.push('/notifications')} style={{ position: 'relative' }}>
                <Text style={{ fontSize: 22 }}>🔔</Text>
                <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#dc2626', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              </TouchableOpacity>
            )}
            <Avatar src={userProfiles[currentEmail]?.profilePicture} email={currentEmail} size={44} />
          </View>
        </View>
      </View>

      {/* Search bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 10, marginBottom: AppSpace.md }}>
        <Text style={{ marginRight: 8, fontSize: 16 }}>🔍</Text>
        <TextInput
          placeholder="Search requests by title, location..."
          placeholderTextColor="#94a3b8"
          value={searchText}
          onChangeText={setSearchText}
          style={{ flex: 1, fontSize: 14, color: AppColors.ink900 }}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Text style={{ color: '#94a3b8', fontSize: 16, paddingLeft: 8 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quick actions */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
        <TouchableOpacity onPress={() => router.push('/request-wizard')} style={{ flex: 1, backgroundColor: '#4f46e5', borderRadius: AppRadius.md, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>＋ Post a Job</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/my-requests')} style={{ flex: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '700', fontSize: 13 }}>My Jobs</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openWallet} activeOpacity={0.8} style={{ flex: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '700', fontSize: 13 }}>💰 Wallet</Text>
        </TouchableOpacity>
      </View>

      {/* More navigation */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
        <TouchableOpacity onPress={() => router.push('/providers')} style={{ flex: 1, backgroundColor: '#ede9fe', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ color: '#4f46e5', fontWeight: '700', fontSize: 12 }}>🔎 Browse Providers</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/provider-setup')} style={{ flex: 1, backgroundColor: '#ecfdf5', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ color: '#059669', fontWeight: '700', fontSize: 12 }}>🛠 Offer Services</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/notifications')} style={{ flex: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ color: AppColors.ink700, fontWeight: '700', fontSize: 12 }}>🔔 Alerts</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
        <TouchableOpacity onPress={() => router.push('/profile')} style={{ flex: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ color: AppColors.ink700, fontWeight: '700', fontSize: 12 }}>👤 Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/payments')} style={{ flex: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ color: AppColors.ink700, fontWeight: '700', fontSize: 12 }}>💳 Payments</Text>
        </TouchableOpacity>
        {isAdmin ? (
          <TouchableOpacity onPress={() => router.push('/admin')} style={{ flex: 1, backgroundColor: '#fef3c7', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#92400e', fontWeight: '700', fontSize: 12 }}>⚙ Admin</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleLogout} style={{ flex: 1, backgroundColor: '#fff0f0', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#be123c', fontWeight: '700', fontSize: 12 }}>⬠ Logout</Text>
          </TouchableOpacity>
        )}
      </View>

      {isAdmin && (
        <TouchableOpacity onPress={handleLogout} style={{ backgroundColor: '#fff0f0', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center', marginBottom: AppSpace.md }}>
          <Text style={{ color: '#be123c', fontWeight: '700' }}>Logout</Text>
        </TouchableOpacity>
      )}

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} />

      {/* Featured Providers */}
      {providers.length > 0 && (
        <View style={{ marginBottom: AppSpace.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>⭐ Featured Providers</Text>
            <TouchableOpacity onPress={() => router.push('/providers')}>
              <Text style={{ color: '#4f46e5', fontWeight: '600', fontSize: 13 }}>See all →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {providers.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => router.push({ pathname: '/provider-detail', params: { email: p.email } })}
                style={{ width: 170, marginRight: 12 }}
              >
                <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' }}>
                  <Avatar src={p.profilePicture} email={p.email} size={48} />
                  <Text style={{ fontWeight: '700', fontSize: 14, color: AppColors.ink900, marginTop: 8 }} numberOfLines={1}>
                    {p.name || p.email}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#4f46e5', fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                    {p.category || 'Provider'}
                  </Text>
                  {p.avgRating ? (
                    <Text style={{ fontSize: 12, color: AppColors.ink500, marginTop: 4 }}>⭐ {Number(p.avgRating).toFixed(1)}</Text>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>New provider</Text>
                  )}
                  {p.startingPrice ? (
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#059669', marginTop: 4 }}>From GHS {p.startingPrice}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Category filter */}
      <View style={{ marginBottom: AppSpace.md }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 10 }}>Live Requests</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {CATEGORIES.map((cat) => {
            const active = cat === activeCategory;
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => setActiveCategory(cat)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: AppRadius.md,
                  backgroundColor: active ? '#4f46e5' : '#fff',
                  borderWidth: 1,
                  borderColor: active ? '#4f46e5' : '#e2e8f0',
                  marginRight: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {cat !== 'All' && <Text style={{ fontSize: 12 }}>{CATEGORY_ICONS[cat] || '✨'}</Text>}
                <Text style={{ fontWeight: '600', fontSize: 13, color: active ? '#fff' : AppColors.ink700 }}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
      {isLoading ? (
        <View>
          <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.md }}>
            <LoadingSkeleton height={14} width="30%" style={{ marginBottom: 8 }} />
            <LoadingSkeleton height={26} width="55%" />
          </View>
          {[1, 2, 3].map((n) => (
            <AppCard key={n} style={{ marginBottom: 14 }}>
              <LoadingSkeleton height={18} width="65%" style={{ marginBottom: 10 }} />
              <LoadingSkeleton height={14} width="45%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={14} width="35%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={42} width="100%" />
            </AppCard>
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={visibleRequests}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
              <Text style={{ fontSize: 16, color: AppColors.ink500, fontWeight: '700', textAlign: 'center' }}>No active requests right now</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>Post a new job or check back soon.</Text>
              <TouchableOpacity
                onPress={() => router.push('/request-wizard')}
                style={{ marginTop: 16, backgroundColor: '#4f46e5', borderRadius: AppRadius.md, paddingVertical: 12, paddingHorizontal: 24 }}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>＋ Post a Job</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const status = getEffectiveStatus(item);
            const isOwner = item.user === currentEmail;
            const isProvider = item.acceptedBy === currentEmail;
            const activeAction = pendingAction?.startsWith(`${item.id}:`) ? pendingAction.split(':')[1] : null;
            const isConfirmingDelete = confirmDeleteId === item.id;

            return (
              <AppCard style={{ marginBottom: 14 }}>
                {/* Header row with category badge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: '#111827', flex: 1 }}>{item.title}</Text>
                  {item.category && (
                    <View style={{ backgroundColor: '#ede9fe', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#4f46e5' }}>
                        {CATEGORY_ICONS[item.category] || '✨'} {item.category}
                      </Text>
                    </View>
                  )}
                </View>

                {item.description ? (
                  <Text style={{ marginTop: 2, color: '#475569', fontSize: 13, lineHeight: 18, marginBottom: 4 }} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}

                <Text style={{ color: '#334155', fontSize: 13 }}>📍 {item.location}</Text>
                <Text style={{ color: '#334155', fontSize: 13, marginTop: 2 }}>💰 GHS {item.price}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
                  <Avatar src={userProfiles[item.user]?.profilePicture} email={item.user} size={20} />
                  <Text style={{ color: '#6b7280', fontSize: 12 }}>{item.user || 'Unavailable'}</Text>
                  {item.acceptedBy && (
                    <>
                      <Text style={{ color: '#d1d5db', fontSize: 12 }}>→</Text>
                      <Avatar src={userProfiles[item.acceptedBy]?.profilePicture} email={item.acceptedBy} size={20} />
                      <Text style={{ color: '#6b7280', fontSize: 12 }}>{item.acceptedBy}</Text>
                    </>
                  )}
                </View>

                {/* Visual status stepper */}
                <JobStepper status={status} />

                {/* Action buttons */}
                {!item.acceptedBy && !isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label="Accept Job" variant="primary" onPress={() => handleAccept(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'accept'} loadingLabel="Accepting..." style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.ACCEPTED ? (
                  <AppButton label="Start Work" onPress={() => handleStartWork(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'start'} loadingLabel="Updating..." style={{ marginTop: AppSpace.sm, backgroundColor: AppColors.violet600 }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.IN_PROGRESS ? (
                  <AppButton label="Mark Completed" onPress={() => handleCompleteWork(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'complete'} loadingLabel="Completing..." style={{ marginTop: AppSpace.sm, backgroundColor: AppColors.teal700 }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                  <View style={{ marginTop: AppSpace.sm, backgroundColor: '#fef9c3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#facc15' }}>
                    <Text style={{ color: '#a16207', fontWeight: '800', fontSize: 12 }}>Awaiting Customer Confirmation</Text>
                    <Text style={{ color: '#a16207', fontSize: 12, marginTop: 2 }}>Payment remains locked until customer confirms.</Text>
                  </View>
                ) : null}

                {isOwner && status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                  <AppButton
                    label="Review Work & Confirm"
                    variant="success"
                    onPress={() => router.push({ pathname: '/confirm-completion', params: { requestId: item.id } })}
                    style={{ marginTop: AppSpace.sm }}
                  />
                ) : null}

                {isOwner && status === REQUEST_STATUS.COMPLETED && !item.paid ? (
                  <AppButton label="Pay Provider" variant="success" onPress={() => handlePay(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label={isConfirmingDelete ? 'Tap Again To Cancel Request' : 'Cancel Request'} variant="danger" onPress={() => handleCancel(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'cancel'} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.PAID && item.acceptedBy && !item.rating ? (
                  <AppButton label="⭐ Rate Provider" variant="warning" onPress={() => openRateScreen(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.PAID && !item.customerRating ? (
                  <AppButton label="⭐ Rate Customer" variant="warning" onPress={() => openRateCustomerScreen(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {(isOwner || isProvider) && item.acceptedBy ? (
                  <AppButton label="💬 Open Chat" variant="neutral" onPress={() => router.push({ pathname: '/chat', params: { requestId: item.id } })} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {item.paid && item.commission != null ? (
                  <View style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#ecfdf5' }}>
                    <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 4 }}>✅ Payment Completed</Text>
                    <Text style={{ color: '#166534', fontSize: 12 }}>Amount: GHS {item.price} | Platform fee: GHS {Number(item.commission).toFixed(2)} | Provider net: GHS {Number(item.providerNet).toFixed(2)}</Text>
                    <Text style={{ color: '#166534', fontSize: 12 }}>Ref: {item.paymentReference || 'Unavailable'} · {formatPaidAt(item.paidAt)}</Text>
                    {item.rating ? (
                      <Text style={{ color: '#166534', fontSize: 12 }}>Review: {item.rating}/5{item.review ? ` — "${item.review}"` : ''}</Text>
                    ) : null}
                  </View>
                ) : item.paid ? (
                  <View style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#ecfdf5' }}>
                    <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 4 }}>✅ Payment Completed</Text>
                    <Text style={{ color: '#166534', fontSize: 12 }}>Ref: {item.paymentReference || 'Unavailable'} · {formatPaidAt(item.paidAt)}</Text>
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
