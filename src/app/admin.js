import { useRouter } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ListScreen from '../components/ui/list-screen';
import { KYC_STATUS, REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiDelete, apiGet, apiPost, assertApiSuccess } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

export default function Admin() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [requests, setRequests] = useState([]);
  const [kycSubmissions, setKycSubmissions] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [activeTab, setActiveTab] = useState('requests');
  const [notice, setNotice] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [pushEmail, setPushEmail] = useState('');
  const [pushTitle, setPushTitle] = useState('ConnectHub Test Notification');
  const [pushBody, setPushBody] = useState('This is a test push notification from ConnectHub admin.');
  const [pushLookup, setPushLookup] = useState(null);
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

  const reviewKyc = async (email, action, reason = '') => {
    const key = `kyc:${email}:${action}`;
    setPendingAction(key);
    setNotice(null);

    try {
      const endpoint = `${API_BASE_URL}/admin/kyc/${encodeURIComponent(email)}/${action}`;
      const payload = action === 'reject' ? { reason } : {};
      const { response, data } = await apiPost(endpoint, payload, { requireAuth: true });
      assertApiSuccess(response, data, `KYC ${action} failed`);

      setNotice({
        tone: 'success',
        title: action === 'approve' ? 'KYC approved' : 'KYC rejected',
        message: `${email} has been ${action === 'approve' ? 'verified' : 'rejected'}.`,
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

  const lookupPushToken = async () => {
    const targetEmail = pushEmail.trim().toLowerCase();
    if (!targetEmail) {
      setNotice({
        tone: 'warning',
        title: 'Email required',
        message: 'Enter an email address to inspect push token status.',
      });
      return;
    }

    setPendingAction('push:lookup');
    setNotice(null);
    setPushLookup(null);

    try {
      const { response, data } = await apiGet(
        `${API_BASE_URL}/admin/push-token/${encodeURIComponent(targetEmail)}`,
        { requireAuth: true }
      );
      const payload = assertApiSuccess(response, data, 'Could not fetch push token details');
      setPushLookup(payload?.data || null);
      setNotice({
        tone: 'success',
        title: 'Push token status loaded',
        message: payload?.data?.hasPushToken
          ? `Push token found for ${targetEmail}.`
          : `No push token saved for ${targetEmail} yet.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Lookup failed',
        message: formatApiMessage({ message: error.message }, 'Could not inspect push token status.'),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const sendPushTest = async () => {
    const targetEmail = pushEmail.trim().toLowerCase();
    if (!targetEmail) {
      setNotice({
        tone: 'warning',
        title: 'Email required',
        message: 'Enter a target email before sending a push test.',
      });
      return;
    }

    setPendingAction('push:send');
    setNotice(null);

    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/admin/push-test`,
        {
          email: targetEmail,
          title: pushTitle.trim() || 'ConnectHub Test Notification',
          body: pushBody.trim() || 'This is a test push notification from ConnectHub admin.',
        },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Push test failed');
      setNotice({
        tone: 'success',
        title: 'Push test sent',
        message: `Push notification queued for ${targetEmail}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Push test failed',
        message: formatApiMessage({ message: error.message }, 'Could not send push test.'),
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
              onPress={() => setActiveTab('push')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: AppRadius.md,
                backgroundColor: activeTab === 'push' ? '#2563eb' : '#1e293b',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: activeTab === 'push' ? '#fff' : AppColors.ink500, fontWeight: '700', fontSize: 13 }}>
                Push Tools
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
              : true
      }
      emptyTitle={
        activeTab === 'requests'
          ? 'No requests found'
          : activeTab === 'kyc'
            ? 'No KYC submissions'
            : activeTab === 'disputes'
              ? 'No disputes'
              : 'Push tools unavailable'
      }
      emptyDescription={
        activeTab === 'requests'
          ? 'Requests will appear here once they are created.'
          : activeTab === 'kyc'
            ? 'KYC submissions will appear here.'
            : activeTab === 'disputes'
              ? 'Disputes opened by customers will appear here.'
              : 'Refresh and try again.'
      }
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {activeTab === 'kyc'
          ? kycSubmissions.map((item) => (
              <KycReviewCard
                key={item.id}
                item={item}
                pendingAction={pendingAction}
                onApprove={() => reviewKyc(item.email, 'approve')}
                onReject={(reason) => reviewKyc(item.email, 'reject', reason)}
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
            : activeTab === 'push'
              ? (
                <AppCard style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Push Notification Debug Tools</Text>
                  <Text style={{ color: AppColors.ink500, marginBottom: 12 }}>
                    Check whether a user has a saved Expo push token, then send a test notification.
                  </Text>

                  <AppInput
                    label="User email"
                    placeholder="bhounce1000@gmail.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={pushEmail}
                    onChangeText={setPushEmail}
                  />

                  <AppInput
                    label="Push title"
                    placeholder="ConnectHub Test Notification"
                    value={pushTitle}
                    onChangeText={setPushTitle}
                  />

                  <AppInput
                    label="Push body"
                    placeholder="This is a test push notification"
                    value={pushBody}
                    onChangeText={setPushBody}
                    multiline
                  />

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                    <AppButton
                      label="Check Token"
                      onPress={lookupPushToken}
                      loading={pendingAction === 'push:lookup'}
                      disabled={Boolean(pendingAction)}
                      style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                    />
                    <AppButton
                      label="Send Test Push"
                      onPress={sendPushTest}
                      loading={pendingAction === 'push:send'}
                      disabled={Boolean(pendingAction)}
                      style={{ marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#2563eb' }}
                    />
                  </View>

                  {pushLookup ? (
                    <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: AppRadius.md, padding: 10 }}>
                      <Text style={{ color: AppColors.ink900, fontWeight: '700', marginBottom: 4 }}>
                        Token Status: {pushLookup.hasPushToken ? 'Available' : 'Missing'}
                      </Text>
                      <Text style={{ color: AppColors.ink500, fontSize: 13 }}>Email: {pushLookup.email || 'N/A'}</Text>
                      <Text style={{ color: AppColors.ink500, fontSize: 13 }}>
                        Updated: {pushLookup.pushTokenUpdatedAt ? String(pushLookup.pushTokenUpdatedAt) : 'N/A'}
                      </Text>
                      {pushLookup.pushToken ? (
                        <Text style={{ color: AppColors.ink700, fontSize: 12, marginTop: 6 }} numberOfLines={3}>
                          {pushLookup.pushToken}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </AppCard>
                )
          : requests.map((item) => (
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
      <Text style={{ color: AppColors.ink900, fontSize: 13, marginTop: 4, fontWeight: '700' }}>Reason</Text>
      <Text style={{ color: AppColors.ink700, fontSize: 13 }}>{item.reason || 'No reason provided'}</Text>
      {item.comment ? <Text style={{ color: AppColors.ink500, fontSize: 13, marginTop: 4 }}>Comment: {item.comment}</Text> : null}
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 6 }}>Evidence files: {Array.isArray(item.evidenceUrls) ? item.evidenceUrls.length : 0}</Text>

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
              label="Release To Worker"
              onPress={() => runResolve('release_to_worker')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:release_to_worker`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#15803d' }}
            />
            <AppButton
              label="Refund Customer"
              variant="danger"
              onPress={() => runResolve('refund_customer')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:refund_customer`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#b91c1c' }}
            />
            <AppButton
              label="Split Amount"
              onPress={() => runResolve('split')}
              disabled={Boolean(pendingAction)}
              loading={pendingAction === `dispute:${item.id}:split`}
              style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#7c3aed' }}
            />
          </View>
        </View>
      )}
    </AppCard>
  );
}

function KycReviewCard({ item, pendingAction, onApprove, onReject }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const kycBadgeColor =
    item.kycStatus === KYC_STATUS.VERIFIED
      ? '#16a34a'
      : item.kycStatus === KYC_STATUS.REJECTED
        ? '#b91c1c'
        : '#d97706';

  return (
    <AppCard style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <Text style={{ fontWeight: '700', flex: 1 }}>{item.fullName || item.email}</Text>
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
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>Phone: {item.phone || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>ID Type: {item.idType || 'N/A'} - {item.idNumber || 'N/A'}</Text>
      <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 2 }}>
        Payment: {item.paymentMethod === 'bank' ? `Bank - ${item.bankName || 'N/A'}` : `MoMo - ${item.momoProvider || 'N/A'}`}
      </Text>
      <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 4 }}>
        Submitted: {item.submittedAt ? String(item.submittedAt).slice(0, 10) : 'N/A'}
      </Text>

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
            onPress={onApprove}
            disabled={Boolean(pendingAction)}
            style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#15803d' }}
          />
          <AppButton
            label={showRejectForm ? 'Cancel Reject' : 'Reject'}
            onPress={() => setShowRejectForm((v) => !v)}
            disabled={Boolean(pendingAction)}
            style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#b91c1c' }}
          />
        </View>
      )}

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
              onReject(reason);
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
