import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiPost } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

export default function PayReturn() {
  const router = useRouter();
  const { id, reference: referenceParam, trxref } = useLocalSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [notice, setNotice] = useState({
    tone: 'info',
    title: 'Verifying payment',
    message: 'We are checking your Paystack reference now.',
  });
  const hasVerified = useRef(false);

  const requestId = Array.isArray(id) ? id[0] : id;
  const reference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);

  useEffect(() => {
    if (!reference || hasVerified.current) {
      if (!reference) {
        setNotice({
          tone: 'warning',
          title: 'No payment reference found',
          message: 'Return here after checkout so the payment can be verified.',
        });
        setIsLoading(false);
      }
      return;
    }

    hasVerified.current = true;

    const verifyPayment = async () => {
      try {
        const { response, data } = await apiPost(`${API_BASE_URL}/pay/verify`, { reference }, { requireAuth: true });
        const paymentStatus = data?.data?.status;
        const paymentUpdate = data?.paymentUpdate;

        if (!response.ok || !data?.status) {
          setNotice({
            tone: 'error',
            title: 'Verification request failed',
            message: formatApiMessage(data, 'The payment could not be verified.'),
          });
          return;
        }

        if (paymentStatus === 'success') {
          if (paymentUpdate?.updated === false && paymentUpdate?.reason === 'invalid_status_transition') {
            setNotice({
              tone: 'warning',
              title: 'Payment verified but not applied',
              message: 'Payment succeeded, but the request is not in a payable state yet. Please contact support.',
            });
            return;
          }

          setIsSuccess(true);
          setNotice({
            tone: 'success',
            title: 'Payment confirmed',
            message: 'Your payment was verified and the request has been marked as paid.',
          });
          return;
        }

        if (paymentStatus === 'abandoned') {
          setNotice({
            tone: 'warning',
            title: 'Payment not completed',
            message: 'Checkout was opened, but the transaction was not completed. You can go back and try again.',
          });
          return;
        }

        setNotice({
          tone: 'info',
          title: 'Payment pending',
          message: formatApiMessage({ message: data?.data?.gateway_response, requestId: data?.requestId }, 'The payment is not complete yet.'),
        });
      } catch (error) {
        setNotice({
          tone: 'error',
          title: 'Verification error',
          message: error.message || 'An unexpected error occurred during verification.',
        });
      } finally {
        setIsLoading(false);
      }
    };

    verifyPayment();
  }, [reference, requestId]);

  return (
    <ScreenShell
      eyebrow="PAYMENT RETURN"
      title="Payment Status"
      subtitle="Review the verification result from your Paystack checkout."
      accentColor="#1f2937"
      accentTextColor="#dbeafe"
      backgroundColor="#f4f6f8"
    >
      <AppCard
        style={{
          borderRadius: 20,
          padding: 24,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 20,
          elevation: 6,
        }}
      >
        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />

        <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
          Reference: {reference || 'Unavailable'}
        </Text>

        {isLoading ? <ActivityIndicator size="large" color="#2563eb" /> : null}

        <AppButton
          label="Back To Home"
          variant={isSuccess ? 'success' : 'primary'}
          onPress={() => router.replace('/home')}
          style={{ marginTop: 24, marginBottom: 12 }}
        />

        <AppButton
          label="Back To Payment Screen"
          variant="neutral"
          onPress={() => router.replace({
            pathname: '/pay',
            params: {
              id: requestId,
              reference,
            },
          })}
        />
      </AppCard>
    </ScreenShell>
  );
}