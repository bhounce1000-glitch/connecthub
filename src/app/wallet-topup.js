import * as ExpoLinking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { API_BASE_URL, WEB_BASE_URL } from '../constants/api';
import { auth } from '../firebase';
import { apiPost } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

const TOPUP_API_BASE = Platform.OS === 'web' ? '/api' : API_BASE_URL;
const CALLBACK_URL = Platform.OS === 'web'
  ? `${WEB_BASE_URL}/wallet-topup-return`
  : ExpoLinking.createURL('/wallet-topup-return');

const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500];

export default function WalletTopup() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingReference, setPendingReference] = useState('');
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const parsedAmount = Number(amount || 0);

  const handleTopup = async () => {
    setNotice(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
      setNotice({ tone: 'warning', message: 'Enter an amount of at least GHS 1.00.' });
      return;
    }
    if (parsedAmount > 10000) {
      setNotice({ tone: 'warning', message: 'Maximum single top-up is GHS 10,000.' });
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setNotice({ tone: 'error', message: 'You must be signed in. Please log in and try again.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const { response, data } = await apiPost(
        `${TOPUP_API_BASE}/wallet/topup`,
        { amount: parsedAmount, callbackUrl: CALLBACK_URL },
        { requireAuth: true }
      );

      if (!response.ok || !data?.status || !data?.data?.authorization_url) {
        throw new Error(formatApiMessage(data, 'Could not start payment. Please try again.'));
      }

      const checkoutUrl = String(data.data.authorization_url || '').trim();
      const checkoutReference = String(data.data.reference || '').trim();
      setPendingReference(checkoutReference);

      if (Platform.OS === 'web') {
        window.location.href = checkoutUrl;
        return;
      }

      const canOpen = await Linking.canOpenURL(checkoutUrl);
      if (!canOpen) {
        throw new Error('Cannot open Paystack. Please try again.');
      }

      await Linking.openURL(checkoutUrl);
      setAwaitingReturn(true);
    } catch (error) {
      const message = String(error?.message || 'Could not start payment. Please try again or contact connecthub1000@gmail.com');
      setNotice({
        tone: 'error',
        message: /abort|fetch|network/i.test(message)
          ? 'Could not reach the payment server. If the server is waking up, wait about 30 seconds and try again.'
          : message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyReturn = async () => {
    if (!pendingReference) {
      setNotice({
        tone: 'warning',
        message: 'No pending payment reference was found. If you already paid, use the callback screen or contact support with your Paystack reference.',
      });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const { response, data } = await apiPost(
        `${TOPUP_API_BASE}/wallet/topup/verify`,
        { reference: pendingReference },
        { requireAuth: true }
      );

      if (!response.ok || !data?.status) {
        throw new Error(formatApiMessage(data, 'Payment is still being verified.'));
      }

      const amountValue = Number(data?.data?.amount || parsedAmount || 0);
      Alert.alert(
        'Wallet funded',
        `GHS ${amountValue.toFixed(2)} has been added to your ConnectHub wallet.`,
        [{ text: 'View Wallet', onPress: () => router.replace('/wallet') }]
      );
    } catch {
      Alert.alert(
        'Payment processing',
        `If you completed payment, your wallet will update automatically when Paystack confirms it. Reference: ${pendingReference}`,
        [
          { text: 'Check Wallet', onPress: () => router.replace('/wallet') },
          { text: 'Stay Here' },
        ]
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={s.backBtn}>
          <Text style={s.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Add Money</Text>
        <View style={{ width: 60 }} />
      </View>

      {awaitingReturn ? (
        <View style={s.awaitingCard}>
          <Text style={s.awaitingEmoji}>⏳</Text>
          <Text style={s.awaitingTitle}>Complete Payment on Paystack</Text>
          <Text style={s.awaitingSub}>
            Finish the checkout in your browser, then come back here and verify if the callback did not return automatically.
          </Text>
          <TouchableOpacity
            style={s.verifyBtn}
            onPress={handleVerifyReturn}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.verifyBtnText}>I Have Paid — Verify Now</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => {
              setAwaitingReturn(false);
              setPendingReference('');
              setNotice(null);
            }}
            activeOpacity={0.75}
          >
            <Text style={s.cancelBtnText}>I Did Not Pay — Go Back</Text>
          </TouchableOpacity>
          {pendingReference ? <Text style={s.refText}>Ref: {pendingReference}</Text> : null}
        </View>
      ) : (
        <>
          <View style={s.hero}>
            <Text style={s.heroEmoji}>💳</Text>
            <Text style={s.heroTitle}>Fund Your Wallet</Text>
            <Text style={s.heroSub}>
              Pay securely with Paystack. Your wallet updates automatically after Paystack confirms the payment.
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>Enter Amount (GHS)</Text>
            <View style={s.inputRow}>
              <Text style={s.currencyBadge}>GHS</Text>
              <TextInput
                style={s.amountInput}
                value={amount}
                onChangeText={(value) => {
                  setNotice(null);
                  setAmount(value.replace(/[^0-9.]/g, ''));
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#94a3b8"
                maxLength={8}
              />
            </View>

            <Text style={s.quickLabel}>Quick select</Text>
            <View style={s.quickRow}>
              {QUICK_AMOUNTS.map((quickAmount) => (
                <TouchableOpacity
                  key={quickAmount}
                  style={[s.chip, amount === String(quickAmount) && s.chipActive]}
                  onPress={() => {
                    setAmount(String(quickAmount));
                    setNotice(null);
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[s.chipText, amount === String(quickAmount) && s.chipTextActive]}>
                    GHS {quickAmount}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {notice && (
            <View style={[s.notice, notice.tone === 'warning' && s.noticeWarning]}>
              <Text style={[s.noticeText, notice.tone === 'warning' && s.noticeTextWarning]}>
                {notice.tone === 'error' ? '⚠️  ' : 'ℹ️  '}{notice.message}
              </Text>
            </View>
          )}

          <View style={s.infoBox}>
            <Text style={s.infoText}>
              Your wallet is credited automatically by webhook after Paystack confirms payment. Manual verify is available as a fallback.
            </Text>
          </View>

          <TouchableOpacity
            style={[s.payBtn, (!amount || isSubmitting) && s.payBtnDisabled]}
            onPress={handleTopup}
            disabled={!amount || isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.payBtnText}>
                {parsedAmount >= 1 ? `Pay GHS ${parsedAmount.toFixed(2)} →` : 'Enter an amount to continue'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={s.secureNote}>
            Secured by Paystack — ConnectHub never stores your card or MoMo details.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { paddingBottom: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: { padding: 4 },
  backBtnText: { fontSize: 15, color: '#1d4ed8', fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  hero: {
    backgroundColor: '#1e3a8a',
    margin: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  heroEmoji: { fontSize: 40 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  heroSub: { fontSize: 13, color: '#bfdbfe', textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  label: { fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1d4ed8',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  currencyBadge: {
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: '800',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRightWidth: 1.5,
    borderRightColor: '#1d4ed8',
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  quickLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 8 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#1d4ed8' },
  notice: {
    flexDirection: 'row',
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  noticeWarning: { backgroundColor: '#fef9c3', borderColor: '#fde047' },
  noticeText: { flex: 1, fontSize: 13, color: '#dc2626', lineHeight: 19, fontWeight: '500' },
  noticeTextWarning: { color: '#92400e' },
  infoBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 13, color: '#1d4ed8', lineHeight: 19, fontWeight: '500' },
  payBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    marginHorizontal: 16,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  payBtnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secureNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 16,
    paddingHorizontal: 24,
    lineHeight: 18,
  },
  awaitingCard: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 14,
  },
  awaitingEmoji: { fontSize: 48 },
  awaitingTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  awaitingSub: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 21 },
  verifyBtn: {
    backgroundColor: '#059669',
    borderRadius: 12,
    width: '100%',
    paddingVertical: 15,
    alignItems: 'center',
  },
  verifyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  cancelBtn: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    width: '100%',
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  refText: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' },
});

