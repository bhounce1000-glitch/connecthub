import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ListScreen from '../components/ui/list-screen';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

export default function Payments() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  const [reference, setReference] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [requests, setRequests] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [notice, setNotice] = useState(null);

  const exportPaymentsCsv = async () => {
    if (!filteredRequests.length) {
      setNotice({
        tone: 'warning',
        title: 'Nothing to export',
        message: 'No records match your current filter.',
      });
      return;
    }

    const quote = (value) => {
      const str = String(value ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const header = [
      'requestId',
      'title',
      'amount',
      'paid',
      'paymentStatus',
      'paymentReference',
      'paymentChannel',
      'gatewayResponse',
      'user',
      'acceptedBy',
      'paidAt',
    ];

    const lines = filteredRequests.map((item) => ([
      item.id,
      item.title,
      Number(item.price || 0).toFixed(2),
      item.paid ? 'yes' : 'no',
      item.paymentStatus || 'pending',
      item.paymentReference || '',
      item.paymentChannel || '',
      item.gatewayResponse || '',
      item.user || '',
      item.acceptedBy || '',
      item.paidAt || '',
    ].map(quote).join(',')));

    const csv = `${header.join(',')}\n${lines.join('\n')}`;

    try {
      await Clipboard.setStringAsync(csv);
      setNotice({
        tone: 'success',
        title: 'Copied',
        message: `Copied ${filteredRequests.length} payment rows to clipboard as CSV.`,
      });
    } catch {
      setNotice({
        tone: 'error',
        title: 'Copy failed',
        message: 'Could not copy CSV to clipboard. Please try again.',
      });
    }
  };

  useEffect(() => {
    const paymentsQuery = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(20));

    return onSnapshot(paymentsQuery, (snapshot) => {
      setRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }, []);

  const verifyReference = async () => {
    if (!reference.trim()) {
      setNotice({
        tone: 'warning',
        title: 'Missing reference',
        message: 'Enter a Paystack reference to verify.',
      });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/pay/verify`, { reference: reference.trim() }, { requireAuth: true });

      if (!response.ok || !data?.status) {
        setNotice({
          tone: 'error',
          title: 'Verification failed',
          message: formatApiMessage(data, 'Unable to verify this reference.'),
        });
        return;
      }

      setVerificationResult(data);
      setNotice({
        tone: data?.data?.status === 'success' ? 'success' : 'info',
        title: data?.data?.status === 'success' ? 'Reference verified' : 'Reference checked',
        message: formatApiMessage(data, 'Reference verification completed.'),
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Verification failed',
        message: error.message || 'Unable to verify this reference.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRequests = requests.filter((item) => {
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'paid'
          ? Boolean(item.paid)
          : statusFilter === 'unpaid'
            ? !item.paid
            : (item.paymentStatus || '').toLowerCase() === statusFilter;

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      item.id,
      item.title,
      item.paymentReference,
      item.paymentStatus,
      item.gatewayResponse,
      item.user,
      item.acceptedBy,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'paid', label: 'Paid' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'success', label: 'Success' },
    { key: 'abandoned', label: 'Abandoned' },
    { key: 'pending', label: 'Pending' },
  ];

  const statusBadge = (status) => {
    const key = String(status || 'pending').toLowerCase();
    if (key === 'success') return { bg: '#dcfce7', color: '#166534', label: 'success' };
    if (key === 'refunded') return { bg: '#ffedd5', color: '#c2410c', label: 'refunded' };
    if (key === 'resolved') return { bg: '#dbeafe', color: '#1d4ed8', label: 'resolved' };
    if (key === 'failed' || key === 'abandoned') return { bg: '#fee2e2', color: '#b91c1c', label: key };
    return { bg: '#e5e7eb', color: '#374151', label: 'pending' };
  };

  const channelIcon = (value) => {
    const channel = String(value || '').toLowerCase();
    if (channel.includes('mobile')) return '📱';
    if (channel.includes('card')) return '💳';
    return '💰';
  };

  return (
    <ListScreen
      eyebrow="PAYMENT OPS"
      title="Payments"
      subtitle="Verify a Paystack reference and review recent payment records."
      accentColor="#7c2d12"
      accentTextColor="#ffedd5"
      hasItems={filteredRequests.length > 0}
      emptyTitle="No matching requests"
      emptyDescription="Try a different search or status filter."
      toolbar={(
        <View>
          <AppCard style={{ marginBottom: 20 }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>
              Search requests
            </Text>

            <AppButton
              label="Copy Filtered CSV"
              variant="neutral"
              onPress={exportPaymentsCsv}
              style={{ marginBottom: 12 }}
            />

            <AppInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by title, request ID, reference, or email"
              label="Search"
              autoCapitalize="none"
              containerStyle={{ marginBottom: 12 }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {filterOptions.map((option) => (
                <AppButton
                  key={option.key}
                  label={option.label}
                  onPress={() => setStatusFilter(option.key)}
                  style={{
                    backgroundColor: statusFilter === option.key ? '#2563eb' : '#e5e7eb',
                    marginRight: 8,
                    marginBottom: 8,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                  textStyle={{ color: statusFilter === option.key ? 'white' : '#111827' }}
                />
              ))}
            </View>
          </AppCard>

          <AppCard style={{ marginBottom: 20 }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>
              Verify reference
            </Text>

            <AppNotice
              tone={notice?.tone}
              title={notice?.title}
              message={notice?.message}
            />

            <AppInput
              value={reference}
              onChangeText={setReference}
              placeholder="Enter Paystack reference"
              label="Reference"
              autoCapitalize="none"
              containerStyle={{ marginBottom: 12 }}
            />

            <AppButton
              label="Verify Payment"
              variant="primary"
              onPress={verifyReference}
              disabled={!reference.trim()}
              loading={isSubmitting}
            />

            {verificationResult ? (
              <View style={{ marginTop: 14, backgroundColor: '#f9fafb', padding: 12, borderRadius: 10 }}>
                <Text style={{ fontWeight: '700', marginBottom: 6 }}>
                  Result
                </Text>
                <Text>Status: {String(verificationResult?.data?.status || verificationResult?.status || 'unknown')}</Text>
                <Text>Message: {verificationResult?.message || verificationResult?.error || 'Unavailable'}</Text>
                <Text>Reference: {verificationResult?.data?.reference || 'Unavailable'}</Text>
                <Text>Request ID: {verificationResult?.requestId || verificationResult?.data?.metadata?.requestId || 'Unavailable'}</Text>
              </View>
            ) : null}
          </AppCard>

          <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
            Recent requests ({filteredRequests.length})
          </Text>
        </View>
      )}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {filteredRequests.map((item) => (
          <AppCard
            key={item.id}
            style={{ marginBottom: 12 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, flex: 1 }}>
                {item.title || item.id}
              </Text>
              <View style={{ backgroundColor: statusBadge(item.paymentStatus).bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: statusBadge(item.paymentStatus).color, fontWeight: '800', fontSize: 11 }}>{statusBadge(item.paymentStatus).label}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#166534', marginBottom: 4 }}>GHS {Number(item.price || 0).toFixed(2)}</Text>
            <Text>ID: {item.id}</Text>
            <Text>Paid: {item.paid ? 'Yes ✅' : 'No ❌'}</Text>
            <Text>Payment status: {item.paymentStatus || 'Unavailable'}</Text>
            <Text>Reference: {item.paymentReference || 'Unavailable'}</Text>
            <Text>Channel: {channelIcon(item.paymentChannel)} {item.paymentChannel || 'Unavailable'}</Text>
            <Text>Gateway: {item.gatewayResponse || 'Unavailable'}</Text>
            <Text>User: {item.user || 'Unavailable'}</Text>
            <Text>Accepted by: {item.acceptedBy || 'Unavailable'}</Text>
            <Text>Paid at: {item.paidAt || 'Unavailable'}</Text>
          </AppCard>
        ))}
      </ScrollView>
    </ListScreen>
  );
}