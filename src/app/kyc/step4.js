/**
 * KYC Step 4 — Review & Submit
 * Shows a summary of all collected KYC data before final submission.
 */
import CryptoJS from 'crypto-js';
import { useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { API_BASE_URL } from '../../constants/api';
import { apiPost } from '../../utils/api-client';
import { useState as useCheckboxState, useEffect, useState } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppNotice from '../../components/ui/app-notice';
import { KYC_STATUS } from '../../constants/access';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Review'];

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

function ReviewRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
      <Text style={{ flex: 1, color: AppColors.ink500, fontSize: 13 }}>{label}</Text>
      <Text style={{ flex: 1.5, color: AppColors.white, fontSize: 13, fontWeight: '500', textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function ReviewSection({ title, children, onEdit, route }) {
  return (
    <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.lg, padding: AppSpace.md, marginBottom: AppSpace.md, borderWidth: 1, borderColor: '#1e293b' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppSpace.sm }}>
        <Text style={{ color: '#6366f1', fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{title}</Text>
        <TouchableOpacity onPress={onEdit}>
          <Text style={{ color: '#818cf8', fontSize: 13, fontWeight: '600' }}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

function maskNumber(n = '') {
  if (n.length <= 4) return n;
  return n.slice(0, 3) + '•'.repeat(Math.max(0, n.length - 6)) + n.slice(-3);
}

// Safely decrypt a field — returns plain text if value was not encrypted
const ENCRYPTION_KEY = 'connecthub-kyc-2026';
function safeDecrypt(value) {
  if (!value) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(value, ENCRYPTION_KEY);
    const decoded = bytes.toString(CryptoJS.enc.Utf8);
    // If decryption yields a non-empty string, it was encrypted; otherwise return as-is
    return decoded || value;
  } catch {
    return value;
  }
}

export default function KycStep4() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmed, setConfirmed] = useCheckboxState(false);

  useEffect(() => {
    (async () => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user?.email) { router.replace('/auth'); return; }
        const email = (user.email || '').trim().toLowerCase();
        const snap = await getDoc(doc(db, 'kyc_submissions', email));
        if (!snap.exists()) { router.replace('/kyc/step1'); return; }
        setData(snap.data());
      } catch {
        setNotice({ type: 'error', message: 'Failed to load your submission. Please go back and try again.' });
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user?.email) throw new Error('Not authenticated');
      const email = (user.email || '').trim().toLowerCase();

      // Mark KYC submission as pending_verification
      await setDoc(
        doc(db, 'kyc_submissions', email),
        {
          kycStatus: KYC_STATUS.PENDING_VERIFICATION,
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Update users collection kycStatus field
      await setDoc(
        doc(db, 'users', email),
        { kycStatus: KYC_STATUS.PENDING_VERIFICATION, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      // Send submission confirmation email (non-blocking — don't fail the flow if this errors)
      apiPost(`${API_BASE_URL}/kyc/notify-submitted`, {}, { requireAuth: true }).catch(() => {});

      router.replace('/kyc/pending');
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Submission failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const maxW = 520;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: AppColors.ink900, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: AppColors.ink500 }}>Loading your information…</Text>
      </View>
    );
  }

  const d = data || {};
  const paymentMethod = d.paymentMethod === 'bank' ? 'Bank Account' : 'Mobile Money';

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: maxW }}>
          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
            Review & Submit
          </Text>
          <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
            Step 4 of 4 — Please confirm your details before submitting.
          </Text>

          <StepIndicator current={3} />

          {notice && (
            <AppNotice type={notice.type} message={notice.message} style={{ marginBottom: AppSpace.md }} />
          )}

          <ReviewSection title="Personal Information" onEdit={() => router.push('/kyc/step1')}>
            <ReviewRow label="Full Name" value={d.fullName} />
            <ReviewRow label="Date of Birth" value={d.dob} />
            <ReviewRow label="Gender" value={d.gender} />
            <ReviewRow label="Nationality" value={d.nationality} />
            <ReviewRow label="Country of Residence" value={d.countryOfResidence} />
            <ReviewRow label="City" value={d.city} />
            <ReviewRow label="Home Address" value={d.homeAddress} />
            <ReviewRow label="Occupation" value={d.occupation} />
          </ReviewSection>

          <ReviewSection title="Identity Documents" onEdit={() => router.push('/kyc/step2')}>
            <ReviewRow label="Phone" value={d.phone} />
            {d.altPhone ? <ReviewRow label="Alt Phone" value={d.altPhone} /> : null}
            <ReviewRow label="ID Type" value={d.idType} />
            <ReviewRow label="ID Number" value={d.idNumber} />
            <ReviewRow label="ID Front Photo" value={d.idFrontUrl ? '✅ Uploaded' : '❌ Missing'} />
            <ReviewRow label="ID Back Photo" value={d.idBackUrl ? '✅ Uploaded' : 'Not provided'} />
          </ReviewSection>

          <ReviewSection title="Payment Details" onEdit={() => router.push('/kyc/step3')}>
            <ReviewRow label="Method" value={paymentMethod} />
            {d.paymentMethod === 'mobile_money' ? (
              <>
                <ReviewRow label="Provider" value={d.momoProvider} />
                <ReviewRow label="Number" value={maskNumber(d.momoNumberMasked || '')} />
                <ReviewRow label="Account Name" value={safeDecrypt(d.momoName)} />
              </>
            ) : (
              <>
                <ReviewRow label="Bank" value={safeDecrypt(d.bankName)} />
                <ReviewRow label="Account No." value={maskNumber(d.bankAccountNumberMasked || '')} />
                <ReviewRow label="Account Name" value={safeDecrypt(d.bankAccountName)} />
                {d.bankBranch ? <ReviewRow label="Branch" value={safeDecrypt(d.bankBranch)} /> : null}
              </>
            )}
          </ReviewSection>

          {/* Consent Checkbox */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: AppSpace.md, marginTop: AppSpace.lg }}>
            <TouchableOpacity
              onPress={() => setConfirmed((v) => !v)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: confirmed ? '#16a34a' : '#64748b',
                backgroundColor: confirmed ? '#16a34a' : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
                marginTop: 2,
              }}
            >
              {confirmed ? <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>✓</Text> : null}
            </TouchableOpacity>
            <Text style={{ color: AppColors.ink500, fontSize: 13, flex: 1 }}>
              I confirm all information is accurate and I agree to the{' '}
              <Text style={{ color: '#6366f1', textDecorationLine: 'underline' }} onPress={() => Linking.openURL('/terms')}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={{ color: '#6366f1', textDecorationLine: 'underline' }} onPress={() => Linking.openURL('/privacy-policy')}>Privacy Policy</Text>.
            </Text>
          </View>

          <AppButton
            label={submitting ? 'Submitting…' : '✓ Submit for Verification'}
            onPress={handleSubmit}
            disabled={submitting || !confirmed}
            style={{ backgroundColor: confirmed ? '#16a34a' : '#64748b' }}
          />

          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: AppSpace.md, alignItems: 'center', paddingVertical: AppSpace.sm }}
          >
            <Text style={{ color: AppColors.ink500, fontSize: AppType.body }}>← Back to Payment</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
