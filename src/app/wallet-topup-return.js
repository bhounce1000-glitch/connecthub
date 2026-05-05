import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiPost, assertApiSuccess } from '../utils/api-client';

export default function WalletTopupReturn() {
  const router = useRouter();
  const { reference: referenceParam, trxref } = useLocalSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState({ tone: 'info', title: 'Verifying top-up', message: 'Checking your payment reference...' });
  const [isSuccess, setIsSuccess] = useState(false);
  const hasVerified = useRef(false);

  const reference = Array.isArray(referenceParam)
    ? referenceParam[0]
    : referenceParam || (Array.isArray(trxref) ? trxref[0] : trxref);

  useEffect(() => {
    if (!reference || hasVerified.current) {
      if (!reference) {
        setNotice({ tone: 'warning', title: 'Missing reference', message: 'No top-up reference found in callback URL.' });
        setIsLoading(false);
      }
      return;
    }

    hasVerified.current = true;
    const runVerify = async () => {
      try {
        const { response, data } = await apiPost(`${API_BASE_URL}/wallet/topup/verify`, { reference }, { requireAuth: true });
        const apiData = assertApiSuccess(response, data, 'Could not verify wallet top up');
        const amount = Number(apiData?.data?.amount || 0).toFixed(2);
        setIsSuccess(true);
        setNotice({ tone: 'success', title: 'Wallet funded', message: `GHS ${amount} has been added to your wallet.` });
      } catch (error) {
        setNotice({ tone: 'error', title: 'Top-up verification failed', message: error.message || 'Could not verify your top up payment.' });
      } finally {
        setIsLoading(false);
      }
    };

    runVerify();
  }, [reference]);

  return (
    <ScreenShell
      eyebrow="WALLET RETURN"
      title="Top-up Status"
      subtitle="Review your wallet funding result."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        {isLoading ? <ActivityIndicator size="small" color="#2563eb" style={{ marginBottom: 12 }} /> : null}
        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} />

        <AppButton
          label={isSuccess ? 'Open Wallet' : 'Back to Wallet'}
          onPress={() => router.replace('/wallet')}
          style={{ marginTop: 12 }}
        />
        <AppButton
          label="Back to Home"
          variant="neutral"
          onPress={() => router.replace('/home')}
          style={{ marginTop: 10 }}
        />
      </AppCard>
    </ScreenShell>
  );
}
