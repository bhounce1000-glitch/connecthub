import { Redirect } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { auth, db } from '../firebase';

export default function Index() {
  const [isReady, setIsReady] = useState(false);
  const [destination, setDestination] = useState<'/home' | '/auth' | '/onboarding'>('/auth');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setDestination('/auth');
        setIsReady(true);
        return;
      }

      // Check if user has completed onboarding
      try {
        const email = (user.email || '').trim().toLowerCase();
        const snap = await getDoc(doc(db, 'users', email));
        const data = snap.exists() ? snap.data() : {};
        setDestination(data.onboardingDone ? '/home' : '/onboarding');
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