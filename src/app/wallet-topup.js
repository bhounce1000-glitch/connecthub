import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiPost, assertApiSuccess } from '../utils/api-client';

export default function WalletTopup() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  const parsedAmount = useMemo(() => Number(amount || 0), [amount]);

  const handleTopup = async () => {
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
      setNotice({ tone: 'warning', title: 'Invalid amount', message: 'Enter an amount of at least GHS 1.00.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/wallet/topup/init`, { amount: parsedAmount }, { requireAuth: true });
      const apiData = assertApiSuccess(response, data, 'Could not start wallet top up');
      const authorizationUrl = apiData?.data?.authorization_url;
      if (!authorizationUrl) throw new Error('Missing checkout URL');

      if (Platform.OS === 'web') {
        window.location.href = authorizationUrl;
      } else {
        await Linking.openURL(authorizationUrl);
      }
    } catch (error) {
      setNotice({ tone: 'error', title: 'Top up failed', message: error.message || 'Could not initialize top up checkout.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell
      eyebrow="WALLET"
      title="Add Money"
      subtitle="Fund your ConnectHub wallet securely with Paystack."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ fontWeight: '800', marginBottom: 8 }}>Top-up Amount (GHS)</Text>
        <View style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="50"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            style={{ fontSize: 16 }}
          />
        </View>

        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

        <AppButton
          label={isSubmitting ? 'Opening checkout...' : 'Continue to Paystack'}
          onPress={handleTopup}
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
          Funds are credited after successful payment verification.
        </Text>
      </View>
    </ScreenShell>
  );
}
