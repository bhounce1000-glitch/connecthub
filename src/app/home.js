import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import HeroBanner from '../components/HeroBanner';
import PromotionalTicker from '../components/PromotionalTicker';
import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import JobStepper from '../components/ui/job-stepper';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { CATEGORY_ICONS, REQUEST_STATUS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost, assertApiSuccess } from '../utils/api-client';
import { distanceKm, getLocationCity, getLocationCoords, getLocationLabel } from '../utils/location';
import { getProviderBadge } from '../utils/provider-badges';

const BLOCKED_PROVIDER_EMAIL_PARTS = ['test', 'gmx.dev', 'mailinator', 'example.com', 'local'];

function isPublicProviderEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return !BLOCKED_PROVIDER_EMAIL_PARTS.some((part) => normalized.includes(part));
}

function isRealRequestRecord(item) {
  const userEmail = String(item?.user || '').trim().toLowerCase();
  const providerEmail = String(item?.acceptedBy || '').trim().toLowerCase();
  const userLooksReal = !userEmail || isPublicProviderEmail(userEmail);
  const providerLooksReal = !providerEmail || isPublicProviderEmail(providerEmail);
  return userLooksReal && providerLooksReal;
}

function getEffectiveStatus(item) {
  if (item.paid) return REQUEST_STATUS.PAID;
  if (item.status) return item.status;
  if (item.acceptedBy) return REQUEST_STATUS.ACCEPTED;
  return REQUEST_STATUS.OPEN;
}

function isOverduePending(item) {
  const status = getEffectiveStatus(item);
  if (status !== REQUEST_STATUS.PENDING_CONFIRMATION) return false;
  const completedMs = item?.completedAt?.seconds
    ? item.completedAt.seconds * 1000
    : new Date(item?.completedAt || 0).getTime();
  if (!Number.isFinite(completedMs) || completedMs <= 0) return false;
  return (Date.now() - completedMs) > (48 * 60 * 60 * 1000);
}

function isWithinRatingWindow(item) {
  const paidMs = item?.paidAt?.seconds
    ? item.paidAt.seconds * 1000
    : new Date(item?.paidAt || 0).getTime();
  if (!Number.isFinite(paidMs) || paidMs <= 0) return true;
  return (Date.now() - paidMs) <= (72 * 60 * 60 * 1000);
}

const STATUS_META = {
  [REQUEST_STATUS.OPEN]: { border: '#2563eb', pillBg: '#dbeafe', pillText: '#1d4ed8', label: 'Open' },
  [REQUEST_STATUS.ACCEPTED]: { border: '#f97316', pillBg: '#ffedd5', pillText: '#c2410c', label: 'Accepted' },
  [REQUEST_STATUS.IN_PROGRESS]: { border: '#7c3aed', pillBg: '#ede9fe', pillText: '#5b21b6', label: 'In Progress' },
  [REQUEST_STATUS.PENDING_CONFIRMATION]: { border: '#d97706', pillBg: '#fef3c7', pillText: '#b45309', label: 'Pending Confirmation' },
  [REQUEST_STATUS.COMPLETED]: { border: '#16a34a', pillBg: '#dcfce7', pillText: '#15803d', label: 'Completed' },
  [REQUEST_STATUS.PAID]: { border: '#166534', pillBg: '#dcfce7', pillText: '#166534', label: 'Paid' },
};

const SERVICE_CATEGORIES = [
  { icon: '🧹', label: 'Cleaning', value: 'Cleaning' },
  { icon: '🔧', label: 'Plumbing', value: 'Plumbing' },
  { icon: '⚡', label: 'Electrical', value: 'Electrical' },
  { icon: '🚗', label: 'Driving', value: 'Driving' },
  { icon: '🍳', label: 'Cooking', value: 'Cooking' },
  { icon: '💇', label: 'Beauty', value: 'Beauty' },
  { icon: '🏗️', label: 'Construction', value: 'Construction' },
  { icon: '📦', label: 'Moving', value: 'Moving' },
  { icon: '💻', label: 'Tech Support', value: 'Tech' },
  { icon: '🌿', label: 'Gardening', value: 'Gardening' },
  { icon: '🔒', label: 'Security', value: 'Security' },
  { icon: '📚', label: 'Tutoring', value: 'Tutoring' },
];

const AVATAR_BG_COLORS = ['#dbeafe', '#fef3c7', '#dcfce7', '#ede9fe', '#fee2e2', '#e0f2fe', '#fce7f3'];
function getAvatarColor(email) {
  if (!email) return AVATAR_BG_COLORS[0];
  let hash = 0;
  for (let i = 0; i < email.length; i++) { hash = email.charCodeAt(i) + ((hash << 5) - hash); }
  return AVATAR_BG_COLORS[Math.abs(hash) % AVATAR_BG_COLORS.length];
}

const PROMOTION_MESSAGES = [
  { text: 'Free provider spotlight for verified workers this week', route: '/subscription' },
  { text: 'Post a service request and match with nearby trusted providers', route: '/request-wizard' },
  { text: 'Escrow-backed jobs help protect customers and workers', route: '/help' },
  { text: 'Upgrade your provider profile for better job visibility', route: '/provider-setup' },
  { text: 'Explore verified local services across Ghana', route: '/providers' },
];

const SERVICE_MARKETPLACE_SECTIONS = [
  { title: 'Featured Providers', subtitle: 'Verified workers with stronger profiles', route: '/providers', accent: '#4f46e5' },
  { title: 'Local Services', subtitle: 'Cleaning, repairs, driving, catering and more', route: '/providers', accent: '#0f766e' },
  { title: 'Top Job Requests', subtitle: 'Open paid jobs providers can accept now', route: '/request-wizard', accent: '#d97706' },
  { title: 'Provider Boost', subtitle: 'Get more visibility with a serious profile', route: '/subscription', accent: '#be123c' },
];

const TRUST_SIGNALS = [
  { label: 'Verified IDs', value: 'KYC' },
  { label: 'Safe Payments', value: 'Escrow' },
  { label: 'Live Routing', value: 'GPS' },
  { label: 'Rated Providers', value: 'Reviews' },
];

function formatRelativeTime(value) {
  let postedMs = 0;
  if (value?.seconds) {
    postedMs = value.seconds * 1000;
  } else {
    const parsed = new Date(value || 0).getTime();
    postedMs = Number.isFinite(parsed) ? parsed : 0;
  }
  if (!postedMs) return 'Just now';

  const diffMins = Math.max(1, Math.floor((Date.now() - postedMs) / 60000));
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

export default function Home() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [requests, setRequests] = useState([]);
  const [providers, setProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedCity, setSelectedCity] = useState('All Cities');
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const profileFetchQueue = useRef(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const fabScale = useRef(new Animated.Value(1)).current;
  const currentEmail = String(user?.email || '').trim().toLowerCase();
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);
  const isProvider = String(userProfiles[currentEmail]?.role || '').toLowerCase() === 'provider';
  const currentPlan = String(userProfiles[currentEmail]?.subscriptionPlan || 'free').toLowerCase();
  const isFreePlan = currentPlan === 'free' || currentPlan === 'basic';
  const FREE_ACCEPT_LIMIT = 5;
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [heroWallet, setHeroWallet] = useState(0);
  const [heroRating, setHeroRating] = useState(null);
  const [recentProviders, setRecentProviders] = useState([]);

  const monthlyAcceptsUsed = useMemo(() => {
    if (!currentEmail || !isProvider) return 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return requests.filter((r) => {
      if (String(r.acceptedBy || '').toLowerCase() !== currentEmail) return false;
      const ts = r.acceptedAt ? new Date(r.acceptedAt).getTime() : (r.createdAt?.seconds ? r.createdAt.seconds * 1000 : 0);
      return ts >= monthStart;
    }).length;
  }, [requests, currentEmail, isProvider]);

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(fabScale, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(fabScale, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [fabScale]);

  const formatPaidAt = (value) => {
    if (!value) return 'Unavailable';
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return String(value);
    return parsedDate.toLocaleString();
  };

  useEffect(() => {
    if (!currentEmail) return undefined;
    const qByUserId = query(
      collection(db, 'notifications'),
      where('userId', '==', currentEmail),
      where('read', '==', false),
    );
    const qByRecipient = query(
      collection(db, 'notifications'),
      where('recipientId', '==', currentEmail),
      where('read', '==', false),
    );
    const qByLegacyUser = query(
      collection(db, 'notifications'),
      where('user', '==', currentEmail),
      where('read', '==', false),
    );

    let userIdCount = 0;
    let recipientCount = 0;
    let legacyCount = 0;
    const flush = () => setUnreadCount(Math.max(userIdCount, recipientCount, legacyCount));

    const unsubUserId = onSnapshot(qByUserId, (snap) => {
      userIdCount = snap.size;
      flush();
    }, () => setUnreadCount(0));

    const unsubRecipient = onSnapshot(qByRecipient, (snap) => {
      recipientCount = snap.size;
      flush();
    }, () => setUnreadCount(0));
    const unsubLegacy = onSnapshot(qByLegacyUser, (snap) => {
      legacyCount = snap.size;
      flush();
    }, () => setUnreadCount(0));

    return () => {
      unsubUserId();
      unsubRecipient();
      unsubLegacy();
    };
  }, [currentEmail]);

  useEffect(() => {
    if (!currentEmail) return undefined;

    const unsub = onSnapshot(doc(db, 'users', currentEmail), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      setHeroWallet(parseFloat(data.walletBalance || 0));
      setHeroRating(data.avgRating || null);
      setUserProfiles((prev) => ({
        ...prev,
        [currentEmail]: {
          ...(prev[currentEmail] || {}),
          ...data,
        },
      }));
    });

    return unsub;
  }, [currentEmail]);

  useEffect(() => {
    if (!currentEmail) return undefined;

    const qCustomer = query(collection(db, 'requests'), where('userId', '==', currentEmail), limit(50));
    const qCustomerLegacy = query(collection(db, 'requests'), where('user', '==', currentEmail), limit(50));
    const qProvider = query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail), limit(50));

    let customerJobs = [];
    let legacyCustomerJobs = [];
    let providerJobs = [];

    const recompute = () => {
      const active = [...customerJobs, ...legacyCustomerJobs, ...providerJobs]
        .filter((job) => !['PAID', 'CANCELLED'].includes(String(job.status || '').toUpperCase()));
      setActiveJobCount(new Set(active.map((job) => job.id)).size);
    };

    const unsubCustomer = onSnapshot(qCustomer, (snap) => {
      customerJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    const unsubCustomerLegacy = onSnapshot(qCustomerLegacy, (snap) => {
      legacyCustomerJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    const unsubProvider = onSnapshot(qProvider, (snap) => {
      providerJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    return () => {
      unsubCustomer();
      unsubCustomerLegacy();
      unsubProvider();
    };
  }, [currentEmail]);

  useEffect(() => {
    const providersQuery = query(collection(db, 'providers'), where('isAvailable', '==', true), limit(20));
    return onSnapshot(providersQuery, (snapshot) => {
      const rows = snapshot.docs
        .map((providerDoc) => ({ id: providerDoc.id, ...providerDoc.data() }))
        .filter((row) => isPublicProviderEmail(row.email || row.id))
        .slice(0, 8);
      setProviders(rows);
    }, () => setProviders([]));
  }, []);

  useEffect(() => {
    const recentQuery = query(
      collection(db, 'users'),
      where('role', '==', 'provider'),
      limit(30),
    );
    return onSnapshot(recentQuery, (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, email: d.id, ...d.data() }))
        .filter((row) => isPublicProviderEmail(row.email || row.id))
        .sort((a, b) => {
          const aTs = a.createdAt?.seconds || 0;
          const bTs = b.createdAt?.seconds || 0;
          return bTs - aTs;
        })
        .slice(0, 8);
      setRecentProviders(rows);
    }, () => setRecentProviders([]));
  }, []);

  useEffect(() => {
    if (!currentEmail) return undefined;

    // Admins see all requests; regular users see open requests + requests they own or accepted
    const baseCollection = collection(db, 'requests');

    if (isAdmin) {
      return onSnapshot(baseCollection, (snapshot) => {
        const data = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
          .filter((row) => isRealRequestRecord(row))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setRequests(data);
        setIsLoading(false);
      });
    }

    // For regular users: listen to open requests + their own requests in parallel
    const openQuery = query(baseCollection, where('status', '==', REQUEST_STATUS.OPEN), limit(20));
    const ownQuery = query(baseCollection, where('user', '==', currentEmail), limit(20));
    const acceptedQuery = query(baseCollection, where('acceptedBy', '==', currentEmail), limit(20));

    const mergeSnapshots = (...snapshots) => {
      const seen = new Map();
      snapshots.forEach((snap) => {
        snap.docs.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
      });
      return [...seen.values()]
        .filter((row) => isRealRequestRecord(row))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
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

    setPendingAction(`${item.id}:accept`);
    setConfirmDeleteId(null);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/accept`, {}, { requireAuth: true });
      if (!response.ok || !data?.status) {
        if (data?.code === 'monthly_limit_reached') {
          Alert.alert(
            'Monthly Limit Reached',
            'You have used all 5 of your free job accepts this month. Upgrade to Pro (GHS 49/mo) for unlimited accepts.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Upgrade Now', onPress: () => router.push('/subscription') },
            ]
          );
          return;
        }
        throw new Error(data?.message || 'Could not accept this request');
      }

      setNotice({ tone: 'success', title: 'Request accepted', message: `You are now assigned to ${item.title}.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Request update failed', message: error?.message || 'Could not update this request right now.' });
    } finally {
      setPendingAction(null);
    }
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
        const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/cancel`, {}, { requireAuth: true });
        assertApiSuccess(response, data, 'Could not cancel this request');
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

  const remindCustomerToFund = async (item) => {
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/remind-customer`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not send reminder');
      setNotice({ tone: 'success', title: 'Reminder sent', message: 'Customer has been reminded to fund escrow.' });
      Alert.alert('Reminder sent to customer');
    } catch {
      setNotice({ tone: 'error', title: 'Reminder failed', message: 'Could not send reminder right now.' });
    }
  };

  const openStatusFilterPicker = () => {
    Alert.alert('Filter Requests', 'Choose a status to display', [
      { text: 'All', onPress: () => setStatusFilter('all') },
      { text: 'Open', onPress: () => setStatusFilter(REQUEST_STATUS.OPEN) },
      { text: 'Accepted', onPress: () => setStatusFilter(REQUEST_STATUS.ACCEPTED) },
      { text: 'In Progress', onPress: () => setStatusFilter(REQUEST_STATUS.IN_PROGRESS) },
      { text: 'Overdue Pending', onPress: () => setStatusFilter('overdue_pending') },
      { text: 'Completed Jobs', onPress: () => setStatusFilter('completed') },
      { text: 'Paid Jobs', onPress: () => setStatusFilter('paid') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const resolveMyLocation = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setNotice({ tone: 'warning', title: 'Location permission needed', message: 'Enable location permission to use Near Me filtering.' });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = Number(position?.coords?.latitude);
      const longitude = Number(position?.coords?.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        setCurrentCoords({ latitude, longitude });
      }
    } catch {
      setNotice({ tone: 'warning', title: 'Location unavailable', message: 'Could not determine your location right now.' });
    } finally {
      setIsLocating(false);
    }
  };

  const CATEGORIES = ['All', ...Object.keys(CATEGORY_ICONS)];
  const CITY_OPTIONS = useMemo(() => {
    const unique = new Set();
    requests.forEach((item) => {
      const city = getLocationCity(item.location);
      if (city) unique.add(city);
    });
    return ['All Cities', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [requests]);

  const visibleRequests = useMemo(() => {
    return requests.filter((item) => {
      if (!item.title || !item.location || !item.price) return false;
      const status = getEffectiveStatus(item);
      const isOwner = item.user === currentEmail;
      const isProvider = item.acceptedBy === currentEmail;
      const isOpen = status === REQUEST_STATUS.OPEN;
      const isTerminal = status === REQUEST_STATUS.PAID || status === REQUEST_STATUS.COMPLETED || status === REQUEST_STATUS.CANCELLED;
      if (!isOwner && !isProvider && !(isOpen && !isOwner)) return false;
      // Search filter
      const locationLabel = getLocationLabel(item.location) || item.locationText || '';
      const q = searchText.trim().toLowerCase();
      if (q) {
        const match =
          (item.title || '').toLowerCase().includes(q) ||
          locationLabel.toLowerCase().includes(q) ||
          (item.description || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      // Category filter
      if (activeCategory !== 'All' && item.category !== activeCategory) return false;

      if (statusFilter !== 'all') {
        if (statusFilter === 'completed') {
          if (status !== REQUEST_STATUS.COMPLETED) return false;
        } else if (statusFilter === 'paid') {
          if (status !== REQUEST_STATUS.PAID && !item.paid) return false;
        } else if (statusFilter === 'overdue_pending') {
          if (!isOverduePending(item)) return false;
        } else if (status !== statusFilter) {
          return false;
        }
      } else if (isTerminal) {
        return false;
      }

      // Providers can narrow by city and near-me radius for faster job discovery.
      if (isProvider) {
        const city = getLocationCity(item.location);
        if (selectedCity !== 'All Cities' && city !== selectedCity) return false;

        if (nearMeOnly) {
          const targetCoords = getLocationCoords(item.location);
          const km = distanceKm(currentCoords, targetCoords);
          if (km == null || km > 25) return false;
        }
      }

      return true;
    });
  }, [requests, currentEmail, searchText, activeCategory, statusFilter, selectedCity, nearMeOnly, currentCoords]);

  const getGhanaHour = useCallback(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Africa/Accra',
      }).formatToParts(new Date());
      const hourValue = parts.find((part) => part.type === 'hour')?.value;
      const parsedHour = Number.parseInt(hourValue || '', 10);
      if (Number.isFinite(parsedHour)) return parsedHour;
    } catch {
      // Fallback for environments with limited Intl timezone support.
    }
    return new Date().getUTCHours();
  }, []);

  const getGreeting = useCallback(() => {
    const hours = getGhanaHour();
    if (hours < 5) return 'Good night';
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    if (hours < 21) return 'Good evening';
    return 'Good night';
  }, [getGhanaHour]);
  const [greetingText, setGreetingText] = useState(getGreeting);
  useEffect(() => {
    setGreetingText(getGreeting());
    const interval = setInterval(() => setGreetingText(getGreeting()), 60000);
    return () => clearInterval(interval);
  }, [getGreeting]);

  const firstName = useMemo(() => {
    const raw = String(
      userProfiles[currentEmail]?.username ||
      userProfiles[currentEmail]?.displayName ||
      userProfiles[currentEmail]?.name ||
      currentEmail.split('@')[0] ||
      'there'
    ).trim();
    return raw.split(/\s+/)[0] || 'there';
  }, [currentEmail, userProfiles]);

  const dashboardStats = useMemo(() => {
    return {
      activeJobs: activeJobCount,
      walletValue: heroWallet,
      ratingValue: heroRating,
    };
  }, [activeJobCount, heroRating, heroWallet]);

  const requestSummary = useMemo(() => {
    const summary = {
      open: 0,
      accepted: 0,
      inProgress: 0,
      pendingConfirm: 0,
      paid: 0,
    };

    requests.forEach((item) => {
      const status = getEffectiveStatus(item);
      if (status === REQUEST_STATUS.OPEN) summary.open += 1;
      if (status === REQUEST_STATUS.ACCEPTED) summary.accepted += 1;
      if (status === REQUEST_STATUS.IN_PROGRESS) summary.inProgress += 1;
      if (status === REQUEST_STATUS.PENDING_CONFIRMATION) summary.pendingConfirm += 1;
      if (status === REQUEST_STATUS.PAID || item.paid) summary.paid += 1;
    });

    return summary;
  }, [requests]);

  const topRatedProviders = useMemo(() => {
    return [...providers]
      .filter((p) => Number(p.avgRating || 0) > 0)
      .sort((a, b) => Number(b.avgRating || 0) - Number(a.avgRating || 0))
      .slice(0, 8);
  }, [providers]);

  const renderListHeader = () => (
    <View>
      {/* Promotional Ticker — full-width, negative margins counteract parent padding */}
      <View style={{ marginHorizontal: -16, marginTop: -16 }}>
        <PromotionalTicker />
      </View>

      {/* Hero Banner Carousel */}
      <View style={{ marginHorizontal: -16, marginBottom: 12 }}>
        <HeroBanner />
      </View>

      {/* Hero header */}
      <View style={{ backgroundColor: AppColors.brandNavy, borderRadius: AppRadius.xl, padding: AppSpace.xl, marginBottom: AppSpace.md, borderWidth: 1, borderColor: '#1e293b', ...AppShadow.lg }}>
        <Text style={{ fontSize: 13, color: '#93c5fd', letterSpacing: 1, fontWeight: '700' }}>CONNECTHUB</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#f8fafc' }}>{greetingText}, {firstName} 👋</Text>
            <Text style={{ color: '#cbd5e1', marginTop: 4, fontSize: 13, lineHeight: 19 }}>Find verified local service providers, secure escrow payments, and track real work from request to payout.</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.push('/help')}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}
              accessibilityLabel="Help & Support"
            >
              <Text style={{ fontSize: 16, color: '#fff', fontWeight: '800' }}>?</Text>
            </TouchableOpacity>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={() => router.push('/notifications')} style={{ position: 'relative' }}>
                <Text style={{ fontSize: 22 }}>🔔</Text>
                <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#dc2626', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              </TouchableOpacity>
            )}
            <Avatar src={userProfiles[currentEmail]?.profilePicture} email={currentEmail} size={44} />
          </View>
        </View>

        <View style={{ marginTop: 16, flexDirection: 'row', gap: 8 }}>
          <HeroMetric label="Active Jobs" value={dashboardStats.activeJobs} />
          <HeroMetric label="Wallet" value={`GHS ${dashboardStats.walletValue.toFixed(2)}`} />
          <HeroMetric label="Rating" value={dashboardStats.ratingValue ? dashboardStats.ratingValue.toFixed(1) : 'New'} />
        </View>
      </View>

      {/* Search bar */}
      <View style={{
        margin: 0,
        marginBottom: 12,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
      }}>
        <TouchableOpacity
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#fff',
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: '#e2e8f0',
            paddingHorizontal: 14,
            height: 50,
            gap: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 4,
            elevation: 2,
          }}
          onPress={() => router.push('/providers')}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 18 }}>🔍</Text>
          <Text style={{ fontSize: 15, color: '#94a3b8', flex: 1 }}>
            Search services, providers...
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            width: 50,
            height: 50,
            backgroundColor: '#1d4ed8',
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPress={openStatusFilterPicker}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <View style={{ backgroundColor: '#111827', borderRadius: AppRadius.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: AppSpace.md, overflow: 'hidden' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {PROMOTION_MESSAGES.map((item, index) => (
            <TouchableOpacity
              key={item.text}
              activeOpacity={0.8}
              onPress={() => router.push(item.route)}
              style={{ flexDirection: 'row', alignItems: 'center', marginRight: 20 }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: index % 2 === 0 ? '#22c55e' : '#f59e0b', marginRight: 8 }} />
              <Text style={{ color: '#f8fafc', fontWeight: '800', fontSize: 12 }}>{item.text}</Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginLeft: 4 }}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: AppSpace.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>Explore ConnectHub</Text>
          <TouchableOpacity onPress={() => router.push('/providers')}>
            <Text style={{ color: '#4f46e5', fontWeight: '700', fontSize: 13 }}>Browse all</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {SERVICE_MARKETPLACE_SECTIONS.map((section) => (
            <TouchableOpacity
              key={section.title}
              onPress={() => router.push(section.route)}
              activeOpacity={0.86}
              style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, ...AppShadow.card }}
            >
              <View style={{ width: 30, height: 4, borderRadius: 2, backgroundColor: section.accent, marginBottom: 10 }} />
              <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 14 }}>{section.title}</Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginTop: 4, lineHeight: 16 }} numberOfLines={2}>{section.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: '#ecfdf5', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#bbf7d0', padding: 12, marginBottom: AppSpace.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          {TRUST_SIGNALS.map((signal) => (
            <View key={signal.label} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: '#047857', fontWeight: '900', fontSize: 13 }}>{signal.value}</Text>
              <Text style={{ color: '#475569', fontWeight: '700', fontSize: 11, marginTop: 2, textAlign: 'center' }}>{signal.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Browse by Category — horizontal icon scroll */}
      <View style={{ marginBottom: AppSpace.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>Browse by Category</Text>
          <TouchableOpacity onPress={() => router.push('/providers')} activeOpacity={0.7}>
            <Text style={{ fontSize: 13, color: '#1d4ed8', fontWeight: '600' }}>See All →</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {SERVICE_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              onPress={() => router.push({ pathname: '/providers', params: { category: cat.value } })}
              style={{
                alignItems: 'center',
                backgroundColor: '#fff',
                borderRadius: 14,
                padding: 14,
                width: 80,
                borderWidth: 1,
                borderColor: '#e2e8f0',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 4,
                elevation: 2,
              }}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 26, marginBottom: 6 }}>{cat.icon}</Text>
              <Text style={{ fontSize: 11, color: '#334155', fontWeight: '600', textAlign: 'center' }}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Stats Banner — social proof */}
      <View style={{
        marginBottom: 16,
        backgroundColor: '#0f172a',
        borderRadius: 14,
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-around',
      }}>
        {[
          { number: '500+', label: 'Jobs Posted' },
          { number: '200+', label: 'Providers' },
          { number: '4.8★', label: 'Avg Rating' },
          { number: 'GHS', label: 'Safe Escrow' },
        ].map((stat, i) => (
          <View key={i} style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#ffffff' }}>{stat.number}</Text>
            <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Quick Actions ─────────────────────────────── */}
      <TouchableOpacity
        onPress={() => router.push('/request-wizard')}
        activeOpacity={0.88}
        style={{
          backgroundColor: '#4f46e5',
          borderRadius: AppRadius.lg,
          paddingVertical: 17,
          marginBottom: AppSpace.md,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
          shadowColor: '#4f46e5',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 10,
          elevation: 6,
        }}
      >
        <Text style={{ fontSize: 22 }}>＋</Text>
        <View>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Post a New Job</Text>
          <Text style={{ color: '#c7d2fe', fontSize: 11, marginTop: 1 }}>Connect with a verified local provider</Text>
        </View>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: AppSpace.md }}>
        {[
          { icon: '📋', label: 'My Jobs', onPress: () => router.push(isProvider ? '/active-jobs' : '/my-requests') },
          { icon: '💰', label: 'Wallet', onPress: openWallet },
          { icon: '🔔', label: 'Alerts', onPress: () => router.push('/notifications'), badge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null },
          { icon: '🔎', label: 'Providers', onPress: () => router.push('/providers') },
          { icon: '🛠', label: 'Offer Services', onPress: () => router.push('/provider-setup') },
          { icon: '👤', label: 'Profile', onPress: () => router.push('/profile') },
          { icon: '🚀', label: 'Subscription', onPress: () => router.push('/subscription') },
          { icon: '🎁', label: 'Referral', onPress: () => router.push('/referral') },
          isAdmin
            ? { icon: '⚙️', label: 'Admin', onPress: () => router.push('/admin'), bg: '#fefce8', border: '#fde68a' }
            : { icon: '💳', label: 'Payments', onPress: () => router.push('/payments') },
        ].map((action) => (
          <TouchableOpacity
            key={action.label}
            onPress={action.onPress}
            activeOpacity={0.78}
            style={{
              width: '31%',
              backgroundColor: action.bg || '#fff',
              borderRadius: AppRadius.md,
              paddingVertical: 14,
              paddingHorizontal: 4,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: action.border || '#e2e8f0',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 3,
              elevation: 1,
              minHeight: 76,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 24, marginBottom: 6 }}>{action.icon}</Text>
            <Text style={{ fontSize: 11, color: '#334155', fontWeight: '700', textAlign: 'center', lineHeight: 14 }}>{action.label}</Text>
            {action.badge ? (
              <View style={{ position: 'absolute', top: 8, right: 12, backgroundColor: '#dc2626', borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{action.badge}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        onPress={handleLogout}
        activeOpacity={0.7}
        style={{ alignSelf: 'center', marginBottom: AppSpace.md, paddingVertical: 6, paddingHorizontal: 16 }}
      >
        <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>Sign out of account</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push('/help')}
        activeOpacity={0.86}
        style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#dbeafe', padding: 12, marginBottom: AppSpace.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...AppShadow.card }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '900', fontSize: 14 }}>Customer Support</Text>
          <Text style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>Need help with a provider, escrow payment, location, or account verification?</Text>
        </View>
        <View style={{ backgroundColor: '#eff6ff', borderRadius: AppRadius.md, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: '#1d4ed8', fontWeight: '900', fontSize: 12 }}>Get Help</Text>
        </View>
      </TouchableOpacity>

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} />

      {isProvider && isFreePlan ? (
        <View style={{
          marginBottom: AppSpace.md,
          borderRadius: AppRadius.md,
          backgroundColor: monthlyAcceptsUsed >= FREE_ACCEPT_LIMIT ? '#fef2f2' : monthlyAcceptsUsed >= 4 ? '#fefce8' : '#f0fdf4',
          borderWidth: 1,
          borderColor: monthlyAcceptsUsed >= FREE_ACCEPT_LIMIT ? '#fca5a5' : monthlyAcceptsUsed >= 4 ? '#fde68a' : '#bbf7d0',
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', fontSize: 13, color: monthlyAcceptsUsed >= FREE_ACCEPT_LIMIT ? '#b91c1c' : monthlyAcceptsUsed >= 4 ? '#92400e' : '#15803d' }}>
              {monthlyAcceptsUsed >= FREE_ACCEPT_LIMIT ? '🚫 Monthly limit reached' : `✅ ${monthlyAcceptsUsed} / ${FREE_ACCEPT_LIMIT} jobs accepted this month`}
            </Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {monthlyAcceptsUsed >= FREE_ACCEPT_LIMIT
                ? 'Upgrade to Pro for unlimited accepts.'
                : `${FREE_ACCEPT_LIMIT - monthlyAcceptsUsed} accepts remaining. Resets 1st of next month.`}
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/subscription')} style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.sm, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
            {providers.map((p) => {
              const providerCity = getLocationCity(p.location) || getLocationCity(p.city) || null;
              const badge = getProviderBadge(p);
              const avatarBg = getAvatarColor(p.email);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => router.push({ pathname: '/provider-detail', params: { email: p.email } })}
                  style={{
                    width: 160,
                    marginRight: 12,
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.07,
                    shadowRadius: 6,
                    elevation: 3,
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{ height: 80, backgroundColor: avatarBg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: '#1e3a8a' }}>
                      {(p.name || p.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ padding: 10, gap: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>
                      {p.name || p.email}
                    </Text>
                    {p.category ? (
                      <Text style={{ fontSize: 11, color: '#1d4ed8', fontWeight: '600' }}>{p.category}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontSize: 11, color: '#d97706', fontWeight: '600' }}>
                        ⭐ {p.avgRating ? Number(p.avgRating).toFixed(1) : 'New'}
                      </Text>
                      {p.startingPrice ? (
                        <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}>
                          GHS {p.startingPrice}
                        </Text>
                      ) : null}
                    </View>
                    {providerCity ? (
                      <Text style={{ fontSize: 10, color: '#94a3b8' }} numberOfLines={1}>📍 {providerCity}</Text>
                    ) : null}
                    {badge ? (
                      <View style={{
                        alignSelf: 'flex-start',
                        backgroundColor: badge.bg,
                        borderRadius: 20,
                        paddingVertical: 3,
                        paddingHorizontal: 8,
                        marginTop: 4,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: badge.color }}>{badge.label}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Top Rated This Week */}
      {topRatedProviders.length > 0 && (
        <View style={{ marginBottom: AppSpace.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>🔥 Top Rated This Week</Text>
            <TouchableOpacity onPress={() => router.push('/providers')}>
              <Text style={{ color: '#4f46e5', fontWeight: '600', fontSize: 13 }}>See all →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {topRatedProviders.map((p) => {
              const providerCity = getLocationCity(p.location) || null;
              const badge = getProviderBadge(p);
              const avatarBg = getAvatarColor(p.email);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => router.push({ pathname: '/provider-detail', params: { email: p.email } })}
                  style={{
                    width: 160,
                    marginRight: 12,
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.07,
                    shadowRadius: 6,
                    elevation: 3,
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{ height: 80, backgroundColor: avatarBg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: '#1e3a8a' }}>
                      {(p.name || p.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ padding: 10, gap: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>
                      {p.name || p.email}
                    </Text>
                    {p.category ? (
                      <Text style={{ fontSize: 11, color: '#1d4ed8', fontWeight: '600' }}>{p.category}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontSize: 11, color: '#d97706', fontWeight: '700' }}>
                        ⭐ {Number(p.avgRating).toFixed(1)}
                      </Text>
                      {p.startingPrice ? (
                        <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}>
                          GHS {p.startingPrice}
                        </Text>
                      ) : null}
                    </View>
                    {providerCity ? (
                      <Text style={{ fontSize: 10, color: '#94a3b8' }} numberOfLines={1}>📍 {providerCity}</Text>
                    ) : null}
                    {badge ? (
                      <View style={{
                        alignSelf: 'flex-start',
                        backgroundColor: badge.bg,
                        borderRadius: 20,
                        paddingVertical: 3,
                        paddingHorizontal: 8,
                        marginTop: 4,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: badge.color }}>{badge.label}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Recently Joined Providers */}
      {recentProviders.length > 0 && (
        <View style={{ marginBottom: AppSpace.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>🆕 Recently Joined Providers</Text>
            <TouchableOpacity onPress={() => router.push('/providers')}>
              <Text style={{ color: '#4f46e5', fontWeight: '600', fontSize: 13 }}>See all →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentProviders.map((p) => {
              const providerCity = getLocationCity(p.location) || null;
              const avatarBg = getAvatarColor(p.email);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => router.push({ pathname: '/provider-detail', params: { email: p.email } })}
                  style={{
                    width: 160,
                    marginRight: 12,
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.07,
                    shadowRadius: 6,
                    elevation: 3,
                  }}
                  activeOpacity={0.8}
                >
                  {/* NEW badge ribbon */}
                  <View style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, backgroundColor: '#7c3aed', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>NEW</Text>
                  </View>
                  <View style={{ height: 80, backgroundColor: avatarBg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: '#1e3a8a' }}>
                      {(p.name || p.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ padding: 10, gap: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>
                      {p.name || p.email}
                    </Text>
                    {p.category ? (
                      <Text style={{ fontSize: 11, color: '#1d4ed8', fontWeight: '600' }}>{p.category}</Text>
                    ) : null}
                    <Text style={{ fontSize: 11, color: '#7c3aed', fontWeight: '600', marginTop: 2 }}>
                      Akwaaba! 🎉
                    </Text>
                    {providerCity ? (
                      <Text style={{ fontSize: 10, color: '#94a3b8' }} numberOfLines={1}>📍 {providerCity}</Text>
                    ) : null}
                    {p.startingPrice ? (
                      <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700', marginTop: 2 }}>
                        GHS {p.startingPrice}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Category filter */}
      <View style={{ marginBottom: AppSpace.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>📋 Live Requests ({visibleRequests.length})</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: '#e2e8f0', marginLeft: 10 }} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          <StatusChip label="Open" value={requestSummary.open} bg="#dbeafe" fg="#1d4ed8" />
          <StatusChip label="Accepted" value={requestSummary.accepted} bg="#ffedd5" fg="#c2410c" />
          <StatusChip label="Working" value={requestSummary.inProgress} bg="#ede9fe" fg="#5b21b6" />
          <StatusChip label="Awaiting Confirm" value={requestSummary.pendingConfirm} bg="#fef3c7" fg="#b45309" />
          <StatusChip label="Paid" value={requestSummary.paid} bg="#dcfce7" fg="#15803d" />
        </View>

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

        {isProvider ? (
          <View style={{ marginTop: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CITY_OPTIONS.map((city) => {
                const active = city === selectedCity;
                return (
                  <TouchableOpacity
                    key={city}
                    onPress={() => setSelectedCity(city)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: AppRadius.md,
                      backgroundColor: active ? '#0f766e' : '#fff',
                      borderWidth: 1,
                      borderColor: active ? '#0f766e' : '#e2e8f0',
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : AppColors.ink700, fontWeight: '700', fontSize: 12 }}>
                      {city}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
              <TouchableOpacity
                onPress={resolveMyLocation}
                style={{ flex: 1, backgroundColor: '#ecfeff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#a5f3fc', paddingVertical: 10, alignItems: 'center' }}
              >
                <Text style={{ color: '#0f766e', fontWeight: '700', fontSize: 12 }}>{isLocating ? 'Locating...' : '📍 Detect My Location'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setNearMeOnly((prev) => !prev)}
                style={{ flex: 1, backgroundColor: nearMeOnly ? '#0f766e' : '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: nearMeOnly ? '#0f766e' : '#e2e8f0', paddingVertical: 10, alignItems: 'center' }}
              >
                <Text style={{ color: nearMeOnly ? '#fff' : AppColors.ink700, fontWeight: '700', fontSize: 12 }}>🧭 Near Me (25km)</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
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
          ListFooterComponent={() => (
            <View style={{
              margin: 0,
              marginTop: 16,
              marginHorizontal: -16,
              backgroundColor: '#0f172a',
              padding: 24,
              alignItems: 'center',
              gap: 12,
            }}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: '#fff' }}>ConnectHub</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
                Ghana&apos;s trusted marketplace for local services
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#1d4ed8',
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                  }}
                  onPress={() => router.push('/providers')}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>🌐 Browse Providers</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                © 2026 ConnectHub. All rights reserved.
              </Text>
              <View style={{ flexDirection: 'row', gap: 20, marginTop: 4 }}>
                <TouchableOpacity onPress={() => router.push('/terms')} activeOpacity={0.7}>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>Terms</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/privacy-policy')} activeOpacity={0.7}>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>Privacy</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/help')} activeOpacity={0.7}>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>Help</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 46, marginBottom: 12 }}>📭</Text>
              <Text style={{ fontSize: 18, color: AppColors.ink900, fontWeight: '800', textAlign: 'center' }}>No active jobs yet</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>Post a job or browse providers to get started.</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity onPress={() => router.push('/request-wizard')} style={{ backgroundColor: '#2563eb', borderRadius: AppRadius.md, paddingVertical: 12, paddingHorizontal: 16 }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Post a Job</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/providers')} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: AppRadius.md, paddingVertical: 12, paddingHorizontal: 16 }}>
                  <Text style={{ color: AppColors.ink700, fontWeight: '800' }}>Browse Providers</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const status = getEffectiveStatus(item);
            const isOwner = item.user === currentEmail;
            const isProvider = item.acceptedBy === currentEmail;
            const activeAction = pendingAction?.startsWith(`${item.id}:`) ? pendingAction.split(':')[1] : null;
            const isConfirmingDelete = confirmDeleteId === item.id;
            const statusMeta = STATUS_META[status] || STATUS_META[REQUEST_STATUS.OPEN];
            const locationLabel = getLocationLabel(item.location) || item.locationText || 'Location not specified';
            const parts = String(locationLabel).split(',').map((part) => part.trim()).filter(Boolean);
            const areaName = parts[0] || locationLabel;
            const postedAt = formatRelativeTime(item.createdAt);

            return (
              <AppCard style={{ marginBottom: 14, borderLeftWidth: 5, borderLeftColor: statusMeta.border, ...AppShadow.card }}>
                {/* Header row with category badge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: '#111827', flex: 1 }}>{item.title}</Text>
                  <View style={{ backgroundColor: statusMeta.pillBg, borderRadius: AppRadius.pill, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: statusMeta.pillText }}>{statusMeta.label}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  {item.category && (
                    <View style={{ backgroundColor: '#eef2ff', borderRadius: AppRadius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#4f46e5' }}>{CATEGORY_ICONS[item.category] || '✨'} {item.category}</Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 12, color: '#94a3b8' }}>{postedAt}</Text>
                </View>

                {item.description ? (
                  <Text style={{ marginTop: 2, color: '#475569', fontSize: 13, lineHeight: 18, marginBottom: 4 }} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}

                <Text style={{ color: '#334155', fontSize: 13 }}>📍 <Text style={{ fontWeight: '800', color: AppColors.ink900 }}>{areaName}</Text>{parts.length > 1 ? `, ${parts.slice(1).join(', ')}` : ''}</Text>
                    {currentCoords ? (() => {
                      const targetCoords = getLocationCoords(item.location);
                      const km = distanceKm(currentCoords, targetCoords);
                      if (km == null) return null;
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <Text style={{ fontSize: 12, color: '#1d4ed8', fontWeight: '600' }}>📍 {km < 1 ? `${Math.round(km * 1000)}m away` : `${km.toFixed(1)}km away`}</Text>
                          <Text style={{ fontSize: 12, color: '#94a3b8' }}>•</Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>{locationLabel}</Text>
                        </View>
                      );
                    })() : null}
                <View style={{ alignSelf: 'flex-start', backgroundColor: '#dcfce7', borderRadius: AppRadius.pill, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 }}>
                  <Text style={{ color: '#166534', fontWeight: '800', fontSize: 12 }}>GHS {item.price}</Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#3730a3', fontWeight: '800', fontSize: 13 }}>
                      {String(item.user || '?').trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <Text style={{ color: '#6b7280', fontSize: 12, flex: 1 }} numberOfLines={1}>{item.user || 'Unavailable'}</Text>
                  <Text style={{ color: '#d1d5db', fontSize: 12 }}>→</Text>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: item.acceptedBy ? '#dbeafe' : '#e5e7eb', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: item.acceptedBy ? '#1d4ed8' : '#6b7280', fontWeight: '800', fontSize: 13 }}>
                      {String(item.acceptedBy || '?').trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <Text style={{ color: '#6b7280', fontSize: 12, flex: 1 }} numberOfLines={1}>{item.acceptedBy || 'No provider yet'}</Text>
                  {item.acceptedBy ? (
                    <SubscriptionBadge
                      plan={userProfiles[item.acceptedBy]?.subscriptionPlan}
                      style={{ marginLeft: 4 }}
                    />
                  ) : null}
                </View>

                {/* Visual status stepper */}
                <JobStepper status={status} request={item} />

                <AppButton
                  label="View Details"
                  variant="neutral"
                  onPress={() => router.push({ pathname: '/job-details', params: { requestId: item.id } })}
                  style={{ marginTop: AppSpace.sm }}
                />

                {/* Action buttons */}
                {!item.acceptedBy && !isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label="Accept Job" variant="primary" onPress={() => handleAccept(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'accept'} loadingLabel="Accepting..." style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.ACCEPTED ? (
                  <View style={{ marginTop: AppSpace.sm, backgroundColor: '#fffbeb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#fcd34d' }}>
                    <Text style={{ color: '#92400e', fontWeight: '800', fontSize: 13 }}>⏳ Awaiting Payment</Text>
                    <Text style={{ color: '#b45309', fontSize: 12, marginTop: 2 }}>Work begins once the customer funds escrow.</Text>
                    <AppButton label="Remind Customer" variant="warning" onPress={() => remindCustomerToFund(item)} style={{ marginTop: 8 }} />
                  </View>
                ) : null}

                {isProvider && status === REQUEST_STATUS.IN_PROGRESS ? (
                  <AppButton label="Mark Completed" onPress={() => handleCompleteWork(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'complete'} loadingLabel="Completing..." style={{ marginTop: AppSpace.sm, backgroundColor: AppColors.teal700 }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                  <View style={{ marginTop: AppSpace.sm, backgroundColor: '#fef9c3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#facc15' }}>
                    <Text style={{ color: '#a16207', fontWeight: '800', fontSize: 12 }}>Awaiting Customer Confirmation</Text>
                    <Text style={{ color: '#a16207', fontSize: 12, marginTop: 2 }}>Payment remains locked until customer confirms.</Text>
                    {isOverduePending(item) ? (
                      <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 12, marginTop: 6 }}>
                        Overdue - no customer response (48h+). Auto-confirm will release payment.
                      </Text>
                    ) : null}
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

                {isOwner && status === REQUEST_STATUS.ACCEPTED && !item.escrowFunded && !item.paid ? (
                  <AppButton label="Fund Escrow" variant="success" onPress={() => handlePay(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.OPEN ? (
                  <AppButton label={isConfirmingDelete ? 'Tap Again To Cancel Request' : 'Cancel Request'} variant="danger" onPress={() => handleCancel(item)} disabled={Boolean(pendingAction)} loading={activeAction === 'cancel'} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isOwner && status === REQUEST_STATUS.PAID && item.acceptedBy && !item.rating && isWithinRatingWindow(item) ? (
                  <AppButton label="⭐ Rate Provider" variant="warning" onPress={() => openRateScreen(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {isProvider && status === REQUEST_STATUS.PAID && !item.customerRating && isWithinRatingWindow(item) ? (
                  <AppButton label="⭐ Rate Customer" variant="warning" onPress={() => openRateCustomerScreen(item)} style={{ marginTop: AppSpace.sm }} />
                ) : null}

                {(isOwner || isProvider) && item.acceptedBy ? (
                  <AppButton label="💬 Open Chat" variant="neutral" onPress={() => router.push({ pathname: '/chat', params: { jobId: item.id } })} style={{ marginTop: AppSpace.sm }} />
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

      <Animated.View style={{ position: 'absolute', right: 20, bottom: 24, transform: [{ scale: fabScale }] }}>
        <TouchableOpacity onPress={() => router.push('/request-wizard')} style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', ...AppShadow.card }}>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '700', marginTop: -2 }}>+</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function HeroMetric({ label, value }) {
  return (
    <View style={{ flex: 1, borderRadius: AppRadius.md, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, paddingHorizontal: 10 }}>
      <Text style={{ color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '900', marginTop: 3 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function StatusChip({ label, value, bg, fg }) {
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginRight: 8,
        marginBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      <Text style={{ color: fg, fontWeight: '900', fontSize: 12, marginLeft: 6 }}>{value}</Text>
    </View>
  );
}
