import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { auth } from '../firebase';

// On web: same-origin via Firebase Hosting /api/** → walletProxy Cloud Function.
// On native: direct to Render (no browser CORS constraints).
const API_BASE = Platform.OS === 'web'
  ? ''
  : 'https://connecthub-yrox.onrender.com';

export default function WalletTopupReturn() {
  const router = useRouter();
  const { reference: referenceParam, trxref } = useLocalSearchParams();
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'failed'
  const [message, setMessage] = useState('');
  const [amountGhs, setAmountGhs] = useState(null);
  const hasVerified = useRef(false);

  const reference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);

  useEffect(() => {
    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found in the callback URL. If you were charged, contact support at connecthub1000@gmail.com');
      return;
    }
    if (hasVerified.current) return;
    hasVerified.current = true;
    verifyPayment(reference);
  }, [reference]);

  const verifyPayment = async (ref) => {
    setStatus('verifying');
    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus('failed');
        setMessage('You are not signed in. Please sign in and check your wallet balance.');
        return;
      }

      const token = await user.getIdToken();

      // Direct fetch — no AbortController, no retry wrapper
      const response = await fetch(`${API_BASE}/api/wallet/topup/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reference: ref }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.status) {
        throw new Error(data?.message || `Verification error ${response.status}. If you were charged, contact connecthub1000@gmail.com`);
      }

      const amount = Number(data?.data?.amount || 0);
      setAmountGhs(amount);
      setStatus('success');
      setMessage(`GHS ${amount.toFixed(2)} has been added to your ConnectHub wallet.`);
    } catch (error) {
      setStatus('failed');
      setMessage(error.message || 'Could not verify your payment. If you were charged, contact connecthub1000@gmail.com');
    }
  };

  if (status === 'verifying') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={s.verifyingText}>Verifying your payment…</Text>
        <Text style={s.verifyingSub}>This usually takes a few seconds.</Text>
      </View>
    );
  }

  return (
    <View style={s.center}>
      <Text style={s.icon}>{status === 'success' ? '✅' : '❌'}</Text>
      <Text style={[s.title, status === 'failed' && s.titleFailed]}>
        {status === 'success' ? 'Payment Successful!' : 'Payment Not Confirmed'}
      </Text>
      {amountGhs != null && status === 'success' && (
        <View style={s.amountBadge}>
          <Text style={s.amountBadgeText}>+GHS {amountGhs.toFixed(2)}</Text>
        </View>
      )}
      <Text style={s.message}>{message}</Text>
      <TouchableOpacity
        style={s.btn}
        onPress={() => router.replace('/wallet')}
        activeOpacity={0.85}
      >
        <Text style={s.btnText}>
          {status === 'success' ? 'View My Wallet →' : 'Go to Wallet'}
        </Text>
      </TouchableOpacity>
      {status === 'failed' && (
        <TouchableOpacity
          style={s.retryBtn}
          onPress={() => { hasVerified.current = false; verifyPayment(reference); }}
          activeOpacity={0.75}
        >
          <Text style={s.retryBtnText}>Try verifying again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    padding: 32,
    gap: 12,
  },
  icon: { fontSize: 64 },
  verifyingText: { fontSize: 16, color: '#0f172a', fontWeight: '700', marginTop: 16 },
  verifyingSub: { fontSize: 13, color: '#64748b' },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  titleFailed: { color: '#dc2626' },
  amountBadge: {
    backgroundColor: '#dcfce7',
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  amountBadgeText: { fontSize: 18, fontWeight: '800', color: '#166534' },
  message: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 21 },
  btn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  retryBtn: { marginTop: 4, padding: 8 },
  retryBtnText: { color: '#1d4ed8', fontSize: 14, fontWeight: '600' },
});

