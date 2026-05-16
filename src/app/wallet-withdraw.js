import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';

const NETWORKS = [
  { label: 'MTN', value: 'MTN', code: 'mtn' },
  { label: 'Telecel (Vodafone)', value: 'Telecel (Vodafone)', code: 'vod' },
  { label: 'AirtelTigo', value: 'AirtelTigo', code: 'atl' },
];

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

  useEffect(() => {
    const loadGuards = async () => {
      const email = String(user?.email || '').trim().toLowerCase();
      const uid = String(user?.uid || '').trim();
      if (!email) return;

      const walletByUid = uid ? await getDoc(doc(db, 'wallets', uid)) : null;
      const walletByEmail = await getDoc(doc(db, 'wallets', email));
      const userDoc = await getDoc(doc(db, 'users', email));

      const balance = walletByUid?.exists()
        ? Number(walletByUid.data()?.balance || walletByUid.data()?.walletBalance || 0)
        : walletByEmail.exists()
          ? Number(walletByEmail.data()?.balance || walletByEmail.data()?.walletBalance || 0)
          : Number(userDoc.data()?.walletBalance || 0);

      const kyc = String(userDoc.data()?.kycStatus || '').toLowerCase();
      const pendingSnap = await getDocs(query(collection(db, 'withdrawals'), where('email', '==', email), where('status', 'in', ['pending', 'pending_admin_approval', 'processing', 'manual_review'])));

      setWalletBalance(Number.isFinite(balance) ? balance : 0);
      setKycVerified(kyc === 'verified');
      setHasPendingWithdrawal(!pendingSnap.empty);
    };
    loadGuards().catch(() => {});
  }, [user?.email, user?.uid]);

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
    try {
      const payload = {
        amount: numericAmount,
        accountName: accountName.trim(),
        phoneNumber: phoneNumber.trim(),
        provider: network,
        network,
      };
      const { response, data } = await apiPost(`${API_BASE_URL}/wallet/withdraw`, payload, { requireAuth: true });
      if (!response.ok || !data?.status) {
        const mappedMessage = getWithdrawErrorMessage(data);
        const requestId = data?.requestId ? `\n\nRequest ID: ${data.requestId}` : '';
        setNotice({ tone: 'error', title: 'Withdrawal failed', message: `${mappedMessage}${requestId}` });
        return;
      }

      const result = data;
      const withdrawnAmount = Number(result?.data?.amount || numericAmount || 0);
      const targetPhone = result?.data?.phoneNumber || phoneNumber.trim();
      const targetProvider = result?.data?.provider || network;
      const ref = result?.data?.reference || 'N/A';
      const isQueued = result?.data?.status === 'queued';

      const alertTitle = isQueued ? '✅ Withdrawal Received!' : '✅ Withdrawal Initiated!';
      const alertBody = isQueued
        ? `GHS ${withdrawnAmount.toFixed(2)} has been deducted and your withdrawal to ${targetProvider} (${targetPhone}) is queued for processing.\n\nYou will be notified once the money is sent.\n\nReference: ${ref}`
        : `GHS ${withdrawnAmount.toFixed(2)} is being sent instantly to your ${targetProvider} account (${targetPhone}).\n\nYou will be notified once the money lands.\n\nReference: ${ref}`;

      setNotice({ tone: 'success', title: alertTitle, message: `Reference: ${ref}` });
      Alert.alert(alertTitle, alertBody, [
        {
          text: 'OK',
          onPress: () => router.replace(`/wallet?refresh=${Date.now()}`),
        },
      ]);
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
      subtitle="Funds are sent instantly to your Mobile Money. Minimum GHS 10."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ color: '#64748b', marginBottom: 16, fontSize: 12 }}>
          Funds are sent <Text style={{ fontWeight: '700', color: '#166534' }}>instantly</Text> via Paystack. Minimum GHS 10.00. KYC required.
        </Text>

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
