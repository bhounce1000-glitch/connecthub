import { useRouter } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { auth, db } from '../firebase';

// ─── Paystack payment page ────────────────────────────────────────────────────
// Go to dashboard.paystack.com → Payment Pages and find/create a page for wallet
// top-ups. Copy the slug from the page URL and set it here.
// Page URL: https://paystack.shop/pay/connecthub-topup
const PAYSTACK_PAGE_SLUG = 'connecthub-topup';

// Callback URL — Paystack redirects here after payment with ?reference=...&trxref=...
const CALLBACK_URL = 'https://connecthub-1873e.web.app/wallet-topup-return';
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_AMOUNTS = [10, 50, 100, 200, 500, 1000];

export default function WalletTopup() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

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
      // 1. Generate a unique reference on the client — used as Firestore doc ID
      //    and passed to Paystack so we can verify it after payment.
      const reference = `topup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const amountPesewas = Math.round(parsedAmount * 100);

      // 2. Pre-register the topup in Firestore BEFORE opening Paystack.
      //    The server's /wallet/topup/verify will look up this record when
      //    Paystack metadata isn't present (payment page flow).
      await setDoc(doc(db, 'wallet_topups', reference), {
        reference,
        email: user.email,
        amountGHS: parsedAmount,
        amountPesewas,
        status: 'pending',
        source: 'client_initiated',
        createdAt: serverTimestamp(),
      });

      // 3. Build the Paystack payment page URL.
      //    Paystack will redirect to CALLBACK_URL?reference={reference}&trxref={reference}
      //    after the user pays. wallet-topup-return.js handles that redirect.
      const paystackUrl = [
        `https://paystack.shop/pay/${PAYSTACK_PAGE_SLUG}`,
        `?amount=${amountPesewas}`,
        `&email=${encodeURIComponent(user.email)}`,
        `&ref=${reference}`,
        `&callback_url=${encodeURIComponent(CALLBACK_URL)}`,
      ].join('');

      // 4. Open Paystack — on web redirect in-tab, on native use system browser.
      if (Platform.OS === 'web') {
        window.location.href = paystackUrl;
      } else {
        const canOpen = await Linking.canOpenURL(paystackUrl);
        if (!canOpen) throw new Error('Cannot open Paystack. Please try again.');
        await Linking.openURL(paystackUrl);
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error.message || 'Could not start payment. Please try again or contact connecthub1000@gmail.com',
      });
      setIsSubmitting(false);
    }
    // Note: setIsSubmitting(false) is intentionally NOT called on success —
    // the page is about to navigate away to Paystack, so there's no need.
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={s.backBtn}>
          <Text style={s.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Add Money</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Hero card */}
      <View style={s.hero}>
        <Text style={s.heroEmoji}>💳</Text>
        <Text style={s.heroTitle}>Fund Your Wallet</Text>
        <Text style={s.heroSub}>
          Pay securely with Paystack — Mobile Money (MoMo)
        </Text>
      </View>

      {/* Amount input */}
      <View style={s.card}>
        <Text style={s.label}>Enter Amount (GHS)</Text>
        <View style={s.inputRow}>
          <Text style={s.currencyBadge}>GHS</Text>
          <TextInput
            style={s.amountInput}
            value={amount}
            onChangeText={(v) => {
              setNotice(null);
              setAmount(v.replace(/[^0-9.]/g, ''));
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#94a3b8"
            maxLength={8}
          />
        </View>

        <Text style={s.quickLabel}>Quick select</Text>
        <View style={s.quickRow}>
          {QUICK_AMOUNTS.map((q) => (
            <TouchableOpacity
              key={q}
              style={[s.chip, amount === String(q) && s.chipActive]}
              onPress={() => { setAmount(String(q)); setNotice(null); }}
              activeOpacity={0.75}
            >
              <Text style={[s.chipText, amount === String(q) && s.chipTextActive]}>
                {q}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notice */}
      {notice && (
        <View style={[s.notice, notice.tone === 'warning' && s.noticeWarning]}>
          <Text style={[s.noticeText, notice.tone === 'warning' && s.noticeTextWarning]}>
            {notice.tone === 'error' ? '⚠️  ' : 'ℹ️  '}{notice.message}
          </Text>
        </View>
      )}

      {/* Info */}
      <View style={s.infoBox}>
        <Text style={s.infoText}>
          🛡️  Funds are credited to your wallet immediately after successful payment verification.
        </Text>
      </View>

      {/* CTA */}
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
            {parsedAmount >= 1
              ? `Pay GHS ${parsedAmount.toFixed(2)} →`
              : 'Enter an amount to continue'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={s.secureNote}>
        🔒 Secured by Paystack — your card details are never stored by ConnectHub
      </Text>
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
});

