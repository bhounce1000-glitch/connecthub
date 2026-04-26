import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { API_BASE_URL } from '../constants/api';
import { AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

export default function Pay() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const { id, amount, email, reference: referenceParam, trxref } = useLocalSearchParams();
  const [isInitializing, setIsInitializing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [reference, setReference] = useState('');
  const [notice, setNotice] = useState(null);
  const [requestState, setRequestState] = useState({
    isLoading: true,
    isPaid: false,
    status: null,
    paymentReference: null,
  });
  const callbackAttempted = useRef(false);

  const requestId = Array.isArray(id) ? id[0] : id;
  const payerEmail = Array.isArray(email) ? email[0] : email;
  const numericAmount = Number(Array.isArray(amount) ? amount[0] : amount || 0);
  const callbackReference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);
  const hasPendingReference = Boolean(reference || callbackReference);

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    let isMounted = true;

    const readRequestState = async () => {
      if (!requestId) {
        if (isMounted) {
          setRequestState({
            isLoading: false,
            isPaid: false,
            status: null,
            paymentReference: null,
          });
        }
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, 'requests', requestId));
        const row = snapshot.exists() ? snapshot.data() : {};
        const status = row?.status || null;
        const isPaid = Boolean(row?.paid) || status === 'paid';

        if (isMounted) {
          setRequestState({
            isLoading: false,
            isPaid,
            status,
            paymentReference: row?.paymentReference || null,
          });

          if (isPaid) {
            setNotice({
              tone: 'success',
              title: 'Already paid',
              message: 'This request is already marked as paid. You can return to home.',
            });
          }
        }
      } catch {
        if (isMounted) {
          setRequestState((previous) => ({
            ...previous,
            isLoading: false,
          }));
        }
      }
    };

    readRequestState();

    return () => {
      isMounted = false;
    };
  }, [requestId]);

  const verifyPayment = useCallback(async (targetReference = reference) => {
    if (isVerifying) {
      return;
    }

    if (!targetReference) {
      setNotice({
        tone: 'warning',
        title: 'Missing reference',
        message: 'Start a payment first so there is a reference to verify.',
      });
      return;
    }

    setIsVerifying(true);
    setNotice(null);

    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/pay/verify`, { reference: targetReference }, { requireAuth: true });

      if (!response.ok || !data?.status || data?.data?.status !== 'success') {
        setNotice({
          tone: 'error',
          title: 'Verification failed',
          message: formatApiMessage(data, 'Payment is not verified yet.'),
        });
        return;
      }

      const paymentUpdate = data?.paymentUpdate;

      if (paymentUpdate?.updated === false && paymentUpdate?.reason === 'invalid_status_transition') {
        setNotice({
          tone: 'warning',
          title: 'Payment verified but not applied',
          message: 'Payment is successful but this request is not in a payable state yet. Contact support if this is unexpected.',
        });
        return;
      }

      setNotice({
        tone: 'success',
        title: 'Payment confirmed',
        message: 'The request has been marked as paid.',
      });
      setRequestState((previous) => ({
        ...previous,
        isPaid: true,
        status: 'paid',
        paymentReference: targetReference,
      }));
      router.replace('/home');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Verification error',
        message: error.message || 'Could not verify the payment.',
      });
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, reference, router]);

  useEffect(() => {
    if (!callbackReference || callbackAttempted.current) {
      return;
    }

    callbackAttempted.current = true;
    setReference(callbackReference);
    verifyPayment(callbackReference);
  }, [callbackReference, verifyPayment]);

  const handlePayment = async () => {
    if (isInitializing) {
      return;
    }

    if (requestState.isPaid) {
      setNotice({
        tone: 'success',
        title: 'Already paid',
        message: 'This request has already been paid and does not need a new checkout.',
      });
      return;
    }

    if (hasPendingReference) {
      setNotice({
        tone: 'warning',
        title: 'Checkout already started',
        message: 'A payment reference already exists for this request. Verify that reference before starting a new checkout.',
      });
      return;
    }

    if (!requestId || !payerEmail || !numericAmount) {
      setNotice({
        tone: 'warning',
        title: 'Missing payment data',
        message: 'Request, amount, or email is missing.',
      });
      return;
    }

    setIsInitializing(true);
    setNotice(null);

    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/pay`, {
        email: payerEmail,
        amount: numericAmount,
        requestId,
      }, { requireAuth: true });

      if (!response.ok || !data?.status || !data?.data?.authorization_url) {
        setNotice({
          tone: 'error',
          title: 'Payment failed',
          message: formatApiMessage(data, 'Could not initialize payment.'),
        });
        return;
      }

      setReference(data.data.reference || '');

      const checkoutUrl = data.data.authorization_url;

      // On web, window.location.href is the only reliable way to open Paystack
      // because Linking.openURL calls window.open() which browsers block when
      // invoked after an await (not a direct user gesture). Same-tab navigation
      // is fine because Paystack redirects back to our callback_url.
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = checkoutUrl;
      } else {
        await Linking.openURL(checkoutUrl);
      }

      setNotice({
        tone: 'info',
        title: 'Redirecting to Paystack',
        message: 'You will be sent to Paystack to complete payment. After paying, you will be returned here automatically.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Server error',
        message: error.message || 'Unable to reach the payment server.',
      });
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <FormScreen
      eyebrow="CHECKOUT"
      title="Paystack Payment"
      subtitle="Secure payment powered by Paystack. Start checkout, then verify the reference on return."
      accentColor="#9a3412"
      accentTextColor="#ffedd5"
      backgroundColor="#fff7ed"
      cardStyle={{
        padding: 22,
        borderRadius: 22,
        borderColor: '#fed7aa',
        shadowColor: '#9a3412',
        shadowOpacity: 0.11,
        shadowRadius: 14,
        elevation: 5,
      }}
    >
        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />

        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 14, color: '#7c2d12' }}>
          Payment Details
        </Text>

        <Text style={{ fontSize: 14, color: '#7c2d12', marginBottom: 6 }}>
          Request ID: {requestId || 'Unavailable'}
        </Text>

        <Text style={{ fontSize: 14, color: '#7c2d12', marginBottom: 6 }}>
          Email: {payerEmail || 'Unavailable'}
        </Text>

        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8, color: '#111827' }}>
          Amount: GHS {Number.isFinite(numericAmount) ? numericAmount : 0}
        </Text>

        <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 22 }}>
          Reference: {reference || callbackReference || 'Not started'}
        </Text>

        {requestState.paymentReference ? (
          <Text style={{ fontSize: 13, color: '#166534', marginBottom: 12 }}>
            Existing payment reference: {requestState.paymentReference}
          </Text>
        ) : null}

        <AppButton
          label="Open Paystack Checkout"
          variant="success"
          onPress={handlePayment}
          disabled={!requestId || !payerEmail || !numericAmount || requestState.isPaid || hasPendingReference || isInitializing || isVerifying}
          loading={isInitializing}
          style={{ marginBottom: AppSpace.sm, backgroundColor: '#15803d', borderRadius: 12 }}
        />

        <AppButton
          label="Verify Payment"
          variant="primary"
          onPress={() => verifyPayment()}
          disabled={requestState.isPaid || (!reference && !callbackReference) || isInitializing || isVerifying}
          loading={isVerifying}
          style={{ borderRadius: 12 }}
        />
    </FormScreen>
  );
}