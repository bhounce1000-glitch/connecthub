import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiPost, assertApiSuccess } from '../utils/api-client';

const NETWORKS = [
  { label: 'MTN', value: 'MTN' },
  { label: 'Telecel (Vodafone)', value: 'VOD' },
  { label: 'AirtelTigo', value: 'ATL' },
  { label: 'Other', value: 'OTHER' },
];

export default function WalletWithdraw() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [network, setNetwork] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

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
        network,
      };
      const { response, data } = await apiPost(`${API_BASE_URL}/wallet/withdraw`, payload, { requireAuth: true });
      const result = assertApiSuccess(response, data, 'Could not start withdrawal');
      const ref = result?.data?.reference || 'N/A';
      setNotice({ tone: 'success', title: 'Withdrawal submitted', message: `Your MoMo withdrawal is being processed. Reference: ${ref}` });
      setTimeout(() => router.replace('/wallet'), 2000);
    } catch (error) {
      setNotice({ tone: 'error', title: 'Withdrawal failed', message: error.message || 'Could not submit withdrawal.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell
      eyebrow="WALLET"
      title="Withdraw"
      subtitle="Send wallet funds to your Mobile Money account."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ color: '#64748b', marginBottom: 16, fontSize: 12 }}>
          Minimum withdrawal: GHS 10.00. Your account must be KYC verified.
        </Text>

        <AppInput
          label="Amount (GHS)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="10"
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
                onPress={() => setNetwork(n.value)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: selected ? '#2563eb' : '#cbd5e1',
                  backgroundColor: selected ? '#dbeafe' : '#f8fafc',
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
          label="MoMo Phone Number"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          placeholder="e.g. 0241234567"
        />

        <AppInput
          label="Account Name (as registered on MoMo)"
          value={accountName}
          onChangeText={setAccountName}
          placeholder="John Mensah"
        />

        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

        <AppButton
          label={isSubmitting ? 'Submitting...' : 'Submit Withdrawal'}
          onPress={submitWithdrawal}
          loading={isSubmitting}
          disabled={isSubmitting}
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
          Funds are sent via Paystack to your Mobile Money account. Processing may take a few minutes.
        </Text>
      </View>
    </ScreenShell>
  );
}
