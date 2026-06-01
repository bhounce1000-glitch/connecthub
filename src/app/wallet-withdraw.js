import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || API_BASE_URL || 'https://connecthub-yrox.onrender.com';

const WITHDRAWAL_PENDING_WINDOW_HOURS = 24;

const NETWORKS = [
  { label: 'MTN', value: 'MTN', code: 'mtn' },
  { label: 'Telecel (Vodafone)', value: 'Telecel (Vodafone)', code: 'vod' },
  { label: 'AirtelTigo', value: 'AirtelTigo', code: 'atl' },
];

const toMs = (value) => {
  if (!value) return 0;
  if (value?.seconds) return value.seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const isBlockingPendingWithdrawal = (withdrawal) => {
  const status = String(withdrawal?.status || '').toUpperCase();
  if (['PENDING_ADMIN_APPROVAL', 'PENDING', 'PROCESSING'].includes(status)) {
    return true;
  }
  return false;
};

const getWithdrawErrorMessage = (errorPayload) => {
  const errorCode = errorPayload?.code || errorPayload?.error;
  const paystackMessage = String(errorPayload?.details?.paystack?.message || errorPayload?.message || '').trim();
  const hint = String(errorPayload?.details?.hint || '').trim();
  switch (errorCode) {
    case 'invalid_phone':
      return 'Enter a valid 10-digit Ghana number starting with 0';
    case 'insufficient_balance':
      return 'Insufficient wallet balance';
    case 'invalid_amount':
      return 'Minimum withdrawal is GHS 10';
    case 'recipient_creation_failed':
      if (paystackMessage && hint) {
        return `${paystackMessage} ${hint}`;
      }
      if (paystackMessage) {
        return paystackMessage;
      }
      return 'Could not verify your MoMo wallet for payout. Check number, selected network, and wallet status.';
    case 'paystack_insufficient_balance':
      return 'Withdrawal is blocked because Paystack balance is insufficient. Top up your Paystack balance and try again.';
    case 'paystack_business_tier_restricted':
      return 'Your Paystack account is on Starter business tier and cannot do third-party payouts. Upgrade your Paystack business tier and enable Transfers, then try again.';
    case 'transfer_disabled':
      return 'Withdrawal transfers are disabled on Paystack. Enable Transfers in your Paystack dashboard settings.';
    case 'transfer_otp_required':
      return 'Paystack transfer finalization/OTP is required. Complete transfer settings in Paystack before retrying.';
    case 'transfer_pending_approval':
      return 'Paystack transfer capability is pending approval. Complete compliance verification in Paystack.';
    case 'kyc_required':
      return 'Complete KYC verification before withdrawing';
    case 'server_error':
      return 'Something went wrong. Please try again.';
    case 'transfer_failed':
      if (paystackMessage && hint) {
        return `${paystackMessage} ${hint}`;
      }
      if (paystackMessage) {
        return paystackMessage;
      }
      return 'Transfer could not be processed. Please try again.';
    default:
      if (paystackMessage) {
        return paystackMessage;
      }
      return errorPayload?.message || 'Withdrawal failed. Please try again.';
  }
};

export default function WalletWithdraw() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [network, setNetwork] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [kycVerified, setKycVerified] = useState(false);
  const [hasPendingWithdrawal, setHasPendingWithdrawal] = useState(false);
  const [withdrawalReference, setWithdrawalReference] = useState('');
  const [withdrawalSuccess, setWithdrawalSuccess] = useState(false);

  useEffect(() => {
    const loadGuards = async () => {
      const email = String(user?.email || '').trim().toLowerCase();
      if (!email) return;

      const userDoc = await getDoc(doc(db, 'users', email));

      const balance = Number(userDoc.data()?.walletBalance || 0);

      const kyc = String(userDoc.data()?.kycStatus || '').toLowerCase();

      setWalletBalance(Number.isFinite(balance) ? balance : 0);
      setKycVerified(kyc === 'verified');
    };
    loadGuards().catch(() => {});
  }, [user?.email]);

  useEffect(() => {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) {
      return undefined;
    }

    const unsub = onSnapshot(doc(db, 'users', email), (snap) => {
      const nextBalance = snap.exists() ? Number(snap.data()?.walletBalance || 0) : 0;
      setWalletBalance(Number.isFinite(nextBalance) ? nextBalance : 0);
    });

    return unsub;
  }, [user?.email]);

  useEffect(() => {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) {
      setHasPendingWithdrawal(false);
      return undefined;
    }

    const unsub = onSnapshot(
      query(collection(db, 'withdrawals'), where('email', '==', email)),
      (snap) => {
        const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setHasPendingWithdrawal(rows.some(isBlockingPendingWithdrawal));
      },
      () => {
        setHasPendingWithdrawal(false);
      }
    );

    return unsub;
  }, [user?.email]);

  const disableReason = useMemo(() => {
    if (walletBalance < 10) return 'Withdrawal disabled: available balance is below GHS 10.';
    if (!kycVerified) return 'Withdrawal disabled: complete KYC verification first.';
    if (hasPendingWithdrawal) return 'Withdrawal disabled: you already have a pending withdrawal.';
    return '';
  }, [walletBalance, kycVerified, hasPendingWithdrawal]);

  const submitWithdrawal = async () => {
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount < 10) {
      setNotice({ tone: 'warning', title: 'Invalid amount', message: 'Minimum withdrawal amount is GHS 10.00.' });
      return;
    }
    if (!network) {
      setNotice({ tone: 'warning', title: 'Select network', message: 'Please select your Mobile Money network.' });
      return;
    }
    if (!phoneNumber.trim()) {
      setNotice({ tone: 'warning', title: 'Missing details', message: 'Mobile Money phone number is required.' });
      return;
    }
    if (!accountName.trim()) {
      setNotice({ tone: 'warning', title: 'Missing details', message: 'Account name is required.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    setWithdrawalSuccess(false);
    setWithdrawalReference('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Please sign in again to submit a withdrawal request.');
      }

      const response = await fetch(`${API_BASE}/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          amount: numericAmount,
          accountName: accountName.trim(),
          phoneNumber: phoneNumber.trim(),
          provider: network,
        }),
      });

      const data = await response.json();
      if (!(response.ok && (data?.success === true || data?.status === true))) {
        const errorMessage = String(data?.error || data?.message || 'Withdrawal failed. Please try again.').trim();
        setNotice({ tone: 'error', title: 'Withdrawal failed', message: errorMessage });
        return;
      }

      const result = data?.data || data;
      const ref = String(result?.reference || result?.withdrawalId || 'PENDING').trim();
      setWithdrawalReference(ref);
      setWithdrawalSuccess(true);
      setNotice({
        tone: 'success',
        title: 'Withdrawal Request Received!',
        message: `Reference: ${ref}`,
      });

      setAmount('');
      setAccountName('');
      setPhoneNumber('');
      setNetwork('');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Withdrawal failed',
        message: error?.message || 'Could not submit withdrawal.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell
      eyebrow="WALLET"
      title="Withdraw Funds"
      subtitle="Withdrawals are processed manually within 24 hours. You will receive a notification when complete."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ color: '#64748b', marginBottom: 16, fontSize: 12 }}>
          Withdrawals are processed <Text style={{ fontWeight: '700', color: '#166534' }}>manually within 24 hours</Text>. Minimum GHS 10.00. KYC required.
        </Text>

        {withdrawalSuccess ? (
          <View style={{ margin: 16, backgroundColor: '#f0fdf4', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#bbf7d0', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 40 }}>✅</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center' }}>
              Withdrawal Request Received!
            </Text>
            <Text style={{ fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 21 }}>
              Your withdrawal will be processed within 24 hours. You will receive a notification and email when complete.
            </Text>
            <Text style={{ fontSize: 11, color: '#94a3b8' }}>Reference: {withdrawalReference}</Text>
            <Pressable
              style={{ backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 }}
              onPress={() => router.replace('/wallet')}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>View Wallet →</Text>
            </Pressable>
          </View>
        ) : null}

        <AppInput
          label="Amount (GHS)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="10"
          editable={!isSubmitting}
        />

        {/* Network selector */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 4 }}>
          Mobile Money Network
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {NETWORKS.map(n => {
            const selected = network === n.value;
            return (
              <Pressable
                key={n.value}
                onPress={() => {
                  if (!isSubmitting) {
                    setNetwork(n.value);
                  }
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: selected ? '#2563eb' : '#cbd5e1',
                  backgroundColor: selected ? '#dbeafe' : '#f8fafc',
                  opacity: isSubmitting ? 0.55 : 1,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: selected ? '700' : '500', color: selected ? '#1e3a8a' : '#64748b' }}>
                  {n.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <AppInput
          label="MoMo Number (e.g. 0241234567)"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          maxLength={12}
          placeholder="e.g. 0241234567"
          editable={!isSubmitting}
        />
        <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: -10, marginBottom: 12 }}>
          Enter your 10-digit Ghana number starting with 0 (not country code).
        </Text>

        <AppInput
          label="Account Name (as registered on MoMo)"
          value={accountName}
          onChangeText={setAccountName}
          placeholder="John Mensah"
          editable={!isSubmitting}
        />

        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

        <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          Available balance: GHS {walletBalance.toFixed(2)}
        </Text>

        <AppButton
          label={isSubmitting ? 'Submitting...' : 'Confirm Withdrawal'}
          onPress={submitWithdrawal}
          loading={isSubmitting}
          disabled={isSubmitting || Boolean(disableReason)}
          style={{ backgroundColor: '#2563eb' }}
        />

        {disableReason ? (
          <Text style={{ marginTop: 8, color: '#b45309', fontSize: 12 }}>{disableReason}</Text>
        ) : null}

        <AppButton
          label="Back to Wallet"
          variant="neutral"
          onPress={() => router.replace('/wallet')}
          style={{ marginTop: 10 }}
        />
      </AppCard>

      <View style={{ marginTop: 12 }}>
        <Text style={{ color: '#64748b', fontSize: 12, textAlign: 'center' }}>
          Funds are sent instantly via Paystack Transfer. You&apos;ll receive a push notification and email when complete.{'\n\n'}
          <Text style={{ color: '#2563eb', textDecorationLine: 'underline' }} onPress={() => router.push('/withdrawal-history')}>
            View withdrawal history →
          </Text>
        </Text>
      </View>
    </ScreenShell>
  );
}
