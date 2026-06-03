/**
 * KYC Step 3 — Payment Details (Problem 3)
 * Collects: Mobile Money OR Bank Account payout details
 */
import CryptoJS from 'crypto-js';
import { Redirect, useRouter } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';


import AppButton from '../../components/ui/app-button';
import AppInput from '../../components/ui/app-input';
import AppNotice from '../../components/ui/app-notice';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

const PAYMENT_METHODS = [
  { key: 'mobile_money', label: 'Mobile Money', icon: '📱' },
  { key: 'bank', label: 'Bank Account', icon: '🏦' },
];

const MOMO_PROVIDERS = ['MTN Mobile Money', 'Vodafone Cash', 'AirtelTigo Money', 'Zeepay', 'G-Money'];

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Face', 'Review'];

function StepIndicator({ current }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: AppSpace.xl, paddingHorizontal: AppSpace.lg }}>
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              {i > 0 && (
                <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />
              )}
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: done ? '#6366f1' : active ? '#6366f1' : '#e2e8f0',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: active ? 2 : 0,
                  borderColor: active ? '#818cf8' : 'transparent',
                }}
              >
                <Text style={{ color: done || active ? '#fff' : AppColors.ink500, fontSize: 12, fontWeight: '700' }}>
                  {done ? '✓' : String(i + 1)}
                </Text>
              </View>
              {i < STEP_LABELS.length - 1 && (
                <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />
              )}
            </View>
            <Text style={{ fontSize: 10, color: active ? '#6366f1' : AppColors.ink500, marginTop: 4, fontWeight: active ? '700' : '400' }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function maskNumber(n = '') {
  if (n.length <= 4) return n;
  return n.slice(0, 3) + '•'.repeat(Math.max(0, n.length - 6)) + n.slice(-3);
}

export default function KycStep3() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  const [method, setMethod] = useState('mobile_money');
  const [momoProvider, setMomoProvider] = useState('');
  const [momoCountry, setMomoCountry] = useState('Ghana');
  const [momoNumber, setMomoNumber] = useState('');
  const [momoName, setMomoName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthReady && !user?.email) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    (async () => {
      if (!user?.email) return;
      try {
        const email = (user.email || '').trim().toLowerCase();
        const snap = await getDoc(doc(db, 'kyc_submissions', email));
        if (snap.exists()) {
          const d = snap.data();
          if (d.paymentMethod) setMethod(d.paymentMethod);
          setMomoProvider(d.momoProvider || '');
          setMomoNumber(d.momoNumber || '');
          setMomoName(d.momoName || '');
          setBankName(d.bankName || '');
          setBankAccountNumber(d.bankAccountNumber || '');
          setBankAccountName(d.bankAccountName || '');
          setBankBranch(d.bankBranch || '');
          setMomoCountry(d.momoCountry || { cca2: 'GH', callingCode: ['233'] });
        }
      } catch {
        // silent
      }
    })();
  }, [user?.email]);

  const clearErr = (field) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const validate = () => {
    const next = {};
    const phonePattern = /^\+?[\d\s\-()]{7,20}$/;
    if (method === 'mobile_money') {
      if (!momoProvider) next.momoProvider = 'Please select a mobile money provider';
      if (!momoNumber.trim()) next.momoNumber = 'Mobile money number is required';
      else if (!phonePattern.test(momoNumber.trim())) next.momoNumber = 'Enter a valid phone number';
      if (!momoName.trim()) next.momoName = 'Account name is required';
    } else {
      if (!bankName.trim()) next.bankName = 'Bank name is required';
      if (!bankAccountNumber.trim()) next.bankAccountNumber = 'Account number is required';
      if (!bankAccountName.trim()) next.bankAccountName = 'Account name is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const ENCRYPTION_KEY = 'connecthub-kyc-2026'; // For demo only; use env var in prod
  function encryptField(value) {
    return CryptoJS.AES.encrypt(value, ENCRYPTION_KEY).toString();
  }

  const handleNext = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (!user?.email) throw new Error('Not authenticated');
      const email = (user.email || '').trim().toLowerCase();

      const payload = {
        email,
        paymentMethod: method,
        updatedAt: new Date().toISOString(),
      };

      if (method === 'mobile_money') {
        Object.assign(payload, {
          momoProvider: momoProvider,
          momoCountry: typeof momoCountry === 'object' ? (momoCountry.name || momoCountry.cca2 || '') : (momoCountry || ''),
          // Only encrypt the actual account number; name is non-sensitive
          momoNumber: encryptField(momoNumber.trim()),
          momoName: momoName.trim(),
          momoNumberMasked: maskNumber(momoNumber.trim()),
        });
      } else {
        Object.assign(payload, {
          // Only encrypt the account number; name/bank/branch are non-sensitive
          bankName: bankName.trim(),
          bankAccountNumber: encryptField(bankAccountNumber.trim()),
          bankAccountName: bankAccountName.trim(),
          bankBranch: bankBranch.trim(),
          bankAccountNumberMasked: maskNumber(bankAccountNumber.trim()),
        });
      }

      await setDoc(doc(db, 'kyc_submissions', email), payload, { merge: true });

      router.push('/kyc/step-face');
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Failed to save. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const maxW = 520;

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: maxW }}>
          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
            Verify Your Identity
          </Text>
          <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
            Step 3 of 5 — Where should we send your earnings?
          </Text>

          <StepIndicator current={2} />

          {notice && (
            <AppNotice type={notice.type} message={notice.message} style={{ marginBottom: AppSpace.md }} />
          )}

          {/* Info banner */}
          <View style={{
            backgroundColor: '#1e293b',
            borderRadius: AppRadius.lg,
            padding: AppSpace.md,
            marginBottom: AppSpace.xl,
            borderLeftWidth: 3,
            borderLeftColor: '#6366f1',
          }}>
            <Text style={{ color: AppColors.slate200, fontSize: 13, lineHeight: 20 }}>
              🔒 Your payment details are encrypted and only used to pay out your earnings. They will never be shared with customers.
            </Text>
          </View>

          {/* Method selector */}
          <Text style={sectionTitle}>Payout Method</Text>
          <View style={{ flexDirection: 'row', gap: AppSpace.sm, marginBottom: AppSpace.xl }}>
            {PAYMENT_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                onPress={() => { setMethod(m.key); setErrors({}); }}
                style={{
                  flex: 1,
                  padding: AppSpace.md,
                  borderRadius: AppRadius.lg,
                  backgroundColor: method === m.key ? '#312e81' : '#1e293b',
                  borderWidth: 2,
                  borderColor: method === m.key ? '#6366f1' : 'transparent',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 28 }}>{m.icon}</Text>
                <Text style={{ color: method === m.key ? '#c7d2fe' : AppColors.ink500, fontWeight: '700', fontSize: AppType.body, textAlign: 'center' }}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {method === 'mobile_money' ? (
            <>
              <Text style={sectionTitle}>Mobile Money Details</Text>

              {/* MoMo provider */}
              <Text style={{ fontSize: AppType.body, fontWeight: '700', color: '#6366f1', marginBottom: AppSpace.xs }}>
                Provider
              </Text>
              {errors.momoProvider ? (
                <Text style={{ color: '#b91c1c', fontSize: 13, marginBottom: AppSpace.xs }}>{errors.momoProvider}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: AppSpace.md }}>
                {MOMO_PROVIDERS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => { setMomoProvider(p); clearErr('momoProvider'); }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: AppRadius.xl,
                      backgroundColor: momoProvider === p ? '#6366f1' : AppColors.white,
                      borderWidth: 1,
                      borderColor: momoProvider === p ? '#6366f1' : '#cbd5e1',
                    }}
                  >
                    <Text style={{ color: momoProvider === p ? '#fff' : AppColors.ink700, fontWeight: '600', fontSize: 13 }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Country input and number */}
              <Text style={{ color: '#6366f1', fontWeight: '700', marginBottom: 4 }}>Country</Text>
              <AppInput
                value={momoCountry}
                onChangeText={setMomoCountry}
                placeholder="Country"
                style={{ marginBottom: AppSpace.md }}
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />
              <Text style={{ color: '#6366f1', fontWeight: '700', marginBottom: 4 }}>Mobile Money Number</Text>
              <AppInput
                value={momoNumber}
                onChangeText={(v) => { setMomoNumber(v); clearErr('momoNumber'); }}
                placeholder="Enter mobile money number"
                keyboardType="phone-pad"
                style={{ marginBottom: AppSpace.md }}
                error={errors.momoNumber}
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />

              <AppInput
                label="Account Name (as registered)"
                placeholder="Full name on the account"
                value={momoName}
                onChangeText={(v) => { setMomoName(v); clearErr('momoName'); }}
                error={errors.momoName}
                autoCapitalize="words"
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />
            </>
          ) : (
            <>
              <Text style={sectionTitle}>Bank Account Details</Text>

              <AppInput
                label="Bank Name"
                placeholder="e.g. Ghana Commercial Bank"
                value={bankName}
                onChangeText={(v) => { setBankName(v); clearErr('bankName'); }}
                error={errors.bankName}
                autoCapitalize="words"
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />

              <AppInput
                label="Account Number"
                placeholder="Your bank account number"
                value={bankAccountNumber}
                onChangeText={(v) => { setBankAccountNumber(v); clearErr('bankAccountNumber'); }}
                error={errors.bankAccountNumber}
                keyboardType="numeric"
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />

              <AppInput
                label="Account Name"
                placeholder="Name on the bank account"
                value={bankAccountName}
                onChangeText={(v) => { setBankAccountName(v); clearErr('bankAccountName'); }}
                error={errors.bankAccountName}
                autoCapitalize="words"
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />

              <AppInput
                label="Branch / Sort Code (optional)"
                placeholder="Branch name or sort code"
                value={bankBranch}
                onChangeText={(v) => { setBankBranch(v); clearErr('bankBranch'); }}
                error={errors.bankBranch}
                autoCapitalize="words"
                accessibilityLabel="Bank Branch or Sort Code"
                helperText="If your bank requires a branch or sort code for transfers, enter it here."
                labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
              />
            </>
          )}

          <View style={{ flexDirection: 'row', gap: AppSpace.sm, marginTop: AppSpace.lg }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: AppRadius.lg,
                borderWidth: 1,
                borderColor: '#475569',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: AppColors.slate200, fontWeight: '600' }}>← Back</Text>
            </TouchableOpacity>

            <AppButton
              label={loading ? 'Saving…' : 'Next: Review →'}
              onPress={handleNext}
              disabled={loading}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const sectionTitle = {
  fontSize: 13,
  fontWeight: '700',
  color: '#6366f1',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  marginBottom: AppSpace.md,
};
