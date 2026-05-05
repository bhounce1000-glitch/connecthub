/**
 * KYC Rejected screen — shown when kycStatus = rejected
 * Allows user to reset status and resubmit from step 1.
 */
import { Redirect, useRouter } from 'expo-router';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppNotice from '../../components/ui/app-notice';
import { KYC_STATUS } from '../../constants/access';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

export default function KycRejected() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const email = useMemo(() => (user?.email || '').trim().toLowerCase(), [user?.email]);
  const [rejectionReason, setRejectionReason] = useState('No reason was provided by the reviewer.');
  const [notice, setNotice] = useState(null);
  const [isResubmitting, setIsResubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthReady) return undefined;
    if (!email) {
      router.replace('/auth');
      return undefined;
    }

    const normalizeKycStatus = (value) => String(value || '').trim().toLowerCase();
    const resolveKycStatus = (userStatus, submissionStatus) => submissionStatus || userStatus || null;
    let userStatus = null;
    let submissionStatus = null;

    const routeFromStatus = () => {
      const status = resolveKycStatus(userStatus, submissionStatus);
      if (status === KYC_STATUS.PENDING_VERIFICATION) {
        router.replace('/kyc/pending');
      } else if (status === KYC_STATUS.VERIFIED) {
        router.replace('/home');
      }
    };

    const unsubscribeUser = onSnapshot(doc(db, 'users', email), (snap) => {
      userStatus = snap.exists() ? normalizeKycStatus(snap.data()?.kycStatus) : null;
      routeFromStatus();
    });

    const unsubscribeSubmission = onSnapshot(doc(db, 'kyc_submissions', email), (snap) => {
      submissionStatus = snap.exists() ? normalizeKycStatus(snap.data()?.kycStatus) : null;
      routeFromStatus();
    });

    return () => {
      unsubscribeUser();
      unsubscribeSubmission();
    };
  }, [email, isAuthReady, router]);

  useEffect(() => {
    if (!email) return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'kyc_submissions', email));
        if (!snap.exists()) return;
        const reason = String(snap.data()?.rejectionReason || '').trim();
        if (reason) setRejectionReason(reason);
      } catch {
        setNotice({ type: 'warning', message: 'Could not load rejection reason. You can still resubmit.' });
      }
    })();
  }, [email]);

  const handleResubmit = async () => {
    if (!email) return;

    setIsResubmitting(true);
    setNotice(null);

    try {
      const now = new Date().toISOString();
      await setDoc(
        doc(db, 'users', email),
        {
          kycStatus: null,
          updatedAt: now,
        },
        { merge: true }
      );

      await setDoc(
        doc(db, 'kyc_submissions', email),
        {
          kycStatus: null,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
          updatedAt: now,
        },
        { merge: true }
      );

      router.replace('/kyc/step1');
    } catch (error) {
      setNotice({ type: 'error', message: error?.message || 'Could not reset KYC status. Please try again.' });
    } finally {
      setIsResubmitting(false);
    }
  };

  if (!isAuthReady) return null;
  if (!email) return <Redirect href="/auth" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: AppColors.ink900 }}
      contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', padding: AppSpace.xl, minHeight: '100%' }}
    >
      <View style={{ maxWidth: 520, width: '100%' }}>
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 92,
              height: 92,
              borderRadius: 46,
              backgroundColor: '#450a0a',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: AppSpace.lg,
              borderWidth: 2,
              borderColor: '#ef4444',
            }}
          >
            <Text style={{ fontSize: 44 }}>❌</Text>
          </View>

          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: AppSpace.sm }}>
            Verification Failed
          </Text>
        </View>

        <View
          style={{
            backgroundColor: '#450a0a',
            borderRadius: AppRadius.lg,
            padding: AppSpace.lg,
            borderLeftWidth: 4,
            borderLeftColor: '#ef4444',
            marginBottom: AppSpace.md,
          }}
        >
          <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>
            Reason: {rejectionReason}
          </Text>
          <Text style={{ color: '#fecaca', fontSize: 13, lineHeight: 20 }}>
            Your identity verification was not successful. Please review the reason above and resubmit your information with the correct details.
          </Text>
        </View>

        <View
          style={{
            backgroundColor: '#0f172a',
            borderRadius: AppRadius.lg,
            padding: AppSpace.lg,
            borderWidth: 1,
            borderColor: '#1e293b',
            marginBottom: AppSpace.lg,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Tips before resubmitting</Text>
          {[
            'Make sure your ID photo is clear and not blurry',
            'Ensure your name matches exactly as on your ID',
            'Upload both front and back of your ID document',
            'Use a well-lit selfie where your face is clearly visible',
          ].map((tip) => (
            <View key={tip} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
              <Text style={{ color: '#22c55e', marginRight: 8 }}>•</Text>
              <Text style={{ color: AppColors.ink500, flex: 1, lineHeight: 20 }}>{tip}</Text>
            </View>
          ))}
        </View>

        <AppNotice type={notice?.type} message={notice?.message} style={{ marginBottom: AppSpace.sm }} />

        <AppButton
          label={isResubmitting ? 'Resetting…' : 'Resubmit My Details'}
          onPress={handleResubmit}
          disabled={isResubmitting}
          style={{ backgroundColor: '#16a34a', paddingVertical: 12 }}
        />

        <TouchableOpacity
          onPress={() => router.replace('/home')}
          style={{ marginTop: AppSpace.sm, alignItems: 'center', paddingVertical: AppSpace.sm }}
        >
          <Text style={{ color: '#64748b', fontSize: 13 }}>Back to home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
