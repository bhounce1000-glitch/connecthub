import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';

export default function Pay() {
  const router = useRouter();
  const { id, amount, email, reference: referenceParam, trxref } = useLocalSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState('');
  const callbackAttempted = useRef(false);

  const requestId = Array.isArray(id) ? id[0] : id;
  const payerEmail = Array.isArray(email) ? email[0] : email;
  const numericAmount = Number(Array.isArray(amount) ? amount[0] : amount || 0);
  const callbackReference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);

  const markPaid = useCallback(async (resolvedRequestId = requestId) => {
    if (!resolvedRequestId) {
      Alert.alert('Missing request', 'Payment was verified but the request id is unavailable.');
      return;
    }

    await updateDoc(doc(db, 'requests', resolvedRequestId), {
      paid: true,
      status: 'paid',
    });

    Alert.alert('Payment confirmed', 'The request has been marked as paid.');
    router.replace('/home');
  }, [requestId, router]);

  const verifyPayment = useCallback(async (targetReference = reference) => {
    if (!targetReference) {
      Alert.alert('Missing reference', 'Start a payment first so there is a reference to verify.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/pay/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference: targetReference }),
      });

      const data = await response.json();

      if (!response.ok || !data?.status || data?.data?.status !== 'success') {
        Alert.alert('Verification failed', data?.message || data?.error || 'Payment is not verified yet.');
        return;
      }

      const resolvedRequestId = data?.data?.metadata?.requestId || requestId;
      await markPaid(resolvedRequestId);
    } catch (error) {
      Alert.alert('Verification error', error.message || 'Could not verify the payment.');
    } finally {
      setIsSubmitting(false);
    }
  }, [markPaid, reference, requestId]);

  useEffect(() => {
    if (!callbackReference || callbackAttempted.current) {
      return;
    }

    callbackAttempted.current = true;
    setReference(callbackReference);
    verifyPayment(callbackReference);
  }, [callbackReference, verifyPayment]);

  const handlePayment = async () => {
    if (!requestId || !payerEmail || !numericAmount) {
      Alert.alert('Missing payment data', 'Request, amount, or email is missing.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: payerEmail,
          amount: numericAmount,
          requestId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.status || !data?.data?.authorization_url) {
        Alert.alert('Payment failed', data?.message || data?.error || 'Could not initialize payment.');
        return;
      }

      setReference(data.data.reference || '');
      await Linking.openURL(data.data.authorization_url);
      Alert.alert('Payment page opened', 'Complete the payment, then verify it on this screen.');
    } catch (error) {
      Alert.alert('Server error', error.message || 'Unable to reach the payment server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: '#f4f6f8', justifyContent: 'center' }}>
      <Text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 12 }}>
        Complete Payment
      </Text>

      <Text style={{ fontSize: 16, color: '#4b5563', marginBottom: 8 }}>
        Request ID: {requestId || 'Unavailable'}
      </Text>

      <Text style={{ fontSize: 16, color: '#4b5563', marginBottom: 8 }}>
        Email: {payerEmail || 'Unavailable'}
      </Text>

      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>
        Amount: ${Number.isFinite(numericAmount) ? numericAmount : 0}
      </Text>

      <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
        Reference: {reference || callbackReference || 'Not started'}
      </Text>

      <TouchableOpacity
        style={{
          backgroundColor: isSubmitting ? '#9ca3af' : '#16a34a',
          padding: 14,
          borderRadius: 10,
          marginBottom: 12,
        }}
        onPress={handlePayment}
        disabled={isSubmitting}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
          {isSubmitting ? 'Working...' : 'Open Paystack Checkout'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{
          backgroundColor: isSubmitting ? '#9ca3af' : '#2563eb',
          padding: 14,
          borderRadius: 10,
        }}
        onPress={() => verifyPayment()}
        disabled={isSubmitting}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
          Verify Payment
        </Text>
      </TouchableOpacity>
    </View>
  );
}