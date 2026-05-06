import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiGet, apiPost } from '../utils/api-client';

const NETWORKS = [
  { label: 'MTN', value: 'MTN' },
  { label: 'Telecel (Vodafone)', value: 'Telecel (Vodafone)' },
  { label: 'AirtelTigo', value: 'AirtelTigo' },
  { label: 'Other', value: 'Other' },
];

const getWithdrawErrorMessage = (errorPayload) => {
  const errorCode = errorPayload?.code || errorPayload?.error;
  const paystackMessage = String(errorPayload?.details?.paystack?.message || errorPayload?.message || '').trim();
  const hint = String(errorPayload?.details?.hint || '').trim();
  switch (errorCode) {
    case 'invalid_phone':
      return 'Invalid phone number. Enter a Ghana number like 0241234567';
    case 'insufficient_balance':
      return 'Insufficient wallet balance';
    case 'invalid_amount':
      return 'Minimum withdrawal is GHS 10';
    case 'recipient_creation_failed':
      return 'Could not verify your MoMo number. Check the number and network are correct.';
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
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [network, setNetwork] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState(false);
  const [withdrawalsStatusLoaded, setWithdrawalsStatusLoaded] = useState(false);
  const [withdrawalsUnavailableMessage, setWithdrawalsUnavailableMessage] = useState('');
  const withdrawalFormDisabled = !withdrawalsStatusLoaded || !withdrawalsEnabled;

  useEffect(() => {
    let cancelled = false;

    const loadWithdrawStatus = async () => {
      try {
        const { response, data } = await apiGet(`${API_BASE_URL}/wallet/withdraw-status`);
        if (cancelled) return;

        if (response.ok && data?.status) {
          const enabled = data?.data?.enabled === true;
          setWithdrawalsEnabled(enabled);
          setWithdrawalsUnavailableMessage(enabled ? '' : String(data?.data?.reason || 'Withdrawals are currently unavailable.'));
        } else {
          setWithdrawalsEnabled(false);
          setWithdrawalsUnavailableMessage('Could not verify withdrawal availability. Please try again later.');
        }
      } catch {
        if (cancelled) return;
        setWithdrawalsEnabled(false);
        setWithdrawalsUnavailableMessage('Could not verify withdrawal availability. Please try again later.');
      } finally {
        if (!cancelled) {
          setWithdrawalsStatusLoaded(true);
        }
      }
    };

    loadWithdrawStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  const submitWithdrawal = async () => {
    if (!withdrawalsEnabled) {
      setNotice({
        tone: 'warning',
        title: 'Withdrawals unavailable',
        message: withdrawalsUnavailableMessage || 'Withdrawals are currently unavailable.',
      });
      return;
    }

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
      const ref = result?.data?.reference || 'N/A';
      const isManualReview = result?.data?.status === 'MANUAL_REVIEW' || result?.data?.manualMode === true;

      if (isManualReview) {
        setNotice({
          tone: 'warning',
          title: 'Withdrawal queued',
          message: `Your withdrawal has been queued for manual processing. Reference: ${ref}`,
        });
        Alert.alert(
          'Withdrawal queued for manual processing',
          `GHS ${withdrawnAmount.toFixed(2)} has been recorded, but automatic payout is not active on the current Paystack account. Your withdrawal will need manual processing. Reference: ${ref}`,
          [
            {
              text: 'OK',
              onPress: () => router.replace(`/wallet?refresh=${Date.now()}`),
            },
          ]
        );
      } else {
        setNotice({ tone: 'success', title: 'Withdrawal submitted', message: `Your MoMo withdrawal is being processed. Reference: ${ref}` });
        Alert.alert(
          '✅ Withdrawal initiated!',
          `GHS ${withdrawnAmount.toFixed(2)} is being sent to your MoMo account. This may take a few minutes.`,
          [
            {
              text: 'OK',
              onPress: () => router.replace(`/wallet?refresh=${Date.now()}`),
            },
          ]
        );
      }
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
      title="Withdraw"
      subtitle={withdrawalFormDisabled ? 'Wallet withdrawals are currently unavailable.' : 'Send wallet funds to your Mobile Money account.'}
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ color: '#64748b', marginBottom: 16, fontSize: 12 }}>
          Minimum withdrawal: GHS 10.00. Your account must be KYC verified.
        </Text>

        {withdrawalsStatusLoaded && !withdrawalsEnabled ? (
          <AppNotice
            tone="warning"
            title="Withdrawals temporarily unavailable"
            message={withdrawalsUnavailableMessage}
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <AppInput
          label="Amount (GHS)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="10"
          editable={!withdrawalFormDisabled}
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
                  if (!withdrawalFormDisabled) {
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
                  opacity: withdrawalFormDisabled ? 0.55 : 1,
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
          editable={!withdrawalFormDisabled}
        />
        <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: -10, marginBottom: 12 }}>
          Enter your 10-digit Ghana number starting with 0 (not country code).
        </Text>

        <AppInput
          label="Account Name (as registered on MoMo)"
          value={accountName}
          onChangeText={setAccountName}
          placeholder="John Mensah"
          editable={!withdrawalFormDisabled}
        />

        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

        <AppButton
          label={withdrawalFormDisabled ? 'Withdrawals Unavailable' : isSubmitting ? 'Processing...' : 'Confirm Withdrawal'}
          onPress={submitWithdrawal}
          loading={isSubmitting}
          disabled={isSubmitting || withdrawalFormDisabled}
          style={{ backgroundColor: '#2563eb' }}
        />

        <AppButton
          label="Back to Wallet"
          variant="neutral"
          onPress={() => router.replace('/wallet')}
          style={{ marginTop: 10 }}
        />
      </AppCard>

      <View style={{ marginTop: 12 }}>
        <Text style={{ color: '#64748b', fontSize: 12 }}>
          {withdrawalFormDisabled
            ? 'Withdrawals will be enabled again after ConnectHub completes Paystack payout activation.'
            : 'Funds are sent via Paystack to your Mobile Money account. Processing may take a few minutes.'}
        </Text>
      </View>
    </ScreenShell>
  );
}
