import { useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

import Avatar from '../components/ui/avatar';
import { isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiGet, apiPost, assertApiSuccess } from '../utils/api-client';

const ADMIN_BACKGROUND = '#f1f5f9';
const ADMIN_SIDEBAR = '#0f172a';
const ADMIN_ACCENT = '#2dd4bf';
const ADMIN_CARD_BG = '#ffffff';
const ADMIN_TEXT = '#0f172a';
const ADMIN_TEXT_LIGHT = '#64748b';
const BADGE_GREEN = '#10b981';
const BADGE_BLUE = '#3b82f6';
const BADGE_RED = '#ef4444';
const BADGE_YELLOW = '#eab308';

const USER_FIELDS_FOR_DELETION = ['userId', 'customerId', 'providerId', 'email', 'userEmail', 'ownerEmail', 'providerEmail'];

function normalizeRole(role) {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'BANNED') return 'BANNED';
  if (value === 'PROVIDER') return 'PROVIDER';
  return 'CUSTOMER';
}

function normalizeKycStatus(user) {
  const verifiedValue = user?.kycVerified;
  const statusValue = String(user?.kycStatus || user?.kyc || user?.status || '').trim().toLowerCase();
  if (verifiedValue === true || statusValue === 'verified' || statusValue === 'approved') return 'VERIFIED';
  return 'UNVERIFIED';
}

function formatDate(value) {
  if (!value) return 'Recently updated';
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toLocaleString();
    } catch {
      return 'Recently updated';
    }
  }
  if (typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000).toLocaleString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function firstLetter(value) {
  const text = String(value || '').trim();
  return text ? text[0].toUpperCase() : '?';
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function extractKycPhotos(row) {
  const candidates = [
    row?.photoUrls,
    row?.documentUrls,
    row?.images,
    row?.selfieUrl,
    row?.idFrontUrl,
    row?.idBackUrl,
    row?.imageUrl,
    row?.selfie,
    row?.document,
  ];

  const urls = [];
  candidates.forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        const text = String(entry || '').trim();
        if (text) urls.push(text);
      });
      return;
    }

    const text = String(value || '').trim();
    if (text) urls.push(text);
  });

  return [...new Set(urls)];
}

function formatMoney(value) {
  return `GHS ${safeNumber(value).toFixed(2)}`;
}

function matchesUserIdentity(job, identifiers, fields) {
  for (const field of fields) {
    const fieldValue = String(job?.[field] || '').trim().toLowerCase();
    if (fieldValue && identifiers.has(fieldValue)) return true;
  }
  return false;
}

function StatCard({ icon, label, value, tone }) {
  return (
    <View style={{ width: '100%', paddingHorizontal: 8, paddingBottom: 16 }}>
      <View
        style={{
          backgroundColor: ADMIN_CARD_BG,
          borderRadius: 12,
          padding: 18,
          borderLeftWidth: 4,
          borderLeftColor: tone,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}
      >
        <Text style={{ fontSize: 26, marginBottom: 8 }}>{icon}</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: ADMIN_TEXT }}>{value}</Text>
        <Text style={{ marginTop: 4, color: ADMIN_TEXT_LIGHT, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      </View>
    </View>
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function Badge({ label, bg, fg }) {
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function ActionButton({ label, backgroundColor, onPress, textColor = '#ffffff' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        marginRight: 8,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Text style={{ color: textColor, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

function MetricRow({ label, value, color, trackColor = '#e2e8f0', percent = 0 }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: ADMIN_TEXT, fontWeight: '700', fontSize: 13 }}>{label}</Text>
        <Text style={{ color, fontWeight: '800', fontSize: 13 }}>{value}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: trackColor, borderRadius: 999, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%', backgroundColor: color, borderRadius: 999 }} />
      </View>
    </View>
  );
}

function InsightCard({ title, value, subtitle, accent }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 180,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        marginRight: 12,
        marginBottom: 12,
      }}
    >
      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: ADMIN_TEXT, fontSize: 26, fontWeight: '900', marginTop: 8 }}>{value}</Text>
      <Text style={{ color: accent, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{subtitle}</Text>
    </View>
  );
}

export default function Admin() {
  const router = useRouter();
  const auth = getAuth();
  const { user, isAuthReady } = useAuthUser();

  const [activeView, setActiveView] = useState('dashboard');
  const [rawUsers, setRawUsers] = useState([]);
  const [providerEmails, setProviderEmails] = useState(new Set());
  const [jobs, setJobs] = useState([]);
  const [withdrawalsPending, setWithdrawalsPending] = useState(0);
  const [kycPending, setKycPending] = useState(0);
  const [disputes, setDisputes] = useState(0);
  const [fraudPending, setFraudPending] = useState(0);
  const [signupErrors, setSignupErrors] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [withdrawalsRows, setWithdrawalsRows] = useState([]);
  const [kycRows, setKycRows] = useState([]);
  const [disputeRows, setDisputeRows] = useState([]);
  const [fraudRows, setFraudRows] = useState([]);
  const [requestRows, setRequestRows] = useState([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [adminSettings, setAdminSettings] = useState({
    supportEmail: 'connecthub1000@gmail.com',
    commissionRate: '0.10',
    maintenanceMode: false,
    kycAutoNotify: true,
  });
  const [emailTestTarget, setEmailTestTarget] = useState('connecthub1000@gmail.com');
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [emailTestLoading, setEmailTestLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);
  const [expandedKycId, setExpandedKycId] = useState(null);

  const isAdmin = Boolean(user && isAdminEmail(user.email));

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(collection(db, 'users'), (snapshot) => {
      setRawUsers(
        snapshot.docs.map((entry) => {
          const data = entry.data() || {};
          const email = String(data.email || entry.id || data.phoneNumber || '').trim().toLowerCase();
          return {
            uid: entry.id,
            email: email || entry.id,
            displayName: String(data.displayName || data.fullName || '').trim(),
            phoneNumber: String(data.phoneNumber || data.phone || '').trim(),
            role: normalizeRole(data.role),
            banned: data.banned === true,
            kycStatus: normalizeKycStatus(data),
            createdAt: data.createdAt || data.joinedAt || null,
            updatedAt: data.updatedAt || null,
            raw: data,
          };
        })
      );
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(collection(db, 'providers'), (snapshot) => {
      const emails = new Set(
        snapshot.docs
          .map((entry) => String(entry.data()?.email || entry.id || '').trim().toLowerCase())
          .filter(Boolean)
      );
      setProviderEmails(emails);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(100)), (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setJobs(rows);
      setRequestRows(rows);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'withdrawals'), where('status', '==', 'PENDING')), (snapshot) => {
      setWithdrawalsPending(snapshot.size);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'kyc_submissions'), where('status', '==', 'PENDING')), (snapshot) => {
      setKycPending(snapshot.size);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'disputes'), orderBy('createdAt', 'desc'), limit(100)), (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setDisputeRows(rows);
      setDisputes(rows.filter((row) => !['resolved', 'closed'].includes(String(row.status || '').toLowerCase())).length);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'fraudAlerts'), orderBy('timestamp', 'desc'), limit(100)), (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setFraudRows(rows);
      setFraudPending(rows.filter((row) => row.resolved !== true).length);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'withdrawals'), orderBy('requestedAt', 'desc'), limit(100)), (snapshot) => {
      setWithdrawalsRows(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'kyc_submissions'), orderBy('submittedAt', 'desc'), limit(100)), (snapshot) => {
      setKycRows(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    let mounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'adminSettings', 'global'));
        if (mounted && snap.exists()) {
          const data = snap.data() || {};
          setAdminSettings((prev) => ({
            ...prev,
            supportEmail: String(data.supportEmail || prev.supportEmail),
            commissionRate: String(data.commissionRate ?? prev.commissionRate),
            maintenanceMode: data.maintenanceMode === true,
            kycAutoNotify: data.kycAutoNotify !== false,
          }));
        }
      } catch {
        // Keep local defaults if settings doc is unavailable.
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    const loadSignupErrors = async () => {
      try {
        const { response, data } = await apiGet(`${API_BASE_URL}/admin/auth/signup-errors?limit=100`, {
          requireAuth: true,
        });
        assertApiSuccess(response, data, 'Failed to load signup errors');
        setSignupErrors(Array.isArray(data?.logs) ? data.logs.length : 0);
      } catch {
        setSignupErrors(0);
      }
    };

    loadSignupErrors();
  }, [isAdmin]);

  const users = useMemo(() => {
    return rawUsers.map((userRow) => {
      const identifiers = new Set(
        [userRow.uid, userRow.email, userRow.phoneNumber, userRow.displayName]
          .filter(Boolean)
          .map((value) => String(value).trim().toLowerCase())
      );

      const jobCounts = jobs.reduce(
        (accumulator, job) => {
          if (matchesUserIdentity(job, identifiers, ['customerId', 'customerEmail', 'userId', 'postedBy', 'createdBy', 'ownerEmail', 'email'])) {
            accumulator.jobsPosted += 1;
          }
          if (matchesUserIdentity(job, identifiers, ['providerId', 'providerEmail', 'acceptedBy', 'acceptedProvider', 'workerEmail'])) {
            accumulator.jobsAccepted += 1;
          }
          return accumulator;
        },
        { jobsPosted: 0, jobsAccepted: 0 }
      );

      return {
        ...userRow,
        role: providerEmails.has(String(userRow.email || '').trim().toLowerCase())
          ? 'PROVIDER'
          : userRow.role,
        avatarInitial: firstLetter(userRow.email || userRow.displayName || userRow.phoneNumber),
        jobsPosted: jobCounts.jobsPosted,
        jobsAccepted: jobCounts.jobsAccepted,
        walletBalance: safeNumber(userRow.raw?.walletBalance || userRow.raw?.balance || userRow.raw?.availableBalance),
      };
    });
  }, [jobs, providerEmails, rawUsers]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;

    return users.filter((entry) => {
      return [entry.email, entry.displayName, entry.role, entry.kycStatus, entry.phoneNumber]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [searchTerm, users]);

  const usersPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / usersPerPage));
  const paginatedUsers = filteredUsers.slice(currentPage * usersPerPage, (currentPage + 1) * usersPerPage);

  useEffect(() => {
    if (currentPage > totalPages - 1) {
      setCurrentPage(0);
    }
  }, [currentPage, totalPages]);

  const statsCards = useMemo(
    () => [
      { icon: '💼', label: 'Total Jobs', value: jobs.length, tone: ADMIN_ACCENT },
      { icon: '🪪', label: 'KYC Pending', value: kycPending, tone: BADGE_YELLOW },
      { icon: '⚠️', label: 'Disputes', value: disputes, tone: BADGE_RED },
      { icon: '💸', label: 'Withdrawals Pending', value: withdrawalsPending, tone: BADGE_YELLOW },
      { icon: '🚨', label: 'Fraud Pending', value: fraudPending, tone: BADGE_RED },
      { icon: '🔒', label: 'Stuck Payments', value: 0, tone: BADGE_RED },
      { icon: '❌', label: 'Signup Errors', value: signupErrors, tone: signupErrors > 0 ? BADGE_RED : BADGE_GREEN },
      { icon: '👥', label: 'Total Users', value: users.length, tone: ADMIN_ACCENT },
    ],
    [disputes, fraudPending, jobs.length, kycPending, signupErrors, users.length, withdrawalsPending]
  );

  const exportCsv = (filename, columns, rows) => {
    try {
      const header = columns.join(',');
      const lines = rows.map((row) => columns.map((column) => csvEscape(row?.[column])).join(','));
      const content = [header, ...lines].join('\n');

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        Alert.alert('Export ready', 'CSV export is available on web dashboard.');
      }
    } catch (error) {
      Alert.alert('Export failed', String(error?.message || 'Could not export CSV'));
    }
  };

  const dashboardMetrics = useMemo(() => {
    const providerCount = users.filter((entry) => normalizeRole(entry.role) === 'PROVIDER').length;
    const customerCount = users.filter((entry) => normalizeRole(entry.role) === 'CUSTOMER').length;
    const verifiedCount = users.filter((entry) => entry.kycStatus === 'VERIFIED').length;
    const bannedCount = users.filter((entry) => entry.banned).length;
    const totalUsers = users.length || 1;

    return {
      providerCount,
      customerCount,
      verifiedCount,
      bannedCount,
      providerPercent: Math.round((providerCount / totalUsers) * 100),
      customerPercent: Math.round((customerCount / totalUsers) * 100),
      verifiedPercent: Math.round((verifiedCount / totalUsers) * 100),
      riskPercent: Math.round((((fraudPending + disputes + signupErrors) || 0) / Math.max(1, jobs.length || users.length || 1)) * 100),
    };
  }, [disputes, fraudPending, jobs.length, signupErrors, users]);

  const adminSearchTerm = adminSearch.trim().toLowerCase();

  const filteredWithdrawals = useMemo(() => {
    if (!adminSearchTerm) return withdrawalsRows;
    return withdrawalsRows.filter((row) => {
      return [row.email, row.reference, row.status, row.accountNumber, row.accountName]
        .join(' ')
        .toLowerCase()
        .includes(adminSearchTerm);
    });
  }, [adminSearchTerm, withdrawalsRows]);

  const filteredKycRows = useMemo(() => {
    if (!adminSearchTerm) return kycRows;
    return kycRows.filter((row) => {
      return [row.email, row.userEmail, row.status, row.fullName]
        .join(' ')
        .toLowerCase()
        .includes(adminSearchTerm);
    });
  }, [adminSearchTerm, kycRows]);

  const filteredDisputes = useMemo(() => {
    if (!adminSearchTerm) return disputeRows;
    return disputeRows.filter((row) => {
      return [row.requestId, row.status, row.customerEmail, row.providerEmail, row.reason]
        .join(' ')
        .toLowerCase()
        .includes(adminSearchTerm);
    });
  }, [adminSearchTerm, disputeRows]);

  const filteredFraudRows = useMemo(() => {
    if (!adminSearchTerm) return fraudRows;
    return fraudRows.filter((row) => {
      return [row.user, row.userEmail, row.reason, row.type, row.status]
        .join(' ')
        .toLowerCase()
        .includes(adminSearchTerm);
    });
  }, [adminSearchTerm, fraudRows]);

  const filteredRequests = useMemo(() => {
    if (!adminSearchTerm) return requestRows;
    return requestRows.filter((row) => {
      return [row.title, row.status, row.user, row.acceptedBy, row.category]
        .join(' ')
        .toLowerCase()
        .includes(adminSearchTerm);
    });
  }, [adminSearchTerm, requestRows]);

  const loadWalletForUser = async (userRow) => {
    setSelectedUserLoading(true);
    setSelectedWallet(null);

    try {
      const candidateIds = [userRow.uid, userRow.email].filter(Boolean);

      for (const candidateId of candidateIds) {
        const walletSnapshot = await getDoc(doc(db, 'wallets', candidateId));
        if (walletSnapshot.exists()) {
          setSelectedWallet({ id: walletSnapshot.id, ...walletSnapshot.data() });
          setSelectedUserLoading(false);
          return;
        }
      }

      const walletFieldQueries = [
        ['userId', userRow.email],
        ['userId', userRow.uid],
        ['email', userRow.email],
        ['ownerEmail', userRow.email],
        ['providerEmail', userRow.email],
      ];

      for (const [field, value] of walletFieldQueries) {
        if (!value) continue;
        const walletQuery = await getDocs(query(collection(db, 'wallets'), where(field, '==', value)));
        if (walletQuery.size > 0) {
          const walletDoc = walletQuery.docs[0];
          setSelectedWallet({ id: walletDoc.id, ...walletDoc.data() });
          setSelectedUserLoading(false);
          return;
        }
      }
    } catch (error) {
      console.error('Wallet lookup failed', error);
    } finally {
      setSelectedUserLoading(false);
    }
  };

  const handleViewUser = (userRow) => {
    setSelectedUser(userRow);
    setSelectedWallet(null);
    loadWalletForUser(userRow);
  };

  const handleBanUser = async (userRow) => {
    const targetEmail = String(userRow.email || '').trim().toLowerCase();
    if (!targetEmail) return;

    const confirmMessage = userRow.banned
      ? `Unban ${targetEmail}? They will be able to log in again.`
      : `Ban ${targetEmail}? They will not be able to log in.`;
    const confirmed = typeof window !== 'undefined' ? window.confirm(confirmMessage) : true;
    if (!confirmed) return;

    try {
      const endpoint = userRow.banned ? `/admin/users/${encodeURIComponent(targetEmail)}/unban` : `/admin/users/${encodeURIComponent(targetEmail)}/ban`;
      const { response, data } = await apiPost(
        `${API_BASE_URL}${endpoint}`,
        userRow.banned ? {} : { reason: 'Suspended from admin desk' },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Failed to update user status');
      Alert.alert('Success', userRow.banned ? `${targetEmail} has been unbanned.` : `${targetEmail} has been banned.`);
    } catch (error) {
      Alert.alert('Error', `Failed to update user: ${error.message}`);
    }
  };

  const removeRelatedFirestoreDocs = async (userRow) => {
    const candidateValues = [userRow.uid, userRow.email].filter(Boolean);

    const deleteDocSafely = async (docRef) => {
      try {
        await deleteDoc(docRef);
      } catch {
        // Ignore missing documents or permission misses for already-removed rows.
      }
    };

    const deleteByIds = async (collectionName, ids) => {
      await Promise.all(ids.map((id) => deleteDocSafely(doc(db, collectionName, id))));
    };

    const deleteByField = async (collectionName, fieldName, value) => {
      const snapshot = await getDocs(query(collection(db, collectionName), where(fieldName, '==', value)));
      await Promise.all(snapshot.docs.map((entry) => deleteDocSafely(entry.ref)));
    };

    const collections = ['users', 'wallets', 'jobs', 'transactions', 'withdrawals', 'notifications', 'ratings', 'otps', 'kyc', 'kyc_submissions'];
    for (const collectionName of collections) {
      await deleteByIds(collectionName, candidateValues);
      for (const value of candidateValues) {
        for (const fieldName of USER_FIELDS_FOR_DELETION) {
          await deleteByField(collectionName, fieldName, value);
        }
      }
    }
  };

  const handleDeleteUser = async (userRow) => {
    const targetEmail = String(userRow.email || '').trim().toLowerCase();
    if (!targetEmail) return;

    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Permanently delete ${targetEmail}? This cannot be undone.`)
      : true;
    if (!confirmed) return;

    try {
      await removeRelatedFirestoreDocs(userRow);
      await apiPost(
        `${API_BASE_URL}/admin/delete-user`,
        { uid: userRow.uid, email: targetEmail },
        { requireAuth: true }
      );

      if (user?.email?.toLowerCase() === targetEmail) {
        await auth.signOut();
        router.replace('/auth');
        return;
      }

      Alert.alert('Success', `${targetEmail} has been deleted.`);
      if (selectedUser?.email?.toLowerCase() === targetEmail) {
        setSelectedUser(null);
        setSelectedWallet(null);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to delete user: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      router.replace('/auth');
    } catch (error) {
      Alert.alert('Error', `Failed to logout: ${error.message}`);
    }
  };

  const handleSendTestEmail = async () => {
    const testTo = String(emailTestTarget || process.env.SUPPORT_EMAIL || 'connecthub1000@gmail.com').trim().toLowerCase();
    if (!testTo) {
      setEmailTestResult({ type: 'error', message: 'Please enter an email address.' });
      return;
    }

    setEmailTestLoading(true);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/email-test`, { to: testTo }, { requireAuth: true });
      assertApiSuccess(response, data, 'Failed to send test email');
      setEmailTestResult({ type: 'success', message: `Test email sent to ${testTo}` });
    } catch (error) {
      setEmailTestResult({ type: 'error', message: String(error?.message || 'Failed to send test email') });
    } finally {
      setEmailTestLoading(false);
    }
  };

  const handleWithdrawalAction = async (row, action) => {
    try {
      const adminEmail = String(user?.email || 'bhounce1000@gmail.com').trim().toLowerCase();
      const withdrawalRef = doc(db, 'withdrawals', row.id);
      const reference = String(row.reference || row.id).trim();
      const amount = safeNumber(row.amount || row.netAmount || 0);
      const provider = String(row.provider || row.network || row.method || 'Mobile Money').trim();
      const phoneNumber = String(row.phoneNumber || row.phone || row.accountNumber || '').trim();
      const userEmail = String(row.email || row.userEmail || '').trim().toLowerCase();
      const reason = String(row.rejectionReason || row.reason || 'Rejected by admin desk').trim();

      if (action === 'approve') {
        await updateDoc(withdrawalRef, {
          status: 'completed',
          processedAt: new Date().toISOString(),
          processedBy: adminEmail,
        });

        const txSnap = await getDocs(query(collection(db, 'transactions'), where('reference', '==', reference)));
        await Promise.all(txSnap.docs.map((entry) => updateDoc(entry.ref, { status: 'completed', updatedAt: new Date().toISOString() })));

        await addDoc(collection(db, 'notifications'), {
          userId: userEmail,
          recipientId: userEmail,
          title: '✅ Withdrawal Successful!',
          body: `GHS ${amount.toFixed(2)} has been sent to your ${provider} account ending in ${phoneNumber ? String(phoneNumber).slice(-4) : '****'}. Check your MoMo wallet now.`,
          type: 'withdrawal_completed',
          read: false,
          createdAt: serverTimestamp(),
        });

        await apiPost(`${API_BASE_URL}/admin/notify-withdrawal-paid`, {
          email: userEmail,
          amount,
          provider,
          phoneNumber,
        }, { requireAuth: true });

        if (row.fraudFlagged === true) {
          await updateDoc(withdrawalRef, {
            fraudReviewed: true,
            fraudReviewedAt: new Date().toISOString(),
            fraudReviewedBy: adminEmail,
          });
        }
      } else {
        await updateDoc(withdrawalRef, {
          status: 'rejected',
          processedAt: new Date().toISOString(),
          processedBy: adminEmail,
        });

        await updateDoc(doc(db, 'users', userEmail), {
          walletBalance: increment(amount),
        });

        const txSnap = await getDocs(query(collection(db, 'transactions'), where('reference', '==', reference)));
        await Promise.all(txSnap.docs.map((entry) => updateDoc(entry.ref, { status: 'failed', updatedAt: new Date().toISOString() })));

        await addDoc(collection(db, 'notifications'), {
          userId: userEmail,
          recipientId: userEmail,
          title: '❌ Withdrawal Rejected',
          body: `Your withdrawal of GHS ${amount.toFixed(2)} was rejected. Reason: ${reason}. Your balance has been restored.`,
          type: 'withdrawal_rejected',
          read: false,
          createdAt: serverTimestamp(),
        });

        await apiPost(`${API_BASE_URL}/admin/notify-withdrawal-rejected`, {
          email: userEmail,
          amount,
          provider,
          phoneNumber,
          reason,
        }, { requireAuth: true });
      }

      Alert.alert('Success', `Withdrawal ${action === 'approve' ? 'marked as paid' : 'rejected'} successfully.`);
    } catch (error) {
      Alert.alert('Error', String(error?.message || `Could not ${action} withdrawal`));
    }
  };

  const handleKycAction = async (row, action) => {
    const userEmail = String(row.email || row.userEmail || row.id || '').trim().toLowerCase();
    if (!userEmail) {
      Alert.alert('Error', 'KYC record is missing email.');
      return;
    }

    try {
      const endpoint = action === 'approve'
        ? `/admin/kyc/${encodeURIComponent(userEmail)}/approve`
        : `/admin/kyc/${encodeURIComponent(userEmail)}/reject`;
      const payload = action === 'approve'
        ? {}
        : { reason: 'Document quality/identity mismatch' };
      const { response, data } = await apiPost(`${API_BASE_URL}${endpoint}`, payload, { requireAuth: true });
      assertApiSuccess(response, data, `Failed to ${action} KYC`);
      Alert.alert('Success', `KYC ${action === 'approve' ? 'approved' : 'rejected'} for ${userEmail}`);
    } catch (error) {
      Alert.alert('Error', String(error?.message || `Could not ${action} KYC`));
    }
  };

  const handleResolveDispute = async (row) => {
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/disputes/${encodeURIComponent(row.id)}/resolve`,
        { resolution: 'Resolved by admin desk' },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Failed to resolve dispute');
      Alert.alert('Success', 'Dispute resolved.');
    } catch (error) {
      Alert.alert('Error', String(error?.message || 'Could not resolve dispute'));
    }
  };

  const handleResolveFraud = async (row) => {
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/fraud-alerts/${encodeURIComponent(row.id)}/resolve`,
        {},
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Failed to resolve alert');

      const userEmail = String(row.user || row.userEmail || '').trim().toLowerCase();
      if (userEmail) {
        const userRef = doc(db, 'users', userEmail);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const previous = safeNumber(userSnap.data()?.fraudFlags);
          await updateDoc(userRef, { fraudFlags: Math.max(0, previous - 1), updatedAt: serverTimestamp() });
        }
      }

      Alert.alert('Success', 'Fraud alert resolved.');
    } catch (error) {
      Alert.alert('Error', String(error?.message || 'Could not resolve fraud alert'));
    }
  };

  const handleJobStatusUpdate = async (row, status) => {
    try {
      const updatePayload = { status, updatedAt: serverTimestamp() };
      if (status === 'completed') {
        updatePayload.completedAt = serverTimestamp();
      }
      await updateDoc(doc(db, 'requests', row.id), updatePayload);

      if (status === 'completed') {
        await addDoc(collection(db, 'notifications'), {
          user: row.user || '',
          userId: row.user || '',
          recipientId: row.user || '',
          title: 'Job Completed',
          message: `Your request \"${row.title || 'Service'}\" has been marked completed by admin.`,
          type: 'job_update',
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      Alert.alert('Success', `Job moved to ${status.replace('_', ' ')}.`);
    } catch (error) {
      Alert.alert('Error', String(error?.message || 'Could not update job status'));
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await setDoc(
        doc(db, 'adminSettings', 'global'),
        {
          supportEmail: String(adminSettings.supportEmail || '').trim().toLowerCase(),
          commissionRate: Number(adminSettings.commissionRate || 0.1),
          maintenanceMode: adminSettings.maintenanceMode === true,
          kycAutoNotify: adminSettings.kycAutoNotify !== false,
          updatedBy: String(user?.email || '').trim().toLowerCase(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      Alert.alert('Saved', 'Admin settings updated.');
    } catch (error) {
      Alert.alert('Error', String(error?.message || 'Failed to save settings'));
    } finally {
      setSavingSettings(false);
    }
  };

  if (!isAuthReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: ADMIN_BACKGROUND }}>
        <ActivityIndicator size="large" color={ADMIN_ACCENT} />
        <Text style={{ marginTop: 12, color: ADMIN_TEXT }}>Loading admin panel...</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: ADMIN_BACKGROUND, padding: 24 }}>
        <View style={{ backgroundColor: ADMIN_CARD_BG, padding: 24, borderRadius: 12, width: '100%', maxWidth: 420 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT }}>Access Denied</Text>
          <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 8, marginBottom: 18 }}>
            You do not have permission to access the Admin Desk.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={{ backgroundColor: ADMIN_ACCENT, borderRadius: 8, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700' }}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: ADMIN_BACKGROUND }}>
      {Platform.OS === 'web' && (
        <View style={{ width: 280, backgroundColor: ADMIN_SIDEBAR, paddingVertical: 24, paddingHorizontal: 16 }}>
          <View style={{ marginBottom: 28 }}>
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '800' }}>ConnectHub</Text>
            <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Admin Panel</Text>
          </View>

          {[
            { id: 'dashboard', label: '🏠 Dashboard' },
            { id: 'users', label: '👥 Users' },
            { id: 'jobs', label: '💼 Jobs' },
            { id: 'withdrawals', label: '💸 Withdrawals' },
            { id: 'kyc', label: '🪪 KYC Verification' },
            { id: 'disputes', label: '⚠️ Disputes' },
            { id: 'fraud', label: '🚨 Fraud Reports' },
            { id: 'settings', label: '⚙️ Settings' },
          ].map((item) => {
            const isActive = activeView === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setActiveView(item.id)}
                style={({ pressed }) => ({
                  backgroundColor: isActive ? ADMIN_ACCENT : 'transparent',
                  borderRadius: 8,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  marginBottom: 8,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ color: isActive ? ADMIN_SIDEBAR : '#cbd5e1', fontWeight: '700' }}>{item.label}</Text>
              </Pressable>
            );
          })}

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => ({
              marginTop: 16,
              backgroundColor: '#7c3aed',
              borderRadius: 8,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <Text style={{ color: '#ffffff', fontWeight: '800' }}>🚪 Logout</Text>
          </Pressable>
        </View>
      )}

      <ScrollView style={{ flex: 1, backgroundColor: ADMIN_BACKGROUND }} contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={{
            backgroundColor: ADMIN_CARD_BG,
            paddingHorizontal: 24,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: '#e2e8f0',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 28, marginRight: 14 }}>📊</Text>
            <View>
              <Text style={{ fontSize: 20, fontWeight: '800', color: ADMIN_TEXT }}>ConnectHub Admin</Text>
              <Text style={{ fontSize: 12, color: ADMIN_TEXT_LIGHT }}>System Dashboard</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={firstLetter(user?.email)} size={40} style={{ marginRight: 10 }} />
            <View style={{ marginRight: 14 }}>
              <Text style={{ fontSize: 12, color: ADMIN_TEXT_LIGHT }}>Logged in as</Text>
              <Text style={{ fontSize: 14, color: ADMIN_TEXT, fontWeight: '700' }}>{user?.email}</Text>
            </View>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => ({
                backgroundColor: '#fee2e2',
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ color: BADGE_RED, fontWeight: '800', fontSize: 12 }}>Logout</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ padding: 24 }}>
          {activeView === 'dashboard' && (
            <View>
              <Text style={{ fontSize: 24, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 20 }}>Dashboard</Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
                {statsCards.map((card) => {
                  let targetView = 'dashboard';
                  if (card.label.includes('Jobs')) targetView = 'jobs';
                  if (card.label.includes('KYC')) targetView = 'kyc';
                  if (card.label.includes('Disputes')) targetView = 'disputes';
                  if (card.label.includes('Withdrawals')) targetView = 'withdrawals';
                  if (card.label.includes('Fraud')) targetView = 'fraud';
                  if (card.label.includes('Users')) targetView = 'users';

                  return (
                    <View key={card.label} style={{ width: Platform.OS === 'web' ? '25%' : '50%', minWidth: 180 }}>
                      <Pressable onPress={() => setActiveView(targetView)}>
                        <StatCard {...card} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              <View
                style={{
                  flexDirection: Platform.OS === 'web' ? 'row' : 'column',
                  alignItems: 'stretch',
                  marginBottom: 20,
                }}
              >
                <View
                  style={{
                    flex: 1.25,
                    backgroundColor: ADMIN_CARD_BG,
                    borderRadius: 12,
                    padding: 20,
                    marginRight: Platform.OS === 'web' ? 16 : 0,
                    marginBottom: Platform.OS === 'web' ? 0 : 16,
                    shadowColor: '#000',
                    shadowOpacity: 0.06,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 2,
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 6 }}>
                    System Health Overview
                  </Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 18 }}>
                    Snapshot of user mix, verification coverage, and operational risk.
                  </Text>

                  <MetricRow
                    label="Providers on platform"
                    value={`${dashboardMetrics.providerCount} accounts`}
                    color={BADGE_BLUE}
                    percent={dashboardMetrics.providerPercent}
                    trackColor="#dbeafe"
                  />
                  <MetricRow
                    label="Customers on platform"
                    value={`${dashboardMetrics.customerCount} accounts`}
                    color={ADMIN_ACCENT}
                    percent={dashboardMetrics.customerPercent}
                    trackColor="#ccfbf1"
                  />
                  <MetricRow
                    label="KYC verified coverage"
                    value={`${dashboardMetrics.verifiedCount} verified`}
                    color={BADGE_GREEN}
                    percent={dashboardMetrics.verifiedPercent}
                    trackColor="#dcfce7"
                  />
                  <MetricRow
                    label="Operational risk load"
                    value={`${fraudPending + disputes + signupErrors} flagged items`}
                    color={BADGE_RED}
                    percent={dashboardMetrics.riskPercent}
                    trackColor="#fee2e2"
                  />
                </View>

                <View
                  style={{
                    flex: 1,
                    backgroundColor: '#0f172a',
                    borderRadius: 12,
                    padding: 20,
                    justifyContent: 'space-between',
                  }}
                >
                  <View>
                    <Text style={{ color: '#93c5fd', fontWeight: '700', fontSize: 12, letterSpacing: 0.8 }}>LIVE OPS</Text>
                    <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '900', marginTop: 6 }}>Admin Command Center</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 13, marginTop: 8, lineHeight: 20 }}>
                      Prioritize disputes, fraud reports, and KYC throughput before user support queues grow.
                    </Text>
                  </View>
                  <View style={{ marginTop: 18 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={{ color: '#cbd5e1', fontWeight: '700' }}>Banned accounts</Text>
                      <Text style={{ color: '#ffffff', fontWeight: '900' }}>{dashboardMetrics.bannedCount}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={{ color: '#cbd5e1', fontWeight: '700' }}>Pending reviews</Text>
                      <Text style={{ color: '#ffffff', fontWeight: '900' }}>{kycPending + withdrawalsPending}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: '#cbd5e1', fontWeight: '700' }}>Immediate risk alerts</Text>
                      <Text style={{ color: '#ffffff', fontWeight: '900' }}>{fraudPending + disputes}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                <InsightCard title="Verification backlog" value={kycPending} subtitle="Pending KYC cases" accent="#ca8a04" />
                <InsightCard title="Payment queue" value={withdrawalsPending} subtitle="Withdrawals awaiting action" accent="#ea580c" />
                <InsightCard title="Signup diagnostics" value={signupErrors} subtitle="Recent auth failures logged" accent="#dc2626" />
              </View>

              <View
                style={{
                  backgroundColor: ADMIN_CARD_BG,
                  borderRadius: 12,
                  padding: 20,
                  shadowColor: '#000',
                  shadowOpacity: 0.06,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 2,
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 16 }}>
                  📧 Email Health Check
                </Text>
                <TextInput
                  value={emailTestTarget}
                  onChangeText={setEmailTestTarget}
                  placeholder="Enter test email"
                  placeholderTextColor={ADMIN_TEXT_LIGHT}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    color: ADMIN_TEXT,
                    marginBottom: 12,
                  }}
                />
                <Pressable
                  onPress={handleSendTestEmail}
                  disabled={emailTestLoading}
                  style={({ pressed }) => ({
                    backgroundColor: ADMIN_ACCENT,
                    borderRadius: 8,
                    alignItems: 'center',
                    paddingVertical: 12,
                    opacity: emailTestLoading ? 0.7 : pressed ? 0.92 : 1,
                  })}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '800' }}>
                    {emailTestLoading ? 'Sending...' : 'Send Test Email'}
                  </Text>
                </Pressable>
                {emailTestResult && (
                  <View
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      backgroundColor: emailTestResult.type === 'success' ? '#f0fdf4' : '#fef2f2',
                      borderLeftWidth: 4,
                      borderLeftColor: emailTestResult.type === 'success' ? BADGE_GREEN : BADGE_RED,
                    }}
                  >
                    <Text style={{ color: emailTestResult.type === 'success' ? BADGE_GREEN : BADGE_RED, fontWeight: '700' }}>
                      {emailTestResult.message}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {activeView === 'users' && (
            <View>
              <Text style={{ fontSize: 24, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 20 }}>Users Management</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-users.csv', ['email', 'role', 'kycStatus', 'jobsPosted', 'jobsAccepted', 'walletBalance'], filteredUsers)}
                />
              </View>

              <View
                style={{
                  backgroundColor: ADMIN_CARD_BG,
                  borderRadius: 12,
                  padding: 20,
                  shadowColor: '#000',
                  shadowOpacity: 0.06,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 2,
                }}
              >
                <TextInput
                  value={searchTerm}
                  onChangeText={(value) => {
                    setSearchTerm(value);
                    setCurrentPage(0);
                  }}
                  placeholder="Search users by email, role, KYC status, or phone..."
                  placeholderTextColor={ADMIN_TEXT_LIGHT}
                  autoCapitalize="none"
                  style={{
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    color: ADMIN_TEXT,
                    marginBottom: 16,
                  }}
                />

                <View style={{ flexDirection: 'row', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Avatar</Text>
                  <Text style={{ flex: 2, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Email</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Role</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>KYC Status</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Jobs Posted</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Jobs Accepted</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: ADMIN_TEXT_LIGHT }}>Actions</Text>
                </View>

                {paginatedUsers.map((entry, index) => (
                  <View
                    key={entry.uid}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8fafc',
                      borderBottomWidth: 1,
                      borderBottomColor: '#f1f5f9',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Avatar name={entry.avatarInitial} size={32} />
                    </View>
                    <Text style={{ flex: 2, fontSize: 12, color: ADMIN_TEXT, fontWeight: '600' }}>
                      {entry.email || 'Not available'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Badge
                        label={normalizeRole(entry.role)}
                        bg={
                          normalizeRole(entry.role) === 'PROVIDER'
                            ? '#dcfce7'
                            : normalizeRole(entry.role) === 'BANNED'
                              ? '#fee2e2'
                              : '#dbeafe'
                        }
                        fg={
                          normalizeRole(entry.role) === 'PROVIDER'
                            ? '#16a34a'
                            : normalizeRole(entry.role) === 'BANNED'
                              ? '#dc2626'
                              : '#1d4ed8'
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Badge
                        label={entry.kycStatus}
                        bg={entry.kycStatus === 'VERIFIED' ? '#dcfce7' : '#fef3c7'}
                        fg={entry.kycStatus === 'VERIFIED' ? '#16a34a' : '#d97706'}
                      />
                    </View>
                    <Text style={{ flex: 1, fontSize: 12, color: ADMIN_TEXT, fontWeight: '600' }}>{entry.jobsPosted}</Text>
                    <Text style={{ flex: 1, fontSize: 12, color: ADMIN_TEXT, fontWeight: '600' }}>{entry.jobsAccepted}</Text>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      <ActionButton label="View" backgroundColor={ADMIN_ACCENT} onPress={() => handleViewUser(entry)} />
                      <ActionButton
                        label={entry.banned ? 'Unban' : 'Ban'}
                        backgroundColor="#f59e0b"
                        onPress={() => handleBanUser(entry)}
                      />
                      <ActionButton label="Delete" backgroundColor={BADGE_RED} onPress={() => handleDeleteUser(entry)} />
                    </View>
                  </View>
                ))}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
                  <Text style={{ fontSize: 12, color: ADMIN_TEXT_LIGHT }}>
                    Showing {filteredUsers.length === 0 ? 0 : currentPage * usersPerPage + 1} - {Math.min((currentPage + 1) * usersPerPage, filteredUsers.length)} of {filteredUsers.length}
                  </Text>
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable
                      onPress={() => setCurrentPage((value) => Math.max(0, value - 1))}
                      disabled={currentPage === 0}
                      style={({ pressed }) => ({
                        backgroundColor: currentPage === 0 ? '#e2e8f0' : ADMIN_ACCENT,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        marginRight: 8,
                        opacity: pressed || currentPage === 0 ? 0.9 : 1,
                      })}
                    >
                      <Text style={{ color: currentPage === 0 ? ADMIN_TEXT_LIGHT : '#ffffff', fontWeight: '700' }}>Previous</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setCurrentPage((value) => value + 1)}
                      disabled={(currentPage + 1) * usersPerPage >= filteredUsers.length}
                      style={({ pressed }) => ({
                        backgroundColor: (currentPage + 1) * usersPerPage >= filteredUsers.length ? '#e2e8f0' : ADMIN_ACCENT,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        opacity: pressed || (currentPage + 1) * usersPerPage >= filteredUsers.length ? 0.9 : 1,
                      })}
                    >
                      <Text style={{ color: (currentPage + 1) * usersPerPage >= filteredUsers.length ? ADMIN_TEXT_LIGHT : '#ffffff', fontWeight: '700' }}>Next</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          )}

          {['jobs', 'withdrawals', 'kyc', 'disputes', 'fraud'].includes(activeView) && (
            <View
              style={{
                backgroundColor: ADMIN_CARD_BG,
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
                shadowColor: '#000',
                shadowOpacity: 0.06,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <TextInput
                value={adminSearch}
                onChangeText={setAdminSearch}
                placeholder="Search records by email, status, id, or reference..."
                placeholderTextColor={ADMIN_TEXT_LIGHT}
                style={{
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: ADMIN_TEXT,
                }}
              />
            </View>
          )}

          {activeView === 'withdrawals' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 10 }}>Withdrawals</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-withdrawals.csv', ['id', 'email', 'amount', 'status', 'reference'], filteredWithdrawals)}
                />
              </View>
              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                Pending: {withdrawalsRows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length} | Completed: {withdrawalsRows.filter((row) => String(row.status || '').toLowerCase() === 'completed').length} | Rejected: {withdrawalsRows.filter((row) => String(row.status || '').toLowerCase() === 'rejected').length}
              </Text>
              {filteredWithdrawals.map((row) => (
                <View key={row.id} style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>{row.email || 'Unknown user'}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                    {formatMoney(row.amount)} • {String(row.status || 'unknown').toUpperCase()} • {formatDate(row.requestedAt)}
                  </Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>Ref: {row.reference || row.id}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <ActionButton label="Mark as Paid" backgroundColor={BADGE_GREEN} onPress={() => handleWithdrawalAction(row, 'approve')} />
                    <ActionButton label="Reject" backgroundColor={BADGE_RED} onPress={() => handleWithdrawalAction(row, 'reject')} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {activeView === 'kyc' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 10 }}>KYC Verification</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-kyc.csv', ['id', 'email', 'status', 'fullName'], filteredKycRows)}
                />
              </View>
              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                Pending: {kycRows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length} | Approved: {kycRows.filter((row) => ['approved', 'verified'].includes(String(row.status || '').toLowerCase())).length} | Rejected: {kycRows.filter((row) => String(row.status || '').toLowerCase() === 'rejected').length}
              </Text>
              {filteredKycRows.map((row) => {
                const photos = extractKycPhotos(row);
                const expanded = expandedKycId === row.id;

                return (
                  <View key={row.id} style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>{row.email || row.userEmail || row.id}</Text>
                        <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                          {String(row.status || 'pending').toUpperCase()} • {formatDate(row.submittedAt || row.createdAt)}
                        </Text>
                      </View>
                      <ActionButton
                        label={expanded ? 'Hide Details' : 'View Details'}
                        backgroundColor={ADMIN_ACCENT}
                        onPress={() => setExpandedKycId(expanded ? null : row.id)}
                      />
                    </View>

                    {expanded && photos.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
                        {photos.map((photoUrl) => (
                          <TouchableOpacity
                            key={photoUrl}
                            onPress={() => setFullscreenPhoto(photoUrl)}
                            style={{ marginRight: 10, marginBottom: 10 }}
                          >
                            <Image
                              source={{ uri: photoUrl }}
                              style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: '#e2e8f0' }}
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {expanded && photos.length === 0 && (
                      <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 12 }}>No photos attached to this submission.</Text>
                    )}

                    {expanded && (
                      <View style={{ flexDirection: 'row', marginTop: 10 }}>
                        <ActionButton label="Approve" backgroundColor={BADGE_GREEN} onPress={() => handleKycAction(row, 'approve')} />
                        <ActionButton label="Reject" backgroundColor={BADGE_RED} onPress={() => handleKycAction(row, 'reject')} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {activeView === 'disputes' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 10 }}>Disputes</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-disputes.csv', ['id', 'requestId', 'status', 'customerEmail', 'providerEmail', 'reason'], filteredDisputes)}
                />
              </View>
              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                Open: {disputeRows.filter((row) => !['resolved', 'closed'].includes(String(row.status || '').toLowerCase())).length} | Resolved: {disputeRows.filter((row) => ['resolved', 'closed'].includes(String(row.status || '').toLowerCase())).length}
              </Text>
              {filteredDisputes.map((row) => (
                <View key={row.id} style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>Request: {row.requestId || row.id}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                    {row.customerEmail || row.customer || 'Unknown customer'} vs {row.providerEmail || row.provider || 'Unknown provider'}
                  </Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>Reason: {row.reason || 'No reason provided'}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>Status: {String(row.status || 'open').toUpperCase()}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <ActionButton label="Resolve" backgroundColor={BADGE_GREEN} onPress={() => handleResolveDispute(row)} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {activeView === 'fraud' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 10 }}>Fraud Alerts</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-fraud.csv', ['id', 'userEmail', 'type', 'reason', 'resolved'], filteredFraudRows)}
                />
              </View>
              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                Open: {fraudRows.filter((row) => row.resolved !== true).length} | Resolved: {fraudRows.filter((row) => row.resolved === true).length}
              </Text>
              {filteredFraudRows.map((row) => (
                <View key={row.id} style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>{row.userEmail || row.user || 'Unknown user'}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                    Type: {row.type || 'behavior'} • Severity: {String(row.severity || 'medium').toUpperCase()}
                  </Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>Reason: {row.reason || 'No reason provided'}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>Status: {row.resolved ? 'RESOLVED' : 'OPEN'}</Text>
                  {!row.resolved && (
                    <View style={{ flexDirection: 'row', marginTop: 10 }}>
                      <ActionButton label="Mark Resolved" backgroundColor={BADGE_GREEN} onPress={() => handleResolveFraud(row)} />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {activeView === 'jobs' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 10 }}>Jobs</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
                <ActionButton
                  label="Export CSV"
                  backgroundColor={BADGE_BLUE}
                  onPress={() => exportCsv('connecthub-jobs.csv', ['id', 'title', 'status', 'user', 'acceptedBy', 'category', 'price'], filteredRequests)}
                />
              </View>
              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                Total: {requestRows.length} | Open: {requestRows.filter((row) => String(row.status || 'open').toLowerCase() === 'open').length} | In Progress: {requestRows.filter((row) => String(row.status || '').toLowerCase() === 'in_progress').length} | Completed: {requestRows.filter((row) => String(row.status || '').toLowerCase() === 'completed').length}
              </Text>
              {filteredRequests.map((row) => (
                <View key={row.id} style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>{row.title || 'Untitled Job'}</Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                    {row.user || 'Unknown customer'} • {row.acceptedBy || 'Unassigned'}
                  </Text>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, marginTop: 2 }}>
                    {String(row.status || 'open').toUpperCase()} • {formatMoney(row.price)} • {formatDate(row.createdAt)}
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <ActionButton label="Set In Progress" backgroundColor={BADGE_BLUE} onPress={() => handleJobStatusUpdate(row, 'in_progress')} />
                    <ActionButton label="Mark Completed" backgroundColor={BADGE_GREEN} onPress={() => handleJobStatusUpdate(row, 'completed')} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {activeView === 'settings' && (
            <View style={{ backgroundColor: ADMIN_CARD_BG, borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 12 }}>Settings</Text>

              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 6 }}>Support Email</Text>
              <TextInput
                value={adminSettings.supportEmail}
                onChangeText={(value) => setAdminSettings((prev) => ({ ...prev, supportEmail: value }))}
                autoCapitalize="none"
                style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: ADMIN_TEXT, marginBottom: 12 }}
              />

              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 6 }}>Commission Rate</Text>
              <TextInput
                value={adminSettings.commissionRate}
                onChangeText={(value) => setAdminSettings((prev) => ({ ...prev, commissionRate: value }))}
                keyboardType="numeric"
                style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: ADMIN_TEXT, marginBottom: 12 }}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>Maintenance Mode</Text>
                <Pressable
                  onPress={() => setAdminSettings((prev) => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
                  style={{ backgroundColor: adminSettings.maintenanceMode ? BADGE_GREEN : '#e2e8f0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: adminSettings.maintenanceMode ? '#fff' : ADMIN_TEXT, fontWeight: '800' }}>{adminSettings.maintenanceMode ? 'ON' : 'OFF'}</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>Auto-send KYC Notifications</Text>
                <Pressable
                  onPress={() => setAdminSettings((prev) => ({ ...prev, kycAutoNotify: !prev.kycAutoNotify }))}
                  style={{ backgroundColor: adminSettings.kycAutoNotify ? BADGE_GREEN : '#e2e8f0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: adminSettings.kycAutoNotify ? '#fff' : ADMIN_TEXT, fontWeight: '800' }}>{adminSettings.kycAutoNotify ? 'ON' : 'OFF'}</Text>
                </Pressable>
              </View>

              <Text style={{ color: ADMIN_TEXT_LIGHT, marginBottom: 12 }}>
                ADMIN LOGIN ACCOUNT — do not change this to support email: bhounce1000@gmail.com
              </Text>

              <Pressable
                onPress={handleSaveSettings}
                disabled={savingSettings}
                style={({ pressed }) => ({
                  backgroundColor: ADMIN_ACCENT,
                  borderRadius: 8,
                  alignItems: 'center',
                  paddingVertical: 12,
                  opacity: savingSettings ? 0.7 : pressed ? 0.92 : 1,
                })}
              >
                <Text style={{ color: '#ffffff', fontWeight: '800' }}>{savingSettings ? 'Saving...' : 'Save Settings'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={Boolean(selectedUser)} transparent animationType="fade" onRequestClose={() => setSelectedUser(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              maxWidth: 760,
              width: '100%',
              alignSelf: 'center',
              maxHeight: '90%',
              padding: 20,
            }}
          >
            <ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: ADMIN_TEXT }}>User Details</Text>
                <Pressable onPress={() => setSelectedUser(null)} style={{ padding: 8 }}>
                  <Text style={{ color: ADMIN_TEXT_LIGHT, fontWeight: '800' }}>Close</Text>
                </Pressable>
              </View>

              {selectedUserLoading ? (
                <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={ADMIN_ACCENT} />
                  <Text style={{ marginTop: 12, color: ADMIN_TEXT_LIGHT }}>Loading wallet details...</Text>
                </View>
              ) : selectedUser ? (
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                    <Avatar name={selectedUser.avatarInitial} size={48} style={{ marginRight: 14 }} />
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: ADMIN_TEXT }}>
                        {selectedUser.displayName || selectedUser.email}
                      </Text>
                      <Text style={{ color: ADMIN_TEXT_LIGHT }}>{selectedUser.email}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Phone Number</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{selectedUser.phoneNumber || 'Not available'}</Text>
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Role</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{normalizeRole(selectedUser.role)}</Text>
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>KYC Status</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{selectedUser.kycStatus}</Text>
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Wallet Balance</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>
                        {selectedWallet ? String(selectedWallet.balance ?? selectedWallet.availableBalance ?? selectedWallet.amount ?? 0) : '0'}
                      </Text>
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Jobs Posted</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{selectedUser.jobsPosted}</Text>
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Jobs Accepted</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{selectedUser.jobsAccepted}</Text>
                    </View>
                    <View style={{ width: '100%', paddingHorizontal: 8, marginBottom: 16 }}>
                      <Text style={{ color: ADMIN_TEXT_LIGHT, fontSize: 12, marginBottom: 4 }}>Account Created</Text>
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{formatDate(selectedUser.createdAt)}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                    <Pressable
                      onPress={() => handleBanUser(selectedUser)}
                      style={({ pressed }) => ({
                        backgroundColor: '#f59e0b',
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        marginRight: 10,
                        marginBottom: 10,
                        opacity: pressed ? 0.92 : 1,
                      })}
                    >
                      <Text style={{ color: '#ffffff', fontWeight: '800' }}>{selectedUser.banned ? 'Unban' : 'Ban'}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteUser(selectedUser)}
                      style={({ pressed }) => ({
                        backgroundColor: BADGE_RED,
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        marginRight: 10,
                        marginBottom: 10,
                        opacity: pressed ? 0.92 : 1,
                      })}
                    >
                      <Text style={{ color: '#ffffff', fontWeight: '800' }}>Delete</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSelectedUser(null)}
                      style={({ pressed }) => ({
                        backgroundColor: '#e2e8f0',
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        marginBottom: 10,
                        opacity: pressed ? 0.92 : 1,
                      })}
                    >
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '800' }}>Close</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(fullscreenPhoto)} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <TouchableOpacity
            onPress={() => setFullscreenPhoto(null)}
            style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }}
          >
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
          {fullscreenPhoto && (
            <Image
              source={{ uri: fullscreenPhoto }}
              style={{ width: '95%', height: '70%', borderRadius: 12 }}
              resizeMode="contain"
            />
          )}
          <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 13 }}>Tap ✕ to close</Text>
        </View>
      </Modal>
    </View>
  );
}
