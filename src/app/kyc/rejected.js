/**
 * KYC Rejected screen — shown when kycStatus = rejected
 * Allows user to resubmit from step 1.
 */
import { Redirect, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

export default function KycRejected() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    if (isAuthReady && !user?.email) {
      router.replace('/auth');
      return;
    }

    (async () => {
      try {
        if (!user?.email) return;
        const email = (user.email || '').trim().toLowerCase();
        const snap = await getDoc(doc(db, 'kyc_submissions', email));
        if (snap.exists()) {
          setRejectionReason(snap.data().rejectionReason || '');
        }
      } catch {
        // silent
      }
    })();
  }, [isAuthReady, router, user]);

  const handleResubmit = () => {
    router.replace('/kyc/step1');
  };

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: AppColors.ink900 }}
      contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', padding: AppSpace.xl, minHeight: '100%' }}
    >
      <View style={{ maxWidth: 420, width: '100%', alignItems: 'center' }}>
        <View style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: '#450a0a',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: AppSpace.xl,
        }}>
          <Text style={{ fontSize: 40 }}>❌</Text>
        </View>

        <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', textAlign: 'center', marginBottom: AppSpace.sm }}>
          Verification Failed
        </Text>

        <Text style={{ color: AppColors.ink500, fontSize: AppType.body, textAlign: 'center', lineHeight: 24, marginBottom: AppSpace.xl }}>
          Unfortunately, we were unable to verify your identity with the documents provided.
        </Text>

        {rejectionReason ? (
          <View style={{
            backgroundColor: '#450a0a',
            borderRadius: AppRadius.lg,
            padding: AppSpace.lg,
            width: '100%',
            marginBottom: AppSpace.xl,
            borderLeftWidth: 3,
            borderLeftColor: '#ef4444',
          }}>
            <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '700', marginBottom: 4 }}>Reason given by reviewer:</Text>
            <Text style={{ color: '#fecaca', fontSize: AppType.body, lineHeight: 22 }}>{rejectionReason}</Text>
          </View>
        ) : null}

        <View style={{
          backgroundColor: '#1e293b',
          borderRadius: AppRadius.lg,
          padding: AppSpace.lg,
          width: '100%',
          marginBottom: AppSpace.xl,
        }}>
          <Text style={{ color: AppColors.white, fontSize: AppType.body, fontWeight: '700', marginBottom: AppSpace.sm }}>
            Common reasons for rejection:
          </Text>
          {[
            'Documents were blurry or unreadable',
            'ID had expired at time of submission',
            'Name did not match across documents',
            'Photo did not show the full document',
            'Information provided was inconsistent',
          ].map((r) => (
            <View key={r} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
              <Text style={{ color: '#f87171', marginRight: 8 }}>•</Text>
              <Text style={{ color: AppColors.ink500, fontSize: 13, flex: 1, lineHeight: 20 }}>{r}</Text>
            </View>
          ))}
        </View>

        <AppButton
          label="Resubmit Application"
          onPress={handleResubmit}
          style={{ width: '100%', marginBottom: AppSpace.md }}
        />

        <TouchableOpacity
          onPress={() => { const a = getAuth(); a.signOut(); router.replace('/auth'); }}
          style={{ paddingVertical: AppSpace.sm }}
        >
          <Text style={{ color: '#475569', fontSize: 13 }}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
