import { useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
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
  if (!value) return 'N/A';
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toLocaleString();
    } catch {
      return 'N/A';
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
  const [emailTestTarget, setEmailTestTarget] = useState('');
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [emailTestLoading, setEmailTestLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);

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

    return onSnapshot(collection(db, 'jobs'), (snapshot) => {
      setJobs(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
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

    return onSnapshot(collection(db, 'disputes'), (snapshot) => {
      setDisputes(snapshot.size);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(query(collection(db, 'fraudAlerts'), where('resolved', '==', false)), (snapshot) => {
      setFraudPending(snapshot.size);
    });
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
    const to = String(emailTestTarget || '').trim().toLowerCase();
    if (!to) {
      setEmailTestResult({ type: 'error', message: 'Please enter an email address.' });
      return;
    }

    setEmailTestLoading(true);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/email-test`, { to }, { requireAuth: true });
      assertApiSuccess(response, data, 'Failed to send test email');
      setEmailTestResult({ type: 'success', message: `Test email sent to ${to}` });
    } catch (error) {
      setEmailTestResult({ type: 'error', message: String(error?.message || 'Failed to send test email') });
    } finally {
      setEmailTestLoading(false);
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
                {statsCards.map((card) => (
                  <View key={card.label} style={{ width: Platform.OS === 'web' ? '25%' : '50%', minWidth: 180 }}>
                    <StatCard {...card} />
                  </View>
                ))}
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
                      {entry.email || 'N/A'}
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

          {['jobs', 'withdrawals', 'kyc', 'disputes', 'fraud', 'settings'].includes(activeView) && (
            <View
              style={{
                backgroundColor: ADMIN_CARD_BG,
                borderRadius: 12,
                padding: 40,
                minHeight: 260,
                justifyContent: 'center',
                alignItems: 'center',
                shadowColor: '#000',
                shadowOpacity: 0.06,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: ADMIN_TEXT, marginBottom: 8 }}>
                {activeView.charAt(0).toUpperCase() + activeView.slice(1)} Management
              </Text>
              <Text style={{ color: ADMIN_TEXT_LIGHT, textAlign: 'center' }}>
                This section is intentionally reserved for the next admin iteration.
              </Text>
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
                      <Text style={{ color: ADMIN_TEXT, fontWeight: '700' }}>{selectedUser.phoneNumber || 'N/A'}</Text>
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
    </View>
  );
}
