import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';

export default function PayReturn() {
  const router = useRouter();
  const { id, reference: referenceParam, trxref } = useLocalSearchParams();
  const [status, setStatus] = useState('Verifying payment...');
  const [details, setDetails] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [statusTone, setStatusTone] = useState('pending');
  const hasVerified = useRef(false);

  const requestId = Array.isArray(id) ? id[0] : id;
  const reference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);

  useEffect(() => {
    if (!reference || hasVerified.current) {
      if (!reference) {
        setStatus('No payment reference found');
        setDetails('Return here after checkout so the payment can be verified.');
        setStatusTone('missing');
        setIsLoading(false);
      }
      return;
    }

    hasVerified.current = true;

    const verifyPayment = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/pay/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reference }),
        });

        const data = await response.json();
        const paymentStatus = data?.data?.status;
        const resolvedRequestId = data?.data?.metadata?.requestId || requestId;

        if (!response.ok || !data?.status) {
          setStatus('Verification request failed');
          setDetails(data?.message || data?.error || 'The payment could not be verified.');
          setStatusTone('error');
          return;
        }

        if (paymentStatus === 'success') {
          if (resolvedRequestId) {
            await updateDoc(doc(db, 'requests', resolvedRequestId), {
              paid: true,
              status: 'paid',
            });
          }

          setIsSuccess(true);
          setStatusTone('success');
          setStatus('Payment confirmed');
          setDetails('Your payment was verified and the request has been marked as paid.');
          return;
        }

        if (paymentStatus === 'abandoned') {
          setStatusTone('abandoned');
          setStatus('Payment not completed');
          setDetails('Checkout was opened, but the transaction was not completed. You can go back and try again.');
          return;
        }

        setStatusTone('pending');
        setStatus('Payment pending');
        setDetails(data?.data?.gateway_response || 'The payment is not complete yet.');
      } catch (error) {
        setStatusTone('error');
        setStatus('Verification error');
        setDetails(error.message || 'An unexpected error occurred during verification.');
      } finally {
        setIsLoading(false);
      }
    };

    verifyPayment();
  }, [reference, requestId]);

  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: '#f4f6f8', justifyContent: 'center' }}>
      <View
        style={{
          backgroundColor: 'white',
          borderRadius: 20,
          padding: 24,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 20,
          elevation: 6,
        }}
      >
        <Text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 16 }}>
          Payment Status
        </Text>

        <View
          style={{
            alignSelf: 'flex-start',
            backgroundColor:
              statusTone === 'success'
                ? '#dcfce7'
                : statusTone === 'abandoned'
                  ? '#fee2e2'
                  : statusTone === 'error'
                    ? '#fef2f2'
                    : statusTone === 'missing'
                      ? '#e5e7eb'
                      : '#dbeafe',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 6,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color:
                statusTone === 'success'
                  ? '#166534'
                  : statusTone === 'abandoned'
                    ? '#b91c1c'
                    : statusTone === 'error'
                      ? '#991b1b'
                      : statusTone === 'missing'
                        ? '#374151'
                        : '#1d4ed8',
              fontWeight: '700',
            }}
          >
            {statusTone === 'success'
              ? 'PAID'
              : statusTone === 'abandoned'
                ? 'ABANDONED'
                : statusTone === 'error'
                  ? 'ERROR'
                  : statusTone === 'missing'
                    ? 'MISSING'
                    : 'PENDING'}
          </Text>
        </View>

        <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>
          {status}
        </Text>

        <Text style={{ fontSize: 15, color: '#4b5563', marginBottom: 12 }}>
          {details}
        </Text>

        <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
          Reference: {reference || 'Unavailable'}
        </Text>

        {isLoading ? <ActivityIndicator size="large" color="#2563eb" /> : null}

        <TouchableOpacity
          style={{
            backgroundColor: isSuccess ? '#16a34a' : '#2563eb',
            padding: 14,
            borderRadius: 10,
            marginTop: 24,
            marginBottom: 12,
          }}
          onPress={() => router.replace('/home')}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
            Back To Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#111827',
            padding: 14,
            borderRadius: 10,
          }}
          onPress={() => router.replace({
            pathname: '/pay',
            params: {
              id: requestId,
              reference,
            },
          })}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
            Back To Payment Screen
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}