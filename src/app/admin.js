import CryptoJS from 'crypto-js';
import { useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import ListScreen from '../components/ui/list-screen';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { KYC_STATUS, REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiDelete, apiGet, apiPost, assertApiSuccess } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

const KYC_ENCRYPTION_KEY = 'connecthub-kyc-2026';

function safeDecryptKycField(value) {
  if (!value) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(String(value), KYC_ENCRYPTION_KEY);
    const decoded = bytes.toString(CryptoJS.enc.Utf8);
    return decoded || String(value);
  } catch {
    return String(value);
  }
}

function formatIsoDate(iso) {
  if (!iso) return 'N/A';
  if (typeof iso?.toDate === 'function') {
    try {
      return iso.toDate().toLocaleString();
    } catch {
      // Fall through to other parsing paths.
    }
  }
  if (typeof iso === 'object' && typeof iso?.seconds === 'number') {
    return new Date(iso.seconds * 1000).toLocaleString();
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19);
  return d.toLocaleString();
}

function maskValue(value = '') {
  const str = String(value || '');
  if (str.length <= 4) return str;
  return `${str.slice(0, 3)}${'•'.repeat(Math.max(0, str.length - 6))}${str.slice(-3)}`;
}

// Safe string extractor — handles objects from country/phone pickers
function safeStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    // Handle country picker objects like {cca2: 'GH', callingCode: ['233']}
    if (val.name) return val.name;
    if (val.cca2) return val.cca2;
    if (val.callingCode) return Array.isArray(val.callingCode) ? '+' + val.callingCode[0] : val.callingCode;
    if (val.label) return val.label;
    if (val.value) return val.value;
    // Last resort: convert to readable string
    return JSON.stringify(val);
  }
  return String(val);
}

export default function Admin() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [requests, setRequests] = useState([]);
  const [kycSubmissions, setKycSubmissions] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [activeTab, setActiveTab] = useState('requests');
  const [withdrawalFilter, setWithdrawalFilter] = useState('pending');
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [emailTestTarget, setEmailTestTarget] = useState('');
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [providerProfileMap, setProviderProfileMap] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [expandedRequestMap, setExpandedRequestMap] = useState({});
  const currentEmail = user?.email || '';
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);

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
    if (!isAdmin) return undefined;

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

  useEffect(() => {
    if (!isAdmin) return undefined;

    const withdrawalQuery = query(collection(db, 'withdrawals'), orderBy('requestedAt', 'desc'));
    return onSnapshot(withdrawalQuery, (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setWithdrawals(rows);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    const providerEmails = Array.from(
      new Set(
        requests
          .map((item) => String(item.acceptedBy || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (providerEmails.length === 0) {
      setProviderProfileMap({});
      return;
    }

    (async () => {
      const pairs = await Promise.all(
        providerEmails.map(async (email) => {
          try {
            const snap = await getDoc(doc(db, 'users', email));
            return [email, snap.exists() ? (snap.data() || {}) : {}];
          } catch {
            return [email, {}];
          }
        })
      );

      const nextMap = {};
      pairs.forEach(([email, profile]) => {
        nextMap[email] = profile;
      });
      setProviderProfileMap(nextMap);
    })();
  }, [isAdmin, requests]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(collection(db, 'disputes'), (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setDisputes(rows);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    return onSnapshot(collection(db, 'kyc_submissions'), (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
      setKycSubmissions(rows);
    });
  }, [isAdmin]);

  const [usersProfileMap, setUsersProfileMap] = useState({});
  useEffect(() => {
    if (!isAdmin) return undefined;
    return onSnapshot(collection(db, 'users'), (snapshot) => {
      const map = {};
      snapshot.docs.forEach((d) => {
        const data = d.data() || {};
        map[d.id] = { banned: data.banned || false, subscriptionPlan: data.subscriptionPlan || 'free' };
      });
      setUsersProfileMap(map);
    });
  }, [isAdmin]);

  const setStatus = async (item, nextStatus) => {
    setPendingAction(`${item.id}:${nextStatus}`);
    setNotice(null);

    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/requests/${item.id}/moderate`,
        { status: nextStatus, note: 'Updated from admin screen' },
        { requireAuth: true }
      );
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
        title: 'Confirm cancellation',
        message: `Tap again to cancel "${item.title || item.id}". Record will remain for audit/history.`,
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
      assertApiSuccess(response, data, 'Cancel request failed');
      setNotice({
        tone: 'success',
        title: 'Request cancelled',
        message: `${item.title || item.id} was cancelled successfully.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Cancel failed',
        message: formatApiMessage({ message: error.message }, 'Could not cancel this request.'),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const reviewKyc = async (kyc, action, reason = '') => {
    const email = (kyc?.email || '').trim().toLowerCase();
    const displayName = kyc?.fullName || kyc?.displayName || email;
    const key = `kyc:${email}:${action}`;
    setPendingAction(key);
    setNotice(null);

    try {
      const endpoint = `${API_BASE_URL}/admin/kyc/${encodeURIComponent(email)}/${action}`;
      const payload = action === 'reject' ? { reason } : {};
      const { response, data } = await apiPost(endpoint, payload, { requireAuth: true });
      const apiData = assertApiSuccess(response, data, `KYC ${action} failed`);

      if (action === 'approve') {
        await addDoc(collection(db, 'notifications'), {
          userId: email,
          user: email,
          title: '✅ KYC Approved — Welcome to ConnectHub!',
          body: 'Congratulations! Your identity has been verified. You now have full access to ConnectHub. You can start posting jobs or offering services.',
          type: 'kyc_approved',
          read: false,
          createdAt: serverTimestamp(),
        });

        await apiPost(
          `${API_BASE_URL}/admin/kyc/notify-approved`,
          { email, displayName },
          { requireAuth: true }
        );
      } else {
        const rejectionReason = String(reason || '').trim();
        await addDoc(collection(db, 'notifications'), {
          userId: email,
          user: email,
          title: '❌ KYC Verification Failed',
          body: `Your KYC submission was not approved. Reason: ${rejectionReason}. Please review the reason and resubmit your details.`,
          type: 'kyc_rejected',
          rejectionReason,
          read: false,
          createdAt: serverTimestamp(),
        });

        await apiPost(
          `${API_BASE_URL}/admin/kyc/notify-rejected`,
          { email, displayName, reason: rejectionReason },
          { requireAuth: true }
        );
      }

      const delivery = apiData?.data?.delivery || {};
      const inAppStatus = delivery.inAppNotificationStored ? 'in-app: stored' : 'in-app: failed';
      const pushStatus = delivery.pushTokenFound
        ? (delivery.pushDelivered ? 'push: sent' : 'push: failed')
        : 'push: skipped (no token)';
      const emailConfigured = delivery.email?.configured;
      const emailStatus = !emailConfigured
        ? 'email: skipped (EMAIL_USER/EMAIL_PASS not set on backend)'
        : delivery.email?.sent
          ? 'email: sent'
          : 'email: failed';

      setNotice({
        tone: delivery.email?.sent || delivery.inAppNotificationStored ? 'success' : 'warning',
        title: action === 'approve' ? 'KYC approved' : 'KYC rejected',
        message: `${email} has been ${action === 'approve' ? 'verified' : 'rejected'}. ${inAppStatus}; ${pushStatus}; ${emailStatus}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: `KYC ${action} failed`,
        message: formatApiMessage({ message: error.message }, `Could not ${action} KYC for ${email}.`),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const resolveDispute = async ({ disputeId, resolution, splitPercentToWorker, note }) => {
    const key = `dispute:${disputeId}:${resolution}`;
    setPendingAction(key);
    setNotice(null);

    try {
      const payload = {
        resolution,
        note,
      };

      if (resolution === 'split') {
        payload.splitPercentToWorker = splitPercentToWorker;
      }

      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/disputes/${disputeId}/resolve`,
        payload,
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Dispute resolution failed');

      const providerPayout = Number(data?.data?.providerPayout || 0).toFixed(2);
      const customerRefund = Number(data?.data?.customerRefund || 0).toFixed(2);
      setNotice({
        tone: 'success',
        title: 'Dispute resolved',
        message: `Resolved as ${resolution}. Provider: GHS ${providerPayout}, Customer: GHS ${customerRefund}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Resolution failed',
        message: formatApiMessage({ message: error.message }, 'Could not resolve dispute.'),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const markWithdrawalPaid = async (withdrawal) => {
    const key = `withdrawal:${withdrawal.id}:paid`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/withdrawals/${withdrawal.id}/complete`,
        {},
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Could not mark withdrawal as paid');
      setNotice({
        tone: 'success',
        title: 'Withdrawal marked paid',
        message: `Marked ${withdrawal.reference} as paid successfully.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Action failed', message: error?.message || 'Could not mark withdrawal as paid.' });
    } finally {
      setPendingAction(null);
    }
  };

  const rejectWithdrawal = async (withdrawal, reason) => {
    const key = `withdrawal:${withdrawal.id}:reject`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/withdrawals/${withdrawal.id}/reject`,
        { reason: String(reason || '').trim() },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Could not reject withdrawal');
      setNotice({
        tone: 'success',
        title: 'Withdrawal rejected',
        message: `${withdrawal.reference} rejected and wallet restored.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Action failed', message: error?.message || 'Could not reject withdrawal.' });
    } finally {
      setPendingAction(null);
    }
  };

  const users = useMemo(() => {
    const map = new Map();

    requests.forEach((row) => {
      const customer = String(row.user || '').trim().toLowerCase();
      const provider = String(row.acceptedBy || '').trim().toLowerCase();

      if (customer) {
        const entry = map.get(customer) || { email: customer, role: 'customer', jobsPosted: 0, jobsAccepted: 0 };
        entry.jobsPosted += 1;
        map.set(customer, entry);
      }

      if (provider) {
        const entry = map.get(provider) || { email: provider, role: 'provider', jobsPosted: 0, jobsAccepted: 0 };
        entry.jobsAccepted += 1;
        entry.role = 'provider';
        map.set(provider, entry);
      }
    });

    kycSubmissions.forEach((row) => {
      const email = String(row.email || row.id || '').trim().toLowerCase();
      if (!email) return;
      const entry = map.get(email) || { email, role: 'customer', jobsPosted: 0, jobsAccepted: 0 };
      entry.kycStatus = row.kycStatus || 'not_submitted';
      map.set(email, entry);
    });

    // Merge ban + profile data
    Object.entries(usersProfileMap).forEach(([email, profile]) => {
      const entry = map.get(email) || { email, role: 'customer', jobsPosted: 0, jobsAccepted: 0 };
      entry.banned = profile.banned || false;
      entry.subscriptionPlan = profile.subscriptionPlan || 'free';
      map.set(email, entry);
    });

    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [kycSubmissions, requests, usersProfileMap]);

  const pendingWithdrawalCount = withdrawals.filter((w) => String(w.status || '') === 'pending_admin_approval').length;
  const filteredWithdrawals = useMemo(() => {
    if (withdrawalFilter === 'all') return withdrawals;
    if (withdrawalFilter === 'pending') return withdrawals.filter((w) => String(w.status || '') === 'pending_admin_approval');
    if (withdrawalFilter === 'completed') return withdrawals.filter((w) => String(w.status || '') === 'completed');
    if (withdrawalFilter === 'rejected') return withdrawals.filter((w) => String(w.status || '') === 'rejected');
    return withdrawals;
  }, [withdrawalFilter, withdrawals]);

  const sendEmailTest = async () => {
    const to = (emailTestTarget || currentEmail).trim().toLowerCase();
    if (!to) {
      setNotice({ tone: 'warning', title: 'Email required', message: 'Enter a destination email for the test.' });
      return;
    }
    setPendingAction('email:test');
    setNotice(null);
    setEmailTestResult(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/email-test`, { to }, { requireAuth: true });
      assertApiSuccess(response, data, 'Email test failed');
      setEmailTestResult({ ok: true, to });
      setNotice({ tone: 'success', title: 'Email test sent', message: `Test email sent to ${to}. Check your inbox.` });
    } catch (error) {
      const msg = error?.message || '';
      setEmailTestResult({ ok: false, error: msg });
      setNotice({ tone: 'error', title: 'Email test failed', message: msg || 'Could not send test email. Check backend SMTP config.' });
    } finally {
      setPendingAction(null);
    }
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const { response, data } = await apiGet(`${API_BASE_URL}/admin/analytics`, { requireAuth: true });
      if (response.ok && data?.status) setAnalytics(data.data);
    } catch {
      // silent
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const banUser = async (email) => {
    const key = `ban:${email}`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/users/${encodeURIComponent(email)}/ban`, { reason: 'Suspended by admin' }, { requireAuth: true });
      assertApiSuccess(response, data, 'Ban failed');
      setNotice({ tone: 'success', title: 'User banned', message: `${email} has been suspended.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Ban failed', message: error?.message || 'Could not ban user.' });
    } finally {
      setPendingAction(null);
    }
  };

  const confirmBanUser = (email) => {
    Alert.alert('Ban user?', `This will suspend ${email}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Ban User', style: 'destructive', onPress: () => banUser(email) },
    ]);
  };

  const confirmUnbanUser = (email) => {
    Alert.alert('Unban user?', `Restore access for ${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unban', onPress: () => unbanUser(email) },
    ]);
  };

  const requestStatusMeta = (status) => {
    if (status === REQUEST_STATUS.ACCEPTED) return { border: '#ea580c', bg: '#ffedd5', text: '#c2410c', label: 'Accepted' };
    if (status === REQUEST_STATUS.IN_PROGRESS) return { border: '#7c3aed', bg: '#ede9fe', text: '#5b21b6', label: 'In Progress' };
    if (status === REQUEST_STATUS.PENDING_CONFIRMATION) return { border: '#d97706', bg: '#fef3c7', text: '#b45309', label: 'Pending Confirmation' };
    if (status === REQUEST_STATUS.PAID || status === REQUEST_STATUS.COMPLETED) return { border: '#16a34a', bg: '#dcfce7', text: '#166534', label: 'Completed' };
    if (status === REQUEST_STATUS.CANCELLED) return { border: '#64748b', bg: '#f1f5f9', text: '#475569', label: 'Cancelled' };
    return { border: '#2563eb', bg: '#dbeafe', text: '#1d4ed8', label: 'Open' };
  };

  const unbanUser = async (email) => {
    const key = `unban:${email}`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/users/${encodeURIComponent(email)}/unban`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Unban failed');
      setNotice({ tone: 'success', title: 'User unbanned', message: `${email} has been reinstated.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Unban failed', message: error?.message || 'Could not unban user.' });
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

  const pendingKycCount = kycSubmissions.filter((k) => k.kycStatus === KYC_STATUS.PENDING_VERIFICATION).length;
  const openDisputeCount = disputes.filter((d) => (d.status || 'open') !== 'resolved').length;

  return (
    <ListScreen
      eyebrow="ADMIN DESK"
      title="Moderation"
      subtitle="Manage requests and verify user identities."
      accentColor="#111827"
      accentTextColor="#cbd5e1"
      toolbar={(
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Jobs</Text>
              <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 18 }}>{requests.length}</Text>
            </AppCard>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>KYC Pending</Text>
              <Text style={{ color: '#b45309', fontWeight: '800', fontSize: 18 }}>{pendingKycCount}</Text>
            </AppCard>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Disputes</Text>
              <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 18 }}>{openDisputeCount}</Text>
            </AppCard>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Withdrawals Pending</Text>
              <Text style={{ color: '#c2410c', fontWeight: '800', fontSize: 18 }}>{pendingWithdrawalCount}</Text>
            </AppCard>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
            <TouchableOpacity
              onPress={() => setActiveTab('requests')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'requests' ? '#6366f1' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'requests' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Requests ({requests.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab('kyc')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'kyc' ? '#6366f1' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'kyc' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                KYC ({pendingKycCount} pending)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab('disputes')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'disputes' ? '#dc2626' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'disputes' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Disputes ({openDisputeCount} open)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab('withdrawals')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'withdrawals' ? '#ea580c' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'withdrawals' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Withdrawals ({pendingWithdrawalCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab('users')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'users' ? '#2563eb' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'users' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Users ({users.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setActiveTab('analytics'); loadAnalytics(); }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'analytics' ? '#0f766e' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'analytics' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Analytics
              </Text>
            </TouchableOpacity>
          </View>

          <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} />
        </>
      )}
      hasItems={
        activeTab === 'requests'
          ? requests.length > 0
          : activeTab === 'kyc'
            ? kycSubmissions.length > 0
            : activeTab === 'disputes'
              ? disputes.length > 0
              : activeTab === 'withdrawals'
                ? filteredWithdrawals.length > 0
              : activeTab === 'analytics'
                ? true
                : users.length > 0
      }
      emptyTitle={
        activeTab === 'requests'
          ? 'No requests found'
          : activeTab === 'kyc'
            ? 'No KYC submissions'
            : activeTab === 'disputes'
              ? 'No disputes'
              : activeTab === 'withdrawals'
                ? 'No withdrawals found'
              : activeTab === 'analytics'
                ? 'Loading…'
                : 'No users found'
      }
      emptyDescription={
        activeTab === 'requests'
          ? 'Requests will appear here once they are created.'
          : activeTab === 'kyc'
            ? 'KYC submissions will appear here.'
            : activeTab === 'disputes'
              ? 'Disputes opened by customers will appear here.'
              : activeTab === 'withdrawals'
                ? 'Withdrawal requests will appear here.'
              : activeTab === 'analytics'
                ? 'Fetching analytics data…'
                : 'Users will appear here once activity is detected.'
      }
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {activeTab === 'analytics'
          ? (
            <View>
              {analyticsLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                  <Text style={{ color: AppColors.ink500 }}>Loading analytics…</Text>
                </View>
              ) : analytics ? (
                <>
                  <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>📊 Platform Overview</Text>

                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Total Jobs</Text>
                      <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 20 }}>{analytics.jobs?.total ?? '—'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Paid Jobs</Text>
                      <Text style={{ color: '#166534', fontWeight: '800', fontSize: 20 }}>{analytics.jobs?.paid ?? '—'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Disputed</Text>
                      <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 20 }}>{analytics.jobs?.disputed ?? '—'}</Text>
                    </AppCard>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Commission</Text>
                      <Text style={{ color: '#0f766e', fontWeight: '800', fontSize: 18 }}>GHS {analytics.revenue?.commissionEarned ?? '0'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Sub MRR</Text>
                      <Text style={{ color: '#7c3aed', fontWeight: '800', fontSize: 18 }}>GHS {analytics.revenue?.subscriptionMRR ?? '0'}</Text>
                    </AppCard>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Escrow Held</Text>
                      <Text style={{ color: '#b45309', fontWeight: '800', fontSize: 18 }}>GHS {analytics.revenue?.escrowHeld ?? '0'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Tx Volume</Text>
                      <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 18 }}>GHS {analytics.revenue?.transactionVolume ?? '0'}</Text>
                    </AppCard>
                  </View>

                  <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 16, marginBottom: 10, marginTop: 8 }}>👥 Users</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Total Users</Text>
                      <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 20 }}>{analytics.users?.total ?? '—'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Verified KYC</Text>
                      <Text style={{ color: '#166534', fontWeight: '800', fontSize: 20 }}>{analytics.users?.verified ?? '—'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Banned</Text>
                      <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 20 }}>{analytics.users?.banned ?? '—'}</Text>
                    </AppCard>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Pro Subs</Text>
                      <Text style={{ color: '#2563eb', fontWeight: '800', fontSize: 20 }}>{analytics.users?.proSubscribers ?? '—'}</Text>
                    </AppCard>
                    <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
                      <Text style={{ color: AppColors.ink500, fontSize: 11 }}>Premium Subs</Text>
                      <Text style={{ color: '#d97706', fontWeight: '800', fontSize: 20 }}>{analytics.users?.premiumSubscribers ?? '—'}</Text>
                    </AppCard>
                  </View>
                  <AppButton label="Refresh Analytics" variant="neutral" onPress={loadAnalytics} loading={analyticsLoading} />
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                  <Text style={{ color: AppColors.ink500, marginBottom: 12 }}>Could not load analytics.</Text>
                  <AppButton label="Retry" variant="neutral" onPress={loadAnalytics} />
                </View>
              )}
            </View>
          )
          : activeTab === 'kyc'
          ? kycSubmissions.map((item) => (
              <KycReviewCard
                key={item.id}
                item={item}
                pendingAction={pendingAction}
                onApprove={() => reviewKyc(item, 'approve')}
                onReject={(reason) => reviewKyc(item, 'reject', reason)}
              />
            ))
          : activeTab === 'disputes'
            ? disputes.map((item) => (
                <DisputeReviewCard
                  key={item.id}
                  item={item}
                  pendingAction={pendingAction}
                  onResolve={resolveDispute}
                />
              ))
            : activeTab === 'withdrawals'
              ? (
                <>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    {[
                      ['all', 'All'],
                      ['pending', 'Pending'],
                      ['completed', 'Completed'],
                      ['rejected', 'Rejected'],
                    ].map(([value, label]) => {
                      const selected = withdrawalFilter === value;
                      return (
                        <TouchableOpacity
                          key={value}
                          onPress={() => setWithdrawalFilter(value)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: selected ? '#fb923c' : '#334155',
                            backgroundColor: selected ? '#fff7ed' : '#0f172a',
                          }}
                        >
                          <Text style={{ color: selected ? '#c2410c' : '#cbd5e1', fontWeight: '700' }}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {filteredWithdrawals.map((item) => (
                    <WithdrawalReviewCard
                      key={item.id}
                      item={item}
                      pendingAction={pendingAction}
                      onMarkPaid={markWithdrawalPaid}
                      onReject={rejectWithdrawal}
                    />
                  ))}
                </>
              )
            : activeTab === 'users'
              ? (
                <>
                {users.map((entry) => (
                  <AppCard key={entry.email} style={{ marginBottom: 10, borderWidth: entry.banned ? 1 : 0, borderColor: entry.banned ? '#fca5a5' : 'transparent' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <Avatar email={entry.email} size={30} />
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: AppColors.ink900, fontWeight: '700' }}>{entry.email}</Text>
                          {entry.banned ? (
                            <View style={{ backgroundColor: '#fee2e2', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: '#b91c1c', fontSize: 10, fontWeight: '800' }}>BANNED</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          <View style={{ backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: '#1d4ed8', fontSize: 11, fontWeight: '800' }}>{String(entry.role || 'customer').toUpperCase()}</Text>
                          </View>
                          <View style={{ backgroundColor: entry.kycStatus === KYC_STATUS.VERIFIED ? '#dcfce7' : entry.kycStatus === KYC_STATUS.PENDING_VERIFICATION ? '#fef3c7' : '#fee2e2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: entry.kycStatus === KYC_STATUS.VERIFIED ? '#166534' : entry.kycStatus === KYC_STATUS.PENDING_VERIFICATION ? '#92400e' : '#b91c1c', fontSize: 11, fontWeight: '800' }}>
                              {entry.kycStatus === KYC_STATUS.VERIFIED ? 'KYC VERIFIED' : entry.kycStatus === KYC_STATUS.PENDING_VERIFICATION ? 'KYC PENDING' : 'KYC UNVERIFIED'}
                            </Text>
                          </View>
                          <SubscriptionBadge plan={entry.subscriptionPlan || 'free'} />
                        </View>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <View style={{ backgroundColor: '#eff6ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Text style={{ color: '#1d4ed8', fontWeight: '700', fontSize: 12 }}>Posted: {entry.jobsPosted}</Text>
                      </View>
                      <View style={{ backgroundColor: '#ecfdf5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Text style={{ color: '#166534', fontWeight: '700', fontSize: 12 }}>Accepted: {entry.jobsAccepted}</Text>
                      </View>
                    </View>
                    {entry.banned ? (
                      <AppButton
                        label="Unban User"
                        onPress={() => confirmUnbanUser(entry.email)}
                        disabled={Boolean(pendingAction)}
                        loading={pendingAction === `unban:${entry.email}`}
                        style={{ paddingVertical: 8, backgroundColor: '#166534' }}
                      />
                    ) : (
                      <AppButton
                        label="Ban User"
                        variant="danger"
                        onPress={() => confirmBanUser(entry.email)}
                        disabled={Boolean(pendingAction) || isAdminEmail(entry.email)}
                        loading={pendingAction === `ban:${entry.email}`}
                        style={{ paddingVertical: 8, backgroundColor: '#b91c1c' }}
                      />
                    )}
                  </AppCard>
                ))}

                <AppCard style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Email Health Check</Text>
                  <Text style={{ color: AppColors.ink500, marginBottom: 12, fontSize: 13 }}>
                    Verify that the backend SMTP config is working. Sends a real test email.
                  </Text>

                  <AppInput
                    label="Send test email to"
                    placeholder={currentEmail || 'your@email.com'}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={emailTestTarget}
                    onChangeText={setEmailTestTarget}
                  />

                  <AppButton
                    label={pendingAction === 'email:test' ? 'Sending…' : 'Send Test Email'}
                    onPress={sendEmailTest}
                    loading={pendingAction === 'email:test'}
                    disabled={Boolean(pendingAction)}
                    style={{ backgroundColor: '#0891b2', marginTop: 4 }}
                  />

                  {emailTestResult ? (
                    <View style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: AppRadius.md,
                      borderWidth: 1,
                      borderColor: emailTestResult.ok ? '#22c55e' : '#f87171',
                      backgroundColor: emailTestResult.ok ? '#052e16' : '#450a0a',
                    }}>
                      <Text style={{ color: emailTestResult.ok ? '#4ade80' : '#fca5a5', fontWeight: '700' }}>
                        {emailTestResult.ok ? `✅ Sent to ${emailTestResult.to}` : '❌ Delivery failed'}
                      </Text>
                      {emailTestResult.error ? (
                        <Text style={{ color: '#fca5a5', fontSize: 12, marginTop: 4 }}>{emailTestResult.error}</Text>
                      ) : null}
                      {!emailTestResult.ok && (
                        <Text style={{ color: '#fca5a5', fontSize: 12, marginTop: 6 }}>
                          Fix: set EMAIL_USER and EMAIL_PASS in your Render environment variables, then redeploy.
                        </Text>
                      )}
                    </View>
                  ) : null}
                </AppCard>
                </>
                )
          : requests.map((item) => (
              <AppCard key={item.id} style={{ marginBottom: 12, borderLeftWidth: 4, borderLeftColor: requestStatusMeta(item.status || REQUEST_STATUS.OPEN).border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <Text style={{ fontWeight: '700', flex: 1 }}>{item.title || item.id}</Text>
                  <View style={{ gap: 6, alignItems: 'flex-end' }}>
                    <View style={{ backgroundColor: requestStatusMeta(item.status || REQUEST_STATUS.OPEN).bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: requestStatusMeta(item.status || REQUEST_STATUS.OPEN).text, fontWeight: '800', fontSize: 11 }}>{requestStatusMeta(item.status || REQUEST_STATUS.OPEN).label}</Text>
                    </View>
                    <View style={{ backgroundColor: item.paid ? '#dcfce7' : '#fee2e2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: item.paid ? '#166534' : '#b91c1c', fontWeight: '800', fontSize: 11 }}>{item.paid ? 'PAID ✅' : 'UNPAID ❌'}</Text>
                    </View>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 8 }}>
                  <Avatar email={item.user} size={26} />
                  <Text style={{ marginHorizontal: 8, color: '#94a3b8', fontWeight: '700' }}>→</Text>
                  <Avatar email={item.acceptedBy} size={26} />
                  <Text style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }} numberOfLines={1}>{item.user || 'Customer'} → {item.acceptedBy || 'Unassigned'}</Text>
                </View>

                <TouchableOpacity
                  onPress={() => setExpandedRequestMap((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  style={{ marginBottom: 8, backgroundColor: '#f8fafc', borderRadius: AppRadius.sm, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 8 }}
                >
                  <Text style={{ color: '#334155', fontWeight: '700' }}>{expandedRequestMap[item.id] ? 'Hide Details' : 'View Details'}</Text>
                </TouchableOpacity>

                {expandedRequestMap[item.id] ? (
                  <View style={{ marginBottom: 8 }}>
                    <Text>ID: {item.id}</Text>
                    <Text>User: {item.user || 'Unavailable'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text>Provider: {item.acceptedBy || 'Unassigned'}</Text>
                      {item.acceptedBy ? (
                        <SubscriptionBadge
                          plan={providerProfileMap[String(item.acceptedBy || '').trim().toLowerCase()]?.subscriptionPlan}
                        />
                      ) : null}
                    </View>
                    <Text>Status: {STATUS_LABELS[item.status] || item.status || 'Open'}</Text>
                    <Text>Paid: {item.paid ? 'Yes' : 'No'}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <AppButton label="View Details" variant="neutral" onPress={() => router.push({ pathname: '/job-details', params: { id: item.id } })} style={{ flex: 1, paddingVertical: 8 }} />
                  <AppButton label="Force Complete" onPress={() => setStatus(item, REQUEST_STATUS.COMPLETED)} style={{ flex: 1, paddingVertical: 8, backgroundColor: '#0f766e' }} />
                </View>

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
                    label="Need Confirm"
                    onPress={() => setStatus(item, REQUEST_STATUS.PENDING_CONFIRMATION)}
                    disabled={Boolean(pendingAction)}
                    loading={pendingAction === `${item.id}:${REQUEST_STATUS.PENDING_CONFIRMATION}`}
                    style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#ca8a04' }}
                  />

                  <AppButton
                    label="Dispute"
                    variant="danger"
                    onPress={() => setStatus(item, REQUEST_STATUS.DISPUTED)}
                    disabled={Boolean(pendingAction)}
                    loading={pendingAction === `${item.id}:${REQUEST_STATUS.DISPUTED}`}
                    style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#b91c1c' }}
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
                    label={confirmDeleteId === item.id ? 'Tap Again To Cancel' : 'Cancel'}
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

function DisputeReviewCard({ item, pendingAction, onResolve }) {
  const [note, setNote] = useState('');
  const [splitPercentToWorker, setSplitPercentToWorker] = useState('50');
  const isResolved = item.status === 'resolved';

  const runResolve = (resolution) => {
    onResolve({
      disputeId: item.id,
      resolution,
      note: note.trim(),
      splitPercentToWorker: Number(splitPercentToWorker),
    });
  };

  return (
    <AppCard style={{ marginBottom: 12, borderColor: '#fecaca', borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <Text style={{ fontWeight: '700', flex: 1 }}>{item.title || item.requestId || item.id}</Text>
        <View style={{ backgroundColor: isResolved ? '#15803d' : '#b91c1c', paddingHorizontal: 8, paddingVertical: 3, borderRadius: AppRadius.sm }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{isResolved ? 'Resolved' : 'Open'}</Text>
        </View>
      </View>

      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Request: {item.requestId || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Customer: {item.customerEmail || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Provider: {item.providerEmail || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink900, fontSize: 13, marginTop: 4, fontWeight: '700' }}>Customer Complaint</Text>
      <Text style={{ color: AppColors.ink700, fontSize: 13 }}>{item.reason || 'No reason provided'}</Text>
      {item.comment ? <Text style={{ color: AppColors.ink500, fontSize: 13, marginTop: 4 }}>Comment: {item.comment}</Text> : null}
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 6 }}>Evidence files: {Array.isArray(item.evidenceUrls) ? item.evidenceUrls.length : 0}</Text>
      {Array.isArray(item.evidenceUrls) && item.evidenceUrls.length > 0 ? (
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {item.evidenceUrls.slice(0, 6).map((url, index) => (
            <AppButton
              key={`${item.id}:evidence:${index}`}
              label={`Open Evidence ${index + 1}`}
              onPress={() => Linking.openURL(url)}
              style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#1d4ed8' }}
            />
          ))}
        </View>
      ) : null}

      {isResolved ? (
        <View style={{ marginTop: AppSpace.sm }}>
          <Text style={{ color: '#166534', fontWeight: '700' }}>Resolution: {item.resolution || 'N/A'}</Text>
          <Text style={{ color: AppColors.ink500, marginTop: 2 }}>
            Provider payout: GHS {Number(item.providerPayout || 0).toFixed(2)} | Customer refund: GHS {Number(item.customerRefund || 0).toFixed(2)}
          </Text>
          {item.resolutionNote ? <Text style={{ color: AppColors.ink500, marginTop: 2 }}>Note: {item.resolutionNote}</Text> : null}
        </View>
      ) : (
        <View style={{ marginTop: AppSpace.sm }}>
          <AppInput
            label="Admin note (optional)"
            placeholder="Add your reasoning for audit trail"
            value={note}
            onChangeText={setNote}
            multiline
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: AppColors.ink700, marginRight: 8 }}>Split % to worker:</Text>
            <TextInput
              value={splitPercentToWorker}
              onChangeText={setSplitPercentToWorker}
              keyboardType="numeric"
              style={{
                minWidth: 72,
                borderWidth: 1,
                borderColor: '#cbd5e1',
                borderRadius: AppRadius.sm,
                paddingHorizontal: 10,
                paddingVertical: 8,
                color: AppColors.ink900,
              }}
            />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <AppButton
              label="Release to Provider"
              onPress={() => runResolve('release_to_worker')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:release_to_worker`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#15803d' }}
            />
            <AppButton
              label="Refund Customer"
              onPress={() => runResolve('refund_customer')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:refund_customer`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#2563eb' }}
            />
            <AppButton
              label="Split 50/50"
              onPress={() => runResolve('split')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:split`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#ea580c' }}
            />
          </View>
        </View>
      )}
    </AppCard>
  );
}

function WithdrawalReviewCard({ item, pendingAction, onMarkPaid, onReject }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const status = String(item.status || 'pending_admin_approval');
  const isPending = status === 'pending_admin_approval';
  const statusMeta = status === 'completed'
    ? { bg: '#dcfce7', text: '#166534', label: 'Paid ✅' }
    : status === 'rejected'
      ? { bg: '#fee2e2', text: '#b91c1c', label: 'Rejected' }
      : { bg: '#ffedd5', text: '#c2410c', label: 'Pending' };

  const askMarkPaid = () => {
    Alert.alert(
      'Confirm manual payout',
      `Confirm you have sent GHS ${Number(item.amount || 0).toFixed(2)} to ${item.phoneNumber}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark as Paid', onPress: () => onMarkPaid(item) },
      ]
    );
  };

  return (
    <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fed7aa' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{item.email || 'Unknown user'}</Text>
          <Text style={{ color: '#16a34a', fontWeight: '900', marginTop: 3 }}>GHS {Number(item.amount || 0).toFixed(2)}</Text>
        </View>
        <View style={{ backgroundColor: statusMeta.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: statusMeta.text, fontWeight: '800', fontSize: 11 }}>{statusMeta.label}</Text>
        </View>
      </View>

      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>{item.provider || 'Network'} • {item.phoneNumber || 'No number'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Account: {item.accountName || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Reference: {item.reference || item.id}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Requested: {formatIsoDate(item.requestedAt || item.createdAt)}</Text>

      {isPending ? (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AppButton
              label="Mark as Paid"
              onPress={askMarkPaid}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `withdrawal:${item.id}:paid`}
              style={{ flex: 1, backgroundColor: '#15803d', paddingVertical: 9 }}
            />
            <AppButton
              label={showRejectReason ? 'Cancel Reject' : 'Reject'}
              variant="danger"
              onPress={() => setShowRejectReason((v) => !v)}
              disabled={Boolean(pendingAction)}
              style={{ flex: 1, backgroundColor: '#b91c1c', paddingVertical: 9 }}
            />
          </View>

          {showRejectReason ? (
            <View style={{ marginTop: 8 }}>
              <AppInput
                label="Rejection reason"
                placeholder="Provide reason to user"
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
              />
              <AppButton
                label="Confirm Rejection"
                variant="danger"
                onPress={() => onReject(item, rejectReason)}
                disabled={!rejectReason.trim() || Boolean(pendingAction)}
                loading={pendingAction === `withdrawal:${item.id}:reject`}
                style={{ backgroundColor: '#7f1d1d' }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </AppCard>
  );
}

function KycReviewCard({ item, pendingAction, onApprove, onReject }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const bankName = safeDecryptKycField(item.bankName);
  const bankAccountName = safeDecryptKycField(item.bankAccountName);
  const bankBranch = safeDecryptKycField(item.bankBranch);
  const momoName = safeDecryptKycField(item.momoName);
  const idNumber = safeDecryptKycField(item.idNumber || '');
  const dateOfBirth = item.dob || item.dateOfBirth || '';
  const residentialAddress = item.homeAddress || item.residentialAddress || '';
  const countryOfResidence = item.countryOfResidence || '';
  const city = item.city || '';
  const canTakeAction = item.kycStatus === KYC_STATUS.PENDING_VERIFICATION && expanded && reviewConfirmed;

  const kycBadgeColor =
    item.kycStatus === KYC_STATUS.VERIFIED
      ? '#16a34a'
      : item.kycStatus === KYC_STATUS.REJECTED
        ? '#b91c1c'
        : '#d97706';

  return (
    <AppCard style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <Text style={{ fontWeight: '700', flex: 1 }}>{safeStr(item.fullName) || item.email}</Text>
        <View style={{ backgroundColor: kycBadgeColor, paddingHorizontal: 8, paddingVertical: 3, borderRadius: AppRadius.sm }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
            {item.kycStatus === KYC_STATUS.VERIFIED
              ? 'Verified'
              : item.kycStatus === KYC_STATUS.REJECTED
                ? 'Rejected'
                : 'Pending'}
          </Text>
        </View>
      </View>

      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Email: {item.email}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Phone: {safeStr(item.phone) || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Alt Phone: {safeStr(item.alternatePhone || item.altPhone) || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>ID Type: {safeStr(item.idType) || 'N/A'} - {idNumber || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Status: {safeStr(item.kycStatus) || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>
        Payment: {item.paymentMethod === 'bank' ? `Bank - ${bankName || 'N/A'}` : `MoMo - ${safeStr(item.momoProvider) || 'N/A'}`}
      </Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 4 }}>
        Submitted: {formatIsoDate(item.submittedAt)}
      </Text>

      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        style={{
          marginTop: 10,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: AppRadius.md,
          borderWidth: 1,
          borderColor: '#334155',
          backgroundColor: '#0f172a',
        }}
      >
        <Text style={{ color: '#cbd5e1', fontWeight: '700' }}>
          {expanded ? 'Hide full KYC details' : 'Review full KYC details'}
        </Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={{ marginTop: 10, borderWidth: 1, borderColor: '#1e293b', borderRadius: AppRadius.md, padding: 10, backgroundColor: '#020617' }}>
          <Text style={{ color: '#a5b4fc', fontWeight: '700', marginBottom: 8 }}>Identity Details</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Full Name: {safeStr(item.fullName) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Date of Birth: {safeStr(dateOfBirth) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Gender: {safeStr(item.gender) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Marital Status: {safeStr(item.maritalStatus) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Nationality: {safeStr(item.nationality) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Country of Residence: {safeStr(countryOfResidence) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>City: {safeStr(city) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Occupation: {safeStr(item.occupation) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Residential Address: {safeStr(residentialAddress) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>ID Type: {safeStr(item.idType) || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>ID Number: {idNumber || 'N/A'}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>KYC Status: {safeStr(item.kycStatus) || 'N/A'}</Text>

          <Text style={{ color: '#a5b4fc', fontWeight: '700', marginTop: 8, marginBottom: 8 }}>Payment Details</Text>
          {item.paymentMethod === 'bank' ? (
            <>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Method: Bank Account</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Stored Method Value: {safeStr(item.paymentMethod) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Bank: {safeStr(bankName) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Account Name: {safeStr(bankAccountName) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Account Number (raw): {safeStr(item.bankAccountNumber) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Account Number: {maskValue(item.bankAccountNumberMasked || '') || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Branch Code: {safeStr(item.branchCode) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Branch: {safeStr(bankBranch) || 'N/A'}</Text>
            </>
          ) : (
            <>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Method: Mobile Money</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Stored Method Value: {safeStr(item.paymentMethod) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Provider: {safeStr(item.momoProvider) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Number (raw): {safeStr(item.momoNumber) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Account Name: {safeStr(momoName) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Account Name (raw): {safeStr(item.momoAccountName || item.momoName) || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Number: {maskValue(item.momoNumberMasked || '') || 'N/A'}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 3 }}>Country: {safeStr(item.momoCountry) || 'N/A'}</Text>
            </>
          )}

          <Text style={{ color: '#a5b4fc', fontWeight: '700', marginTop: 8, marginBottom: 8 }}>Document Links</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {item.idFrontUrl ? (
              <AppButton
                label="Open ID Front"
                onPress={() => Linking.openURL(item.idFrontUrl)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1d4ed8' }}
              />
            ) : null}
            {item.idBackUrl ? (
              <AppButton
                label="Open ID Back"
                onPress={() => Linking.openURL(item.idBackUrl)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1d4ed8' }}
              />
            ) : null}
          </View>

          {item.kycStatus === KYC_STATUS.PENDING_VERIFICATION ? (
            <TouchableOpacity
              onPress={() => setReviewConfirmed((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: reviewConfirmed ? '#22c55e' : '#64748b',
                  backgroundColor: reviewConfirmed ? '#22c55e' : 'transparent',
                  marginRight: 8,
                }}
              />
              <Text style={{ color: '#cbd5e1', fontSize: 13 }}>
                I have reviewed all KYC details and documents for this user.
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Document Photos */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10, marginBottom: 6 }}>
        {item.idFrontUrl ? (
          <View style={{ alignItems: 'center' }}>
            <Image source={{ uri: item.idFrontUrl }} style={{ width: 80, height: 56, borderRadius: 6, borderWidth: 1, borderColor: '#6366f1' }} />
            <Text style={{ color: AppColors.ink500, fontSize: 11, marginTop: 2 }}>Front</Text>
          </View>
        ) : null}
        {item.idBackUrl ? (
          <View style={{ alignItems: 'center' }}>
            <Image source={{ uri: item.idBackUrl }} style={{ width: 80, height: 56, borderRadius: 6, borderWidth: 1, borderColor: '#6366f1' }} />
            <Text style={{ color: AppColors.ink500, fontSize: 11, marginTop: 2 }}>Back</Text>
          </View>
        ) : null}
      </View>

      {item.kycStatus === KYC_STATUS.PENDING_VERIFICATION && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: AppSpace.sm, gap: 8 }}>
          <AppButton
            label={pendingAction === `kyc:${item.email}:approve` ? 'Approving...' : 'Approve'}
            onPress={() => Alert.alert('Approve KYC?', `Approve KYC for ${item.email}?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Approve', onPress: onApprove },
            ])}
            disabled={Boolean(pendingAction) || !canTakeAction}
            style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#15803d' }}
          />
          <AppButton
            label={showRejectForm ? 'Cancel Reject' : 'Reject'}
            onPress={() => setShowRejectForm((v) => !v)}
            disabled={Boolean(pendingAction) || !canTakeAction}
            style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#b91c1c' }}
          />
        </View>
      )}

      {item.kycStatus === KYC_STATUS.PENDING_VERIFICATION && !canTakeAction ? (
        <Text style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>
          Open full details and tick review confirmation before approving or rejecting.
        </Text>
      ) : null}

      {showRejectForm && item.kycStatus === KYC_STATUS.PENDING_VERIFICATION && (
        <View style={{ marginTop: AppSpace.sm }}>
          <AppInput
            label="Rejection reason"
            placeholder="Explain why this was rejected"
            value={rejectReason}
            onChangeText={setRejectReason}
            multiline
          />
          <AppButton
            label={pendingAction === `kyc:${item.email}:reject` ? 'Rejecting...' : 'Confirm Rejection'}
            onPress={() => {
              const reason = rejectReason.trim();
              if (!reason) return;
              Alert.alert('Reject KYC?', `Reject KYC for ${item.email}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reject', style: 'destructive', onPress: () => onReject(reason) },
              ]);
              setShowRejectForm(false);
              setRejectReason('');
            }}
            disabled={!rejectReason.trim() || Boolean(pendingAction)}
            style={{ backgroundColor: '#7f1d1d' }}
          />
        </View>
      )}
    </AppCard>
  );
}
