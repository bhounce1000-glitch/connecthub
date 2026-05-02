import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

export default function Referral() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [profile, setProfile] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentEmail = String(user?.email || '').trim().toLowerCase();

  useEffect(() => {
    if (!currentEmail) return;

    const load = async () => {
      setIsLoading(true);
      try {
        const [profileSnap, referralsSnap] = await Promise.all([
          getDoc(doc(db, 'users', currentEmail)),
          getDocs(query(collection(db, 'users'), where('referredBy', '==', currentEmail))),
        ]);

        setProfile(profileSnap.exists() ? (profileSnap.data() || {}) : {});
        setReferrals(referralsSnap.docs.map((row) => ({ id: row.id, ...row.data() })));
      } catch {
        setNotice({ tone: 'warning', title: 'Could not load referrals', message: 'Try again in a moment.' });
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [currentEmail]);

  const code = String(profile?.referralCode || '').trim();
  const totalRewards = Number(profile?.referralRewardEarned || 0);
  const totalReferrals = Number(referrals.length || 0);

  const shareCode = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: `Join ConnectHub with my referral code ${code}. When you complete your first job, we both earn a bonus!`,
      });
    } catch {
      setNotice({ tone: 'warning', title: 'Share failed', message: 'Could not open the share menu right now.' });
    }
  };

  return (
    <ScreenShell
      eyebrow="GROWTH"
      title="Referral Program"
      subtitle="Invite friends and earn wallet bonuses when they complete their first job."
      accentColor="#0f172a"
      accentTextColor="#cbd5e1"
      scroll
    >
      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 12 }} />

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ color: '#64748b' }}>Your Referral Code</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 4 }}>{code || 'Generating...'}</Text>
        <Text style={{ color: '#475569', marginTop: 6 }}>Share this code during signup to credit your referral.</Text>
        <AppButton label="Share Code" onPress={shareCode} style={{ marginTop: 12 }} disabled={!code || isLoading} />
      </AppCard>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <AppCard style={{ flex: 1 }}>
          <Text style={{ color: '#64748b', fontSize: 12 }}>Total Referrals</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 4 }}>{totalReferrals}</Text>
        </AppCard>
        <AppCard style={{ flex: 1 }}>
          <Text style={{ color: '#64748b', fontSize: 12 }}>Rewards Earned</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 4 }}>GHS {totalRewards.toFixed(2)}</Text>
        </AppCard>
      </View>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>Referred Users</Text>
        {referrals.length === 0 ? (
          <Text style={{ color: '#64748b' }}>No referrals yet.</Text>
        ) : (
          referrals.map((person) => (
            <View key={person.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <Text style={{ fontWeight: '700' }}>{person.name || person.displayName || person.email || person.id}</Text>
              <Text style={{ color: '#64748b', fontSize: 12 }}>Status: {person.referralFirstJobCompletedAt ? 'First job completed' : 'Pending first completed job'}</Text>
            </View>
          ))
        )}
      </AppCard>

      <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} />
    </ScreenShell>
  );
}
