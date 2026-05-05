/**
 * KYC Pending screen — shown when kycStatus = pending_verification
 */
import { Redirect, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { KYC_STATUS, isAdminEmail } from '../../constants/access';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

export default function KycPending() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [submittedAt, setSubmittedAt] = useState(null);
  const isAdmin = useMemo(() => isAdminEmail(user?.email || ''), [user]);

  // Load submission date once
  useEffect(() => {
    if (!user?.email) return;
    const email = (user.email || '').trim().toLowerCase();
    getDoc(doc(db, 'kyc_submissions', email))
      .then((snap) => {
        if (snap.exists()) setSubmittedAt(snap.data().submittedAt || null);
      })
      .catch(() => {});
  }, [user]);

  // Auto-redirect once admin approves or rejects
  useEffect(() => {
    if (isAuthReady && !user?.email) {
      router.replace('/auth');
      return;
    }
    if (!user?.email) return;
    const email = (user.email || '').trim().toLowerCase();

    const normalizeKycStatus = (value) => String(value || '').trim().toLowerCase();
    const resolveKycStatus = (userStatus, submissionStatus) => submissionStatus || userStatus || null;
    let userStatus = null;
    let submissionStatus = null;

    const routeFromStatus = () => {
      const status = resolveKycStatus(userStatus, submissionStatus);

      if (status === KYC_STATUS.VERIFIED) {
        router.replace('/home');
      } else if (status === KYC_STATUS.REJECTED) {
        router.replace('/kyc/rejected');
      } else if (status === KYC_STATUS.PENDING_VERIFICATION) {
        // Stay on pending screen.
      } else {
        router.replace('/kyc/step1');
      }
    };

    const unsubUser = onSnapshot(doc(db, 'users', email), (snap) => {
      userStatus = snap.exists() ? normalizeKycStatus(snap.data()?.kycStatus) : null;
      routeFromStatus();
    });

    const unsubSubmission = onSnapshot(doc(db, 'kyc_submissions', email), (snap) => {
      submissionStatus = snap.exists() ? normalizeKycStatus(snap.data()?.kycStatus) : null;
      routeFromStatus();
    });

    return () => {
      unsubUser();
      unsubSubmission();
    };
  }, [isAuthReady, router, user]);

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900, alignItems: 'center', justifyContent: 'center', padding: AppSpace.xl }}>
      <View style={{ maxWidth: 420, width: '100%', alignItems: 'center' }}>
        <View style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: '#312e81',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: AppSpace.xl,
        }}>
          <Text style={{ fontSize: 40 }}>🕐</Text>
        </View>

        <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', textAlign: 'center', marginBottom: AppSpace.sm }}>
          Under Review
        </Text>

        <Text style={{ color: AppColors.ink500, fontSize: AppType.body, textAlign: 'center', lineHeight: 24, marginBottom: AppSpace.xl }}>
          Your verification documents have been submitted. Our team typically reviews submissions within 1–2 business days.
        </Text>

        <View style={{
          backgroundColor: '#1e293b',
          borderRadius: AppRadius.lg,
          padding: AppSpace.lg,
          width: '100%',
          marginBottom: AppSpace.xl,
        }}>
          <Step label="Documents submitted" done />
          <Step label="Admin review in progress" active />
          <Step label="Identity verified" />
          <Step label="Start using ConnectHub" last />
        </View>

        <Text style={{ color: AppColors.ink500, fontSize: 13, textAlign: 'center', marginBottom: AppSpace.xl }}>
          You&apos;ll receive a notification once your account is verified. This page will update automatically.
        </Text>

        {submittedAt ? (
          <Text style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginBottom: AppSpace.lg }}>
            Submitted: {new Date(submittedAt).toLocaleString()}
          </Text>
        ) : null}

        {isAdmin ? (
          <TouchableOpacity
            onPress={() => router.push('/admin')}
            style={{
              backgroundColor: '#1e293b',
              borderRadius: AppRadius.md,
              paddingVertical: 12,
              paddingHorizontal: 24,
              marginBottom: AppSpace.lg,
              borderWidth: 1,
              borderColor: '#6366f1',
            }}
          >
            <Text style={{ color: '#818cf8', fontWeight: '700', fontSize: 14 }}>
              Go to Admin Panel to Review
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={() => { const a = getAuth(); a.signOut(); router.replace('/auth'); }}
          style={{ paddingVertical: AppSpace.sm }}
        >
          <Text style={{ color: '#475569', fontSize: 13 }}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Step({ label, done = false, active = false, last = false }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: last ? 0 : AppSpace.sm }}>
      <View style={{ alignItems: 'center', marginRight: AppSpace.sm }}>
        <View style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: done ? '#6366f1' : active ? '#312e81' : '#1e293b',
          borderWidth: 2,
          borderColor: done ? '#6366f1' : active ? '#6366f1' : '#334155',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {done && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text>}
          {active && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#6366f1' }} />}
        </View>
        {!last && <View style={{ width: 2, height: 16, backgroundColor: '#1e293b', marginTop: 2 }} />}
      </View>
      <Text style={{ color: done ? AppColors.white : active ? '#818cf8' : AppColors.ink500, fontSize: AppType.body, paddingTop: 1, fontWeight: active || done ? '600' : '400' }}>
        {label}
      </Text>
    </View>
  );
}
