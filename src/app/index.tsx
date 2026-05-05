import { Redirect } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { KYC_STATUS } from '../constants/access';
import { auth, db } from '../firebase';

type Destination =
  | '/home'
  | '/auth'
  | '/onboarding'
  | '/kyc/step1'
  | '/kyc/pending'
  | '/kyc/rejected';

export default function Index() {
  const [isReady, setIsReady] = useState(false);
  const [destination, setDestination] = useState<Destination>('/auth');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setDestination('/auth');
        setIsReady(true);
        return;
      }

      try {
        const email = (user.email || '').trim().toLowerCase();
        const [userSnap, submissionSnap] = await Promise.all([
          getDoc(doc(db, 'users', email)),
          getDoc(doc(db, 'kyc_submissions', email)),
        ]);

        const data = userSnap.exists() ? userSnap.data() : {};
        const submissionData = submissionSnap.exists() ? submissionSnap.data() : {};

        const normalizeKycStatus = (value: unknown): string => String(value || '').trim().toLowerCase();
        const userKycStatus = normalizeKycStatus((data as any)?.kycStatus);
        const submissionKycStatus = normalizeKycStatus((submissionData as any)?.kycStatus);
        const effectiveKycStatus = submissionKycStatus || userKycStatus;

        // Self-heal legacy profiles where users.kycStatus was missing or had old casing.
        if (email && effectiveKycStatus && userKycStatus !== effectiveKycStatus) {
          await setDoc(doc(db, 'users', email), {
            kycStatus: effectiveKycStatus,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }

        // 1. Onboarding gate
        if (!data.onboardingDone) {
          setDestination('/onboarding');
          setIsReady(true);
          return;
        }

        // 2. KYC gate
        const kycStatus = effectiveKycStatus || null;
        if (kycStatus === KYC_STATUS.VERIFIED) {
          setDestination('/home');
        } else if (kycStatus === KYC_STATUS.PENDING_VERIFICATION) {
          setDestination('/kyc/pending');
        } else if (kycStatus === KYC_STATUS.REJECTED) {
          setDestination('/kyc/rejected');
        } else {
          setDestination('/kyc/step1');
        }
      } catch {
        setDestination('/home');
      }

      setIsReady(true);
    });

    return unsubscribe;
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' }}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return <Redirect href={destination} />;
}