import CryptoJS from 'crypto-js';
import { useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

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

function escapeCsv(value) {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
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
  const [selectedWithdrawalIds, setSelectedWithdrawalIds] = useState([]);
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
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [stuckPayments, setStuckPayments] = useState([]);
  const [stuckLoading, setStuckLoading] = useState(false);
  const [expandedRequestMap, setExpandedRequestMap] = useState({});
  const [wdStats, setWdStats] = useState(null);
  const [wdStatsLoading, setWdStatsLoading] = useState(false);
  const [wdStatsError, setWdStatsError] = useState(null);
  const [signupErrors, setSignupErrors] = useState([]);
  const [signupErrorsLoading, setSignupErrorsLoading] = useState(false);
  const [signupErrorsError, setSignupErrorsError] = useState(null);
  const [signupErrorSourceFilter, setSignupErrorSourceFilter] = useState('all');
  const [signupErrorTypeFilter, setSignupErrorTypeFilter] = useState('all');
  const [signupErrorSearch, setSignupErrorSearch] = useState('');
  const [signupErrorDateRange, setSignupErrorDateRange] = useState('all');
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

  useEffect(() => {
    if (!isAdmin) return undefined;
    return onSnapshot(collection(db, 'fraudAlerts'), (snapshot) => {
      const toMillis = (value) => {
        if (!value) return 0;
        if (typeof value?.toDate === 'function') return value.toDate().getTime();
        if (typeof value?.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt));
      setFraudAlerts(rows);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'analytics') return;
    loadActivityLogs();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'stuck') return;
    loadStuckPayments();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'instant-wd') return;
    loadWdStats();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'signup-errors') return;
    loadSignupErrors();
  }, [isAdmin, activeTab]);

  const loadWdStats = async () => {
    setWdStatsLoading(true);
    setWdStatsError(null);
    try {
      const { response, data } = await apiGet(`${API_BASE_URL}/admin/withdrawals/stats`, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not load withdrawal stats');
      setWdStats(data?.data || null);
    } catch (err) {
      setWdStatsError(String(err?.message || 'Failed to load withdrawal stats'));
    } finally {
      setWdStatsLoading(false);
    }
  };

  const loadSignupErrors = async () => {
    setSignupErrorsLoading(true);
    setSignupErrorsError(null);
    try {
      const { response, data } = await apiGet(`${API_BASE_URL}/admin/auth/signup-errors?limit=100`, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not load signup errors');
      setSignupErrors(Array.isArray(data?.logs) ? data.logs : []);
    } catch (error) {
      setSignupErrors([]);
      setSignupErrorsError(String(error?.message || 'Failed to load signup errors'));
    } finally {
      setSignupErrorsLoading(false);
    }
  };

  const confirmAdminAction = (actionName, onConfirm) => {
    const promptAndRun = () => {
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const typed = window.prompt(`Type CONFIRM to proceed with: ${actionName}`) || '';
        if (typed.trim().toUpperCase() === 'CONFIRM') onConfirm();
        else Alert.alert('Cancelled', 'Action was not confirmed.');
        return;
      }

      if (typeof Alert.prompt === 'function') {
        Alert.prompt(
          'Confirm Action',
          `Type CONFIRM to proceed with: ${actionName}`,
          (typed) => {
            if (String(typed || '').trim().toUpperCase() === 'CONFIRM') onConfirm();
            else Alert.alert('Cancelled', 'Action was not confirmed.');
          }
        );
        return;
      }

      Alert.alert('Final Confirmation', `Proceed with: ${actionName}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', style: 'destructive', onPress: onConfirm },
      ]);
    };

    Alert.alert('Admin Action Required', `Type CONFIRM to proceed with: ${actionName}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Proceed', style: 'destructive', onPress: promptAndRun },
    ]);
  };

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
      // Fire-and-forget confirmation email (non-blocking)
      apiPost(
        `${API_BASE_URL}/admin/notify-withdrawal-paid`,
        {
          email: withdrawal.email,
          amount: Number(withdrawal.amount || 0),
          provider: withdrawal.provider || '',
          phoneNumber: withdrawal.phoneNumber || '',
        },
        { requireAuth: true }
      ).catch(() => {});
      setNotice({
        tone: 'success',
        title: 'Withdrawal marked paid',
        message: `Marked ${withdrawal.reference} as paid. Confirmation email queued.`,
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
      // Fire-and-forget rejection email (non-blocking)
      apiPost(
        `${API_BASE_URL}/admin/notify-withdrawal-rejected`,
        {
          email: withdrawal.email,
          amount: Number(withdrawal.amount || 0),
          provider: withdrawal.provider || '',
          reason: String(reason || '').trim(),
        },
        { requireAuth: true }
      ).catch(() => {});
      setNotice({
        tone: 'success',
        title: 'Withdrawal rejected',
        message: `${withdrawal.reference} rejected, wallet restored, rejection email queued.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Action failed', message: error?.message || 'Could not reject withdrawal.' });
    } finally {
      setPendingAction(null);
    }
  };

  const retryInstantWithdrawal = async (wd) => {
    const key = `wd-retry:${wd.id}`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/withdrawals/${wd.id}/retry`,
        {},
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Could not retry withdrawal');
      setNotice({ tone: 'success', title: 'Retry initiated', message: `New transfer: ${data?.data?.transferCode || '—'}` });
      await loadWdStats();
    } catch (err) {
      setNotice({ tone: 'error', title: 'Retry failed', message: err?.message || 'Unknown error' });
    } finally {
      setPendingAction(null);
    }
  };

  const markInstantWithdrawalPaid = async (wd) => {
    const key = `wd-manual-paid:${wd.id}`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/withdrawals/${wd.id}/mark-manual-paid`,
        { notes: 'Manually marked paid from admin panel' },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Could not mark withdrawal paid');
      setNotice({ tone: 'success', title: 'Marked as paid', message: `Withdrawal ${wd.reference || wd.id} marked COMPLETED` });
      await loadWdStats();
    } catch (err) {
      setNotice({ tone: 'error', title: 'Action failed', message: err?.message || 'Unknown error' });
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
  const pendingWithdrawalAmount = useMemo(
    () => withdrawals
      .filter((w) => String(w.status || '') === 'pending_admin_approval')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0),
    [withdrawals]
  );

  const SLA_HOURS = 24;
  const overdueWithdrawals = useMemo(() => {
    const cutoffMs = Date.now() - SLA_HOURS * 60 * 60 * 1000;
    return withdrawals.filter((w) => {
      if (String(w.status || '') !== 'pending_admin_approval') return false;
      const raw = w.requestedAt || w.createdAt;
      if (!raw) return false;
      const ms = typeof raw?.toDate === 'function' ? raw.toDate().getTime()
        : typeof raw?.seconds === 'number' ? raw.seconds * 1000
        : new Date(raw).getTime();
      return Number.isFinite(ms) && ms < cutoffMs;
    });
  }, [withdrawals]);

  const filteredWithdrawals = useMemo(() => {
    if (withdrawalFilter === 'all') return withdrawals;
    if (withdrawalFilter === 'pending') return withdrawals.filter((w) => String(w.status || '') === 'pending_admin_approval');
    if (withdrawalFilter === 'completed') return withdrawals.filter((w) => String(w.status || '') === 'completed');
    if (withdrawalFilter === 'rejected') return withdrawals.filter((w) => String(w.status || '') === 'rejected');
    return withdrawals;
  }, [withdrawalFilter, withdrawals]);

  const pendingVisibleWithdrawals = useMemo(
    () => filteredWithdrawals.filter((w) => String(w.status || '') === 'pending_admin_approval'),
    [filteredWithdrawals]
  );

  useEffect(() => {
    const pendingSet = new Set(
      withdrawals
        .filter((w) => String(w.status || '') === 'pending_admin_approval')
        .map((w) => String(w.id || ''))
    );
    setSelectedWithdrawalIds((prev) => prev.filter((id) => pendingSet.has(id)));
  }, [withdrawals]);

  useEffect(() => {
    if (!emailTestTarget && currentEmail) {
      setEmailTestTarget(String(currentEmail).trim().toLowerCase());
    }
  }, [currentEmail, emailTestTarget]);

  const toggleWithdrawalSelection = (withdrawalId) => {
    const id = String(withdrawalId || '');
    if (!id) return;
    setSelectedWithdrawalIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisiblePendingWithdrawals = () => {
    const ids = pendingVisibleWithdrawals.map((w) => String(w.id || '')).filter(Boolean);
    setSelectedWithdrawalIds(ids);
  };

  const clearWithdrawalSelection = () => {
    setSelectedWithdrawalIds([]);
  };

  const runBulkMarkPaid = async () => {
    const selectedRows = pendingVisibleWithdrawals.filter((w) => selectedWithdrawalIds.includes(String(w.id || '')));
    if (selectedRows.length === 0) {
      setNotice({
        tone: 'warning',
        title: 'No withdrawals selected',
        message: 'Select at least one pending withdrawal to mark as paid.',
      });
      return;
    }

    setPendingAction('withdrawal:bulk:paid');
    setNotice(null);
    let successCount = 0;
    let failCount = 0;
    const failedReferences = [];

    for (const withdrawal of selectedRows) {
      try {
        const { response, data } = await apiPost(
          `${API_BASE_URL}/admin/withdrawals/${withdrawal.id}/complete`,
          {},
          { requireAuth: true }
        );
        assertApiSuccess(response, data, 'Could not mark withdrawal as paid');
        successCount += 1;
      } catch {
        failCount += 1;
        failedReferences.push(withdrawal.reference || withdrawal.id);
      }
    }

    setSelectedWithdrawalIds([]);

    if (failCount === 0) {
      setNotice({
        tone: 'success',
        title: 'Bulk payout updated',
        message: `Marked ${successCount} withdrawal${successCount === 1 ? '' : 's'} as paid.`,
      });
    } else {
      setNotice({
        tone: 'warning',
        title: 'Bulk payout partially complete',
        message: `Paid ${successCount}; failed ${failCount}. Failed refs: ${failedReferences.slice(0, 4).join(', ')}${failedReferences.length > 4 ? '…' : ''}`,
      });
    }

    setPendingAction(null);
  };

  const confirmBulkMarkPaid = () => {
    const selectedCount = pendingVisibleWithdrawals.filter((w) => selectedWithdrawalIds.includes(String(w.id || ''))).length;
    if (selectedCount === 0) {
      setNotice({ tone: 'warning', title: 'No withdrawals selected', message: 'Select pending withdrawals first.' });
      return;
    }

    confirmAdminAction(`Bulk mark ${selectedCount} withdrawal(s) as paid`, runBulkMarkPaid);
  };

  const runAutoRefundOverdue = async () => {
    confirmAdminAction(`Auto-refund ${overdueWithdrawals.length} overdue withdrawal(s)`, async () => {
      setPendingAction('withdrawal:auto-refund');
      try {
        const { response, data } = await apiPost(`${API_BASE_URL}/admin/withdrawals/auto-refund-overdue`, {}, { requireAuth: true });
        if (!response.ok || !data?.status) {
          throw new Error(data?.message || 'Auto-refund request failed');
        }
        setNotice({
          tone: 'success',
          title: 'Auto-Refund Complete',
          message: `Refunded: ${data?.refunded ?? 0} • Skipped: ${data?.skipped ?? 0} • Errors: ${data?.errors ?? 0}`,
        });
      } catch (err) {
        setNotice({ tone: 'error', title: 'Auto-Refund Failed', message: err?.message || 'Could not run auto-refund.' });
      } finally {
        setPendingAction(null);
      }
    });
  };

  const exportWithdrawalsCsv = () => {
    const rows = filteredWithdrawals;
    if (rows.length === 0) {
      setNotice({ tone: 'warning', title: 'No data to export', message: 'There are no withdrawals in the current filter.' });
      return;
    }

    const headers = [
      'withdrawalId',
      'reference',
      'email',
      'displayName',
      'amount',
      'provider',
      'phoneNumber',
      'accountName',
      'status',
      'requestedAt',
      'processedAt',
      'processedBy',
      'notes',
    ];

    const csvRows = rows.map((item) => [
      item.id || '',
      item.reference || '',
      item.email || '',
      item.displayName || '',
      Number(item.amount || 0).toFixed(2),
      item.provider || '',
      item.phoneNumber || '',
      item.accountName || '',
      item.status || '',
      formatIsoDate(item.requestedAt || item.createdAt),
      formatIsoDate(item.processedAt),
      item.processedBy || '',
      item.notes || '',
    ]);

    const csv = [headers.join(','), ...csvRows.map((line) => line.map(escapeCsv).join(','))].join('\n');
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    const fileName = `withdrawals-audit-${withdrawalFilter}-${timestamp}.csv`;

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice({ tone: 'success', title: 'CSV exported', message: `Downloaded ${fileName}` });
      return;
    }

    setNotice({ tone: 'warning', title: 'Export not supported on this device', message: 'Please use web admin to download CSV exports.' });
  };

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

  const loadActivityLogs = async () => {
    setActivityLoading(true);
    try {
      const { response, data } = await apiGet(`${API_BASE_URL}/admin/activity-logs`, { requireAuth: true });
      if (response.ok && data?.status) {
        setActivityLogs(Array.isArray(data.data) ? data.data : []);
      }
    } catch {
      setActivityLogs([]);
    } finally {
      setActivityLoading(false);
    }
  };

  const loadStuckPayments = async () => {
    setStuckLoading(true);
    try {
      const { response, data } = await apiGet(`${API_BASE_URL}/admin/jobs/stuck-payments`, { requireAuth: true });
      if (response.ok && data?.status) {
        setStuckPayments(Array.isArray(data.data) ? data.data : []);
      } else {
        setStuckPayments([]);
      }
    } catch {
      setStuckPayments([]);
    } finally {
      setStuckLoading(false);
    }
  };

  const runReconcileStuckPayments = async () => {
    setPendingAction('stuck:reconcile');
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/jobs/reconcile-stuck-payments`, { maxJobs: 200 }, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not reconcile stuck payments');
      const summary = data?.data || {};
      setNotice({
        tone: 'success',
        title: 'Reconciliation complete',
        message: `Scanned: ${summary.scanned || 0}, Fixed: ${summary.fixed || 0}, Skipped: ${summary.skipped || 0}.`,
      });
      await loadStuckPayments();
    } catch (error) {
      setNotice({ tone: 'error', title: 'Reconciliation failed', message: error?.message || 'Could not reconcile stuck payments.' });
    } finally {
      setPendingAction(null);
    }
  };

  const manualReleaseStuckPayment = async (requestId) => {
    const key = `stuck:${requestId}:release`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/jobs/${encodeURIComponent(requestId)}/manual-release`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not release payment manually');
      setNotice({ tone: 'success', title: 'Manual release complete', message: `Payment released for ${requestId}.` });
      await loadStuckPayments();
    } catch (error) {
      setNotice({ tone: 'error', title: 'Manual release failed', message: error?.message || 'Could not release payment manually.' });
    } finally {
      setPendingAction(null);
    }
  };

  const resolveFraudAlert = async (alertId) => {
    const key = `fraud:${alertId}:resolve`;
    setPendingAction(key);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/admin/fraud-alerts/${encodeURIComponent(alertId)}/resolve`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not resolve fraud alert');
      setNotice({ tone: 'success', title: 'Fraud alert resolved', message: 'Alert marked as resolved.' });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Action failed', message: error?.message || 'Could not resolve fraud alert.' });
    } finally {
      setPendingAction(null);
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
    confirmAdminAction(`Ban user ${email}`, () => banUser(email));
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
  const pendingFraudCount = fraudAlerts.filter((a) => !a.resolved).length;
  const stuckPaymentCount = stuckPayments.length;
  const signupErrorCount = signupErrors.length;
  const signupErrorTypeOptions = useMemo(() => {
    const set = new Set(['all']);
    signupErrors.forEach((entry) => set.add(String(entry.errorType || 'unknown_error').toLowerCase()));
    return Array.from(set);
  }, [signupErrors]);

  const getSignupErrorTimestampMs = (entry) => {
    const value = entry?.timestamp || entry?.createdAt || entry?.timestampIso || entry?.createdAtIso;
    if (!value) return 0;
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const filteredSignupErrors = useMemo(() => {
    const q = String(signupErrorSearch || '').trim().toLowerCase();
    const now = Date.now();
    const dateCutoff = signupErrorDateRange === '24h'
      ? now - 24 * 60 * 60 * 1000
      : signupErrorDateRange === '7d'
        ? now - 7 * 24 * 60 * 60 * 1000
        : signupErrorDateRange === '30d'
          ? now - 30 * 24 * 60 * 60 * 1000
          : 0;

    return signupErrors.filter((entry) => {
      const source = String(entry.source || 'unknown').toLowerCase();
      const errorType = String(entry.errorType || 'unknown_error').toLowerCase();
      const email = String(entry.email || '').toLowerCase();
      const message = String(entry.errorMessage || '').toLowerCase();
      const timestampMs = getSignupErrorTimestampMs(entry);
      if (signupErrorSourceFilter !== 'all' && source !== signupErrorSourceFilter) return false;
      if (signupErrorTypeFilter !== 'all' && errorType !== signupErrorTypeFilter) return false;
      if (dateCutoff > 0 && (timestampMs <= 0 || timestampMs < dateCutoff)) return false;
      if (!q) return true;
      return email.includes(q) || message.includes(q) || errorType.includes(q) || source.includes(q);
    });
  }, [signupErrors, signupErrorSearch, signupErrorSourceFilter, signupErrorTypeFilter, signupErrorDateRange]);

  const exportSignupErrorsCsv = () => {
    if (filteredSignupErrors.length === 0) {
      setNotice({ tone: 'warning', title: 'No data to export', message: 'No signup errors match your current filters.' });
      return;
    }

    const headers = ['id', 'timestamp', 'email', 'source', 'errorType', 'errorMessage', 'metadata'];
    const rows = filteredSignupErrors.map((entry) => [
      entry.id || '',
      formatIsoDate(entry.timestamp || entry.createdAt || entry.timestampIso || entry.createdAtIso),
      entry.email || '',
      entry.source || '',
      entry.errorType || '',
      entry.errorMessage || '',
      entry.metadata ? JSON.stringify(entry.metadata) : '',
    ]);
    const csv = [headers.join(','), ...rows.map((line) => line.map(escapeCsv).join(','))].join('\n');
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    const fileName = `signup-errors-${signupErrorDateRange}-${timestamp}.csv`;

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice({ tone: 'success', title: 'CSV exported', message: `Downloaded ${fileName}` });
      return;
    }

    setNotice({ tone: 'warning', title: 'Export not supported on this device', message: 'Please use web admin to download CSV exports.' });
  };

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
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Fraud Pending</Text>
              <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 18 }}>{pendingFraudCount}</Text>
            </AppCard>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Stuck Payments</Text>
              <Text style={{ color: '#92400e', fontWeight: '800', fontSize: 18 }}>{stuckPaymentCount}</Text>
            </AppCard>
            <AppCard style={{ flex: 1, marginBottom: 0, paddingVertical: 10 }}>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Signup Errors</Text>
              <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 18 }}>{signupErrorCount}</Text>
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
              onPress={() => setActiveTab('instant-wd')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'instant-wd' ? '#0f766e' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'instant-wd' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Instant WD
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
              onPress={() => {
                setActiveTab('analytics');
                loadAnalytics();
                loadActivityLogs();
              }}
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

            <TouchableOpacity
              onPress={() => setActiveTab('fraud')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'fraud' ? '#b91c1c' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'fraud' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Fraud ({pendingFraudCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveTab('stuck');
                loadStuckPayments();
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'stuck' ? '#92400e' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'stuck' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Stuck ({stuckPaymentCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveTab('signup-errors');
                loadSignupErrors();
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'signup-errors' ? '#7f1d1d' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'signup-errors' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Signup Errors ({signupErrorCount})
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
              : activeTab === 'instant-wd'
                ? true
              : activeTab === 'analytics'
                ? true
              : activeTab === 'fraud'
                ? fraudAlerts.length > 0
              : activeTab === 'stuck'
                ? true
              : activeTab === 'signup-errors'
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
              : activeTab === 'instant-wd'
                ? 'No instant withdrawals'
              : activeTab === 'analytics'
                ? 'Loading…'
              : activeTab === 'fraud'
                ? 'No fraud alerts'
              : activeTab === 'stuck'
                ? 'No stuck payments'
              : activeTab === 'signup-errors'
                ? 'No signup errors'
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
              : activeTab === 'instant-wd'
                ? 'Instant wallet withdrawals will appear here.'
              : activeTab === 'analytics'
                ? 'Fetching analytics data…'
              : activeTab === 'fraud'
                ? 'Fraud alerts will appear here when risk checks are triggered.'
              : activeTab === 'stuck'
                ? 'Jobs with paid/completed states but no wallet credit will appear here.'
              : activeTab === 'signup-errors'
                ? 'Signup failures will appear here for debugging.'
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
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <AppButton label="Refresh Analytics" variant="neutral" onPress={loadAnalytics} loading={analyticsLoading} style={{ flex: 1 }} />
                    <AppButton label="Refresh Activity" variant="neutral" onPress={loadActivityLogs} loading={activityLoading} style={{ flex: 1 }} />
                  </View>

                  <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 16, marginBottom: 10, marginTop: 16 }}>Activity Log</Text>
                  {activityLoading ? (
                    <Text style={{ color: AppColors.ink500 }}>Loading activity logs…</Text>
                  ) : activityLogs.length === 0 ? (
                    <Text style={{ color: AppColors.ink500 }}>No recent admin actions.</Text>
                  ) : activityLogs.map((log) => {
                    const ts = formatIsoDate(log.timestamp || log.createdAt);
                    const action = String(log.action || 'unknown');
                    const adminEmail = String(log.adminEmail || 'unknown');
                    const target = String(log.details?.targetEmail || log.details?.withdrawalId || log.details?.requestId || log.details?.disputeId || 'n/a');
                    const actionColor = action.includes('reject') || action.includes('ban') ? '#b91c1c'
                      : action.includes('approve') || action.includes('paid') || action.includes('resolve') ? '#15803d'
                        : '#1d4ed8';

                    return (
                      <AppCard key={log.id} style={{ marginBottom: 8, borderLeftWidth: 3, borderLeftColor: actionColor }}>
                        <Text style={{ color: AppColors.ink900, fontWeight: '700', marginBottom: 2 }}>{action}</Text>
                        <Text style={{ color: AppColors.ink500, fontSize: 12 }}>{ts}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Admin: {adminEmail}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Target: {target}</Text>
                      </AppCard>
                    );
                  })}
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
                onReject={(reason) => confirmAdminAction(`Reject KYC for ${item.email}`, () => reviewKyc(item, 'reject', reason))}
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

                  <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fdba74' }}>
                    <Text style={{ color: '#9a3412', fontWeight: '800', marginBottom: 8 }}>
                      Bulk Actions
                    </Text>
                    <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 10 }}>
                      Selected: {selectedWithdrawalIds.length} • Pending in view: {pendingVisibleWithdrawals.length}
                    </Text>
                    <Text style={{ color: '#9a3412', fontSize: 13, fontWeight: '800', marginBottom: 10 }}>
                      Total Pending: GHS {pendingWithdrawalAmount.toFixed(2)}
                    </Text>
                    {overdueWithdrawals.length > 0 ? (
                      <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                        <Text style={{ color: '#b91c1c', fontWeight: '800', marginBottom: 4 }}>
                          ⚠ {overdueWithdrawals.length} overdue ({SLA_HOURS}h+ pending)
                        </Text>
                        <AppButton
                          label={pendingAction === 'withdrawal:auto-refund' ? 'Refunding…' : `Auto-Refund ${overdueWithdrawals.length} Overdue`}
                          onPress={runAutoRefundOverdue}
                          loading={pendingAction === 'withdrawal:auto-refund'}
                          disabled={Boolean(pendingAction)}
                          style={{ backgroundColor: '#b91c1c', paddingVertical: 8 }}
                        />
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <AppButton
                        label="Select All Pending"
                        onPress={selectAllVisiblePendingWithdrawals}
                        disabled={Boolean(pendingAction) || pendingVisibleWithdrawals.length === 0}
                        style={{ backgroundColor: '#0f766e', paddingVertical: 9 }}
                      />
                      <AppButton
                        label="Clear Selection"
                        variant="neutral"
                        onPress={clearWithdrawalSelection}
                        disabled={Boolean(pendingAction) || selectedWithdrawalIds.length === 0}
                        style={{ paddingVertical: 9 }}
                      />
                      <AppButton
                        label={pendingAction === 'withdrawal:bulk:paid' ? 'Processing…' : 'Mark Selected Paid'}
                        onPress={confirmBulkMarkPaid}
                        loading={pendingAction === 'withdrawal:bulk:paid'}
                        disabled={Boolean(pendingAction) || selectedWithdrawalIds.length === 0}
                        style={{ backgroundColor: '#15803d', paddingVertical: 9 }}
                      />
                      <AppButton
                        label="Export CSV"
                        onPress={exportWithdrawalsCsv}
                        disabled={Boolean(pendingAction) || filteredWithdrawals.length === 0}
                        style={{ backgroundColor: '#1d4ed8', paddingVertical: 9 }}
                      />
                    </View>
                  </AppCard>

                  {filteredWithdrawals.map((item) => (
                    <WithdrawalReviewCard
                      key={item.id}
                      item={item}
                      pendingAction={pendingAction}
                      onMarkPaid={markWithdrawalPaid}
                      onReject={rejectWithdrawal}
                      isSelected={selectedWithdrawalIds.includes(String(item.id || ''))}
                      onToggleSelect={toggleWithdrawalSelection}
                    />
                  ))}
                </>
              )
            : activeTab === 'instant-wd'
              ? (
                <>
                  <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: '#99f6e4' }}>
                    <Text style={{ color: '#115e59', fontWeight: '800', marginBottom: 8 }}>Instant Withdrawal Dashboard</Text>
                    {wdStatsError ? (
                      <Text style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{wdStatsError}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <View style={{ backgroundColor: '#f0fdfa', borderRadius: 10, padding: 10, minWidth: 120 }}>
                        <Text style={{ color: '#0f766e', fontSize: 11, fontWeight: '700' }}>Paid Today</Text>
                        <Text style={{ color: '#134e4a', fontSize: 16, fontWeight: '900' }}>GHS {Number(wdStats?.stats?.paidToday || 0).toFixed(2)}</Text>
                      </View>
                      <View style={{ backgroundColor: '#ecfeff', borderRadius: 10, padding: 10, minWidth: 120 }}>
                        <Text style={{ color: '#0e7490', fontSize: 11, fontWeight: '700' }}>Paid This Week</Text>
                        <Text style={{ color: '#164e63', fontSize: 16, fontWeight: '900' }}>GHS {Number(wdStats?.stats?.paidWeek || 0).toFixed(2)}</Text>
                      </View>
                      <View style={{ backgroundColor: '#f0f9ff', borderRadius: 10, padding: 10, minWidth: 120 }}>
                        <Text style={{ color: '#0369a1', fontSize: 11, fontWeight: '700' }}>Paid This Month</Text>
                        <Text style={{ color: '#0c4a6e', fontSize: 16, fontWeight: '900' }}>GHS {Number(wdStats?.stats?.paidMonth || 0).toFixed(2)}</Text>
                      </View>
                    </View>
                    <Text style={{ color: '#475569', fontSize: 12, marginTop: 10 }}>
                      Pending/Processing: {Number(wdStats?.stats?.pendingCount || 0)} • Failed: {Number(wdStats?.stats?.failedCount || 0)} • Completed: {Number(wdStats?.stats?.completedCount || 0)}
                    </Text>
                    <AppButton
                      label={wdStatsLoading ? 'Refreshing...' : 'Refresh'}
                      onPress={loadWdStats}
                      loading={wdStatsLoading}
                      disabled={Boolean(pendingAction) || wdStatsLoading}
                      style={{ backgroundColor: '#0f766e', paddingVertical: 8, marginTop: 10 }}
                    />
                  </AppCard>

                  {(wdStats?.withdrawals || []).map((wd) => {
                    const s = String(wd.status || '').toUpperCase();
                    const isFailed = s === 'FAILED';
                    const canManual = s === 'FAILED' || s === 'PROCESSING';
                    const badgeBg = s === 'COMPLETED' ? '#dcfce7' : s === 'FAILED' ? '#fee2e2' : s === 'PROCESSING' ? '#fef3c7' : '#f1f5f9';
                    const badgeText = s === 'COMPLETED' ? '#166534' : s === 'FAILED' ? '#991b1b' : s === 'PROCESSING' ? '#92400e' : '#334155';
                    return (
                      <AppCard key={wd.id} style={{ marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Text style={{ color: AppColors.ink900, fontWeight: '900' }}>GHS {Number(wd.amount || 0).toFixed(2)}</Text>
                          <View style={{ backgroundColor: badgeBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                            <Text style={{ color: badgeText, fontSize: 11, fontWeight: '800' }}>{s || 'UNKNOWN'}</Text>
                          </View>
                        </View>
                        <Text style={{ color: AppColors.ink700, fontSize: 13 }}>User: {wd.userEmail || wd.email || 'N/A'}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 13 }}>MoMo: {wd.provider || 'N/A'} • {wd.phoneNumber || 'N/A'}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 12 }}>Ref: {wd.reference || wd.id}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 12 }}>Requested: {formatIsoDate(wd.requestedAt || wd.requestedAtIso)}</Text>
                        {wd.completedAt ? (
                          <Text style={{ color: '#94a3b8', fontSize: 12 }}>Completed: {formatIsoDate(wd.completedAt)}</Text>
                        ) : null}

                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          {isFailed ? (
                            <AppButton
                              label={pendingAction === `wd-retry:${wd.id}` ? 'Retrying...' : 'Retry'}
                              onPress={() => confirmAdminAction(`Retry withdrawal ${wd.reference || wd.id}`, () => retryInstantWithdrawal(wd))}
                              loading={pendingAction === `wd-retry:${wd.id}`}
                              disabled={Boolean(pendingAction)}
                              style={{ backgroundColor: '#0f766e', paddingVertical: 8 }}
                            />
                          ) : null}
                          {canManual ? (
                            <AppButton
                              label={pendingAction === `wd-manual-paid:${wd.id}` ? 'Marking...' : 'Mark Paid'}
                              onPress={() => confirmAdminAction(`Mark withdrawal ${wd.reference || wd.id} as manually paid`, () => markInstantWithdrawalPaid(wd))}
                              loading={pendingAction === `wd-manual-paid:${wd.id}`}
                              disabled={Boolean(pendingAction)}
                              style={{ backgroundColor: '#1d4ed8', paddingVertical: 8 }}
                            />
                          ) : null}
                        </View>
                      </AppCard>
                    );
                  })}
                </>
              )
            : activeTab === 'fraud'
              ? fraudAlerts.map((alert) => {
                const isResolved = Boolean(alert.resolved);
                return (
                  <AppCard key={alert.id} style={{ marginBottom: 10, borderWidth: 1, borderColor: isResolved ? '#86efac' : '#fca5a5' }}>
                    <Text style={{ color: isResolved ? '#166534' : '#b91c1c', fontWeight: '800', marginBottom: 4 }}>
                      {String(alert.type || 'fraud_alert').toUpperCase()}
                    </Text>
                    <Text style={{ color: AppColors.ink700, fontSize: 13 }}>User: {alert.email || 'N/A'}</Text>
                    <Text style={{ color: AppColors.ink700, fontSize: 13 }}>Time: {formatIsoDate(alert.createdAt || alert.timestamp)}</Text>
                    <Text style={{ color: AppColors.ink700, fontSize: 13, marginBottom: 8 }}>
                      Status: {isResolved ? 'Resolved' : 'Unresolved'}
                    </Text>
                    {!isResolved ? (
                      <AppButton
                        label={pendingAction === `fraud:${alert.id}:resolve` ? 'Resolving...' : 'Mark Resolved'}
                        onPress={() => confirmAdminAction(`Resolve fraud alert ${alert.id}`, () => resolveFraudAlert(alert.id))}
                        loading={pendingAction === `fraud:${alert.id}:resolve`}
                        disabled={Boolean(pendingAction)}
                        style={{ backgroundColor: '#0f766e', paddingVertical: 8 }}
                      />
                    ) : null}
                  </AppCard>
                );
              })
            : activeTab === 'stuck'
              ? (
                <>
                  <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fcd34d' }}>
                    <Text style={{ color: '#92400e', fontWeight: '800', marginBottom: 6 }}>Stuck Payment Recovery</Text>
                    <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 10 }}>
                      These jobs are in paid/completed states but have no payout credit marker.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <AppButton
                        label={stuckLoading ? 'Refreshing…' : 'Refresh'}
                        variant="neutral"
                        onPress={loadStuckPayments}
                        loading={stuckLoading}
                        disabled={Boolean(pendingAction)}
                      />
                      <AppButton
                        label={pendingAction === 'stuck:reconcile' ? 'Reconciling…' : 'Reconcile All'}
                        onPress={() => confirmAdminAction('Reconcile all stuck payments', runReconcileStuckPayments)}
                        loading={pendingAction === 'stuck:reconcile'}
                        disabled={Boolean(pendingAction)}
                        style={{ backgroundColor: '#92400e' }}
                      />
                    </View>
                  </AppCard>

                  {stuckLoading ? (
                    <Text style={{ color: AppColors.ink500 }}>Loading stuck jobs…</Text>
                  ) : stuckPayments.length === 0 ? (
                    <Text style={{ color: AppColors.ink500 }}>No stuck payments detected.</Text>
                  ) : stuckPayments.map((job) => (
                    <AppCard key={job.id} style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fed7aa' }}>
                      <Text style={{ color: AppColors.ink900, fontWeight: '800', marginBottom: 4 }}>{job.title || job.id}</Text>
                      <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Status: {job.status || 'unknown'}</Text>
                      <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Customer: {job.user || 'N/A'}</Text>
                      <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Provider: {job.acceptedBy || 'N/A'}</Text>
                      <Text style={{ color: '#166534', fontSize: 12, fontWeight: '800', marginBottom: 8 }}>
                        Amount: GHS {Number(job.price || 0).toFixed(2)}
                      </Text>
                      <AppButton
                        label={pendingAction === `stuck:${job.id}:release` ? 'Releasing…' : 'Manual Release'}
                        onPress={() => confirmAdminAction(`Manual release for ${job.id}`, () => manualReleaseStuckPayment(job.id))}
                        loading={pendingAction === `stuck:${job.id}:release`}
                        disabled={Boolean(pendingAction)}
                        style={{ backgroundColor: '#0f766e', paddingVertical: 8 }}
                      />
                    </AppCard>
                  ))}
                </>
              )
            : activeTab === 'signup-errors'
              ? (
                <>
                  <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fecaca' }}>
                    <Text style={{ color: '#7f1d1d', fontWeight: '800', marginBottom: 6 }}>Signup Error Diagnostics</Text>
                    {signupErrorsError ? (
                      <Text style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{signupErrorsError}</Text>
                    ) : null}
                    <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 10 }}>
                      Review recent signup and OTP failures reported by backend and client.
                    </Text>
                    <AppInput
                      label="Search by email/message"
                      placeholder="e.g. gmail, otp_send_failed"
                      value={signupErrorSearch}
                      onChangeText={setSignupErrorSearch}
                    />
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      {[
                        ['all', 'All Sources'],
                        ['otp_send', 'OTP Send'],
                        ['otp_verify', 'OTP Verify'],
                        ['client_signup', 'Client Signup'],
                      ].map(([value, label]) => {
                        const selected = signupErrorSourceFilter === value;
                        return (
                          <TouchableOpacity
                            key={`signup-source-${value}`}
                            onPress={() => setSignupErrorSourceFilter(value)}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: selected ? '#f87171' : '#334155',
                              backgroundColor: selected ? '#7f1d1d' : '#0f172a',
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      {signupErrorTypeOptions.slice(0, 8).map((value) => {
                        const selected = signupErrorTypeFilter === value;
                        return (
                          <TouchableOpacity
                            key={`signup-type-${value}`}
                            onPress={() => setSignupErrorTypeFilter(value)}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: selected ? '#fca5a5' : '#334155',
                              backgroundColor: selected ? '#450a0a' : '#0f172a',
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                              {value === 'all' ? 'All Types' : value}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      {[
                        ['all', 'All Time'],
                        ['24h', '24h'],
                        ['7d', '7d'],
                        ['30d', '30d'],
                      ].map(([value, label]) => {
                        const selected = signupErrorDateRange === value;
                        return (
                          <TouchableOpacity
                            key={`signup-date-${value}`}
                            onPress={() => setSignupErrorDateRange(value)}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: selected ? '#fca5a5' : '#334155',
                              backgroundColor: selected ? '#7f1d1d' : '#0f172a',
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 10 }}>
                      Showing {filteredSignupErrors.length} of {signupErrors.length}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <AppButton
                        label={signupErrorsLoading ? 'Refreshing...' : 'Refresh'}
                        onPress={loadSignupErrors}
                        loading={signupErrorsLoading}
                        disabled={Boolean(pendingAction) || signupErrorsLoading}
                        style={{ backgroundColor: '#7f1d1d', paddingVertical: 8 }}
                      />
                      <AppButton
                        label="Export CSV"
                        onPress={exportSignupErrorsCsv}
                        disabled={Boolean(pendingAction) || filteredSignupErrors.length === 0}
                        style={{ backgroundColor: '#1d4ed8', paddingVertical: 8 }}
                      />
                    </View>
                  </AppCard>

                  {signupErrorsLoading ? (
                    <Text style={{ color: AppColors.ink500 }}>Loading signup errors…</Text>
                  ) : filteredSignupErrors.length === 0 ? (
                    <Text style={{ color: AppColors.ink500 }}>No signup errors recorded yet.</Text>
                  ) : filteredSignupErrors.map((entry) => {
                    const email = String(entry.email || 'unknown');
                    const errorType = String(entry.errorType || 'unknown_error');
                    const errorMessage = String(entry.errorMessage || 'No error message');
                    const source = String(entry.source || 'unknown');
                    const metadataPreview = entry.metadata ? JSON.stringify(entry.metadata) : '';

                    return (
                      <AppCard key={entry.id} style={{ marginBottom: 10, borderWidth: 1, borderColor: '#fca5a5' }}>
                        <Text style={{ color: '#7f1d1d', fontWeight: '800', marginBottom: 2 }}>{errorType}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 13 }}>Email: {email}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 13 }}>Source: {source}</Text>
                        <Text style={{ color: AppColors.ink700, fontSize: 13 }}>Time: {formatIsoDate(entry.timestamp || entry.timestampIso || entry.createdAt || entry.createdAtIso)}</Text>
                        <Text style={{ color: '#475569', fontSize: 12, marginTop: 6 }}>{errorMessage}</Text>
                        {metadataPreview ? (
                          <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }} numberOfLines={3}>Meta: {metadataPreview}</Text>
                        ) : null}
                      </AppCard>
                    );
                  })}
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
                  <AppButton label="Force Complete" onPress={() => confirmAdminAction(`Force complete job ${item.id}`, () => setStatus(item, REQUEST_STATUS.COMPLETED))} style={{ flex: 1, paddingVertical: 8, backgroundColor: '#0f766e' }} />
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
                    onPress={() => confirmAdminAction(`Complete job ${item.id}`, () => setStatus(item, REQUEST_STATUS.COMPLETED))}
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

function WithdrawalReviewCard({ item, pendingAction, onMarkPaid, onReject, isSelected = false, onToggleSelect }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const status = String(item.status || 'pending_admin_approval');
  const isPending = status === 'pending_admin_approval';
  const statusMeta = status === 'completed'
    ? { bg: '#dcfce7', text: '#166534', label: 'Paid ✅' }
    : status === 'rejected'
      ? { bg: '#fee2e2', text: '#b91c1c', label: 'Rejected' }
      : { bg: '#ffedd5', text: '#c2410c', label: 'Pending' };

  const ageMs = useMemo(() => {
    if (!isPending) return 0;
    const raw = item.requestedAt || item.createdAt;
    if (!raw) return 0;
    const ms = typeof raw?.toDate === 'function' ? raw.toDate().getTime()
      : typeof raw?.seconds === 'number' ? raw.seconds * 1000
      : new Date(raw).getTime();
    return Number.isFinite(ms) ? Date.now() - ms : 0;
  }, [isPending, item.requestedAt, item.createdAt]);

  const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
  const isOverdue = isPending && ageHours >= 24;
  const isWarning = isPending && ageHours >= 12 && ageHours < 24;
  const cardBorderColor = isOverdue ? '#fca5a5' : isWarning ? '#fcd34d' : '#fed7aa';

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
    <AppCard style={{ marginBottom: 10, borderWidth: 1, borderColor: cardBorderColor }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{item.email || 'Unknown user'}</Text>
          <Text style={{ color: '#16a34a', fontWeight: '900', marginTop: 3 }}>GHS {Number(item.amount || 0).toFixed(2)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isOverdue ? (
            <View style={{ backgroundColor: '#fee2e2', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 10 }}>⚠ {ageHours}h OVERDUE</Text>
            </View>
          ) : isWarning ? (
            <View style={{ backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: '#92400e', fontWeight: '800', fontSize: 10 }}>{ageHours}h pending</Text>
            </View>
          ) : null}
          <View style={{ backgroundColor: statusMeta.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: statusMeta.text, fontWeight: '800', fontSize: 11 }}>{statusMeta.label}</Text>
          </View>
        </View>
      </View>

      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>{item.provider || 'Network'} • {item.phoneNumber || 'No number'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Account: {item.accountName || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Reference: {item.reference || item.id}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginBottom: 2 }}>Requested: {formatIsoDate(item.requestedAt || item.createdAt)}</Text>

      {isPending ? (
        <TouchableOpacity
          onPress={() => onToggleSelect?.(item.id)}
          disabled={Boolean(pendingAction)}
          style={{
            marginTop: 6,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: isSelected ? '#15803d' : '#64748b',
              backgroundColor: isSelected ? '#15803d' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSelected ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
          </View>
          <Text style={{ color: AppColors.ink500, fontSize: 12, fontWeight: '700' }}>Select for bulk payout</Text>
        </TouchableOpacity>
      ) : null}

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
                onPress={() => Alert.alert(
                  'Reject withdrawal?',
                  `Reject GHS ${Number(item.amount || 0).toFixed(2)} for ${item.email || 'this user'} and restore wallet balance?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reject', style: 'destructive', onPress: () => onReject(item, rejectReason) },
                  ]
                )}
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
