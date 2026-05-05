import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { apiPost, assertApiSuccess } from '../utils/api-client';

export default function WalletWithdraw() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  const submitWithdrawal = async () => {
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount < 50) {
      setNotice({ tone: 'warning', title: 'Invalid amount', message: 'Minimum withdrawal amount is GHS 50.00.' });
      return;
    }

    if (!accountName.trim() || !accountNumber.trim() || !bankCode.trim()) {
      setNotice({ tone: 'warning', title: 'Missing details', message: 'Account name, account number, and bank code are required.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const payload = {
        amount: numericAmount,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode: bankCode.trim(),
        bankName: bankName.trim(),
      };
      const { response, data } = await apiPost(`${API_BASE_URL}/wallet/withdraw`, payload, { requireAuth: true });
      const result = assertApiSuccess(response, data, 'Could not start withdrawal');
      const ref = result?.data?.reference || 'N/A';
      setNotice({ tone: 'success', title: 'Withdrawal submitted', message: `Request sent successfully. Reference: ${ref}` });
      setTimeout(() => router.replace('/wallet'), 700);
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
      subtitle="Send wallet funds to your bank account."
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll
    >
      <AppCard>
        <Text style={{ color: '#64748b', marginBottom: 12, fontSize: 12 }}>
          Minimum withdrawal: GHS 50.00. Your account must be KYC verified.
        </Text>

        <AppInput
          label="Amount (GHS)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="50"
        />

        <AppInput
          label="Account Name"
          value={accountName}
          onChangeText={setAccountName}
          placeholder="John Mensah"
        />

        <AppInput
          label="Account Number"
          value={accountNumber}
          onChangeText={setAccountNumber}
          keyboardType="number-pad"
          placeholder="0123456789"
        />

        <AppInput
          label="Bank Code"
          value={bankCode}
          onChangeText={setBankCode}
          placeholder="e.g. 033"
        />

        <AppInput
          label="Bank Name (optional)"
          value={bankName}
          onChangeText={setBankName}
          placeholder="Bank name"
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
          Tip: If you do not know your bank code, contact support from Help & Support.
        </Text>
      </View>
    </ScreenShell>
  );
}
