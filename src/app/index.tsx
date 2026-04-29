import { Redirect } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
        const snap = await getDoc(doc(db, 'users', email));
        const data = snap.exists() ? snap.data() : {};

        // 1. Onboarding gate
        if (!data.onboardingDone) {
          setDestination('/onboarding');
          setIsReady(true);
          return;
        }

        // 2. KYC gate — providers must be verified; customers encouraged but not blocked
        const kycStatus: string = data.kycStatus || KYC_STATUS.NOT_SUBMITTED;
        if (kycStatus === KYC_STATUS.PENDING_VERIFICATION) {
          setDestination('/kyc/pending');
        } else if (kycStatus === KYC_STATUS.REJECTED) {
          setDestination('/kyc/rejected');
        } else if (kycStatus !== KYC_STATUS.VERIFIED && data.role === 'provider') {
          // Providers must complete KYC before accessing the platform
          setDestination('/kyc/step1');
        } else {
          setDestination('/home');
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