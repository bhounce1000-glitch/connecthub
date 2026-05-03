import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Clipboard, Platform, Share, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

export default function Referral() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [profile, setProfile] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentEmail = String(user?.email || '').trim().toLowerCase();

  useEffect(() => {
    // Wait until Firebase auth has resolved
    if (!isAuthReady) return;

    if (!currentEmail) {
      setIsLoading(false);
      setNotice({ tone: 'warning', title: 'Not logged in', message: 'Please log in to view your referral code.' });
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const profileSnap = await getDoc(doc(db, 'users', currentEmail));
        let data = profileSnap.exists() ? (profileSnap.data() || {}) : {};

        // Auto-generate referral code if it does not exist yet
        if (!data.referralCode) {
          const local = currentEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
          const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
          const newCode = `${local || 'CHUB'}${suffix}`;
          await setDoc(doc(db, 'users', currentEmail), {
            referralCode: newCode,
            referralCount: data.referralCount ?? 0,
            referralEarnings: data.referralEarnings || data.referralRewardEarned || 0,
            referredUsers: data.referredUsers || [],
          }, { merge: true });
          data = { ...data, referralCode: newCode };
        }

        const referralsSnap = await getDocs(
          query(collection(db, 'users'), where('referredBy', '==', currentEmail))
        );
        setProfile(data);
        setReferrals(referralsSnap.docs.map((row) => ({ id: row.id, ...row.data() })));
      } catch (e) {
        setNotice({ tone: 'warning', title: 'Could not load referrals', message: 'Try again in a moment.' });
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [currentEmail, isAuthReady]);

  const code = String(profile?.referralCode || '').trim();
  const totalRewards = Number(profile?.referralEarnings || profile?.referralRewardEarned || 0);
  const totalReferrals = Number(profile?.referralCount || referrals.length || 0);
  const referralLink = code ? `https://connecthub-1873e.web.app/auth?ref=${encodeURIComponent(code)}` : '';
  const inviteMessage = code
    ? `Join ConnectHub and earn money. Use my referral code ${code} and sign up here: ${referralLink}\n\nRewards:\n- You get GHS 5 instantly at signup\n- We both get GHS 10 when you complete your first job`
    : '';

  const handleCopy = async () => {
    if (!code) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteMessage);
      } else {
        Clipboard.setString(inviteMessage);
      }
      Alert.alert('Copied!', 'Your referral invite link and rewards message have been copied.');
    } catch (_) {
      Alert.alert('Copy failed', `Please copy this manually: ${referralLink}`);
    }
  };

  const shareCode = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: inviteMessage,
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

      {isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ color: '#64748b', marginTop: 12 }}>Loading your referral code...</Text>
        </View>
      ) : (
        <>
          <AppCard style={{ marginBottom: 12, alignItems: 'center' }}>
            <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '600', letterSpacing: 1 }}>YOUR REFERRAL CODE</Text>
            <View style={{
              backgroundColor: '#eff6ff',
              borderRadius: 12,
              paddingVertical: 14,
              paddingHorizontal: 24,
              marginVertical: 10,
              borderWidth: 2,
              borderColor: '#bfdbfe',
              alignItems: 'center',
              width: '100%',
            }}>
              <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4, color: '#1e40af', textAlign: 'center' }}>
                {code || '—'}
              </Text>
            </View>
            <Text style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginBottom: 10 }}>
              Share this code during signup to credit your referral.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
              <AppButton label="Copy Invite" onPress={handleCopy} style={{ flex: 1 }} disabled={!code} />
              <AppButton label="Share" onPress={shareCode} style={{ flex: 1 }} disabled={!code} />
            </View>
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
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>How It Works</Text>
            {[
              { step: '1', text: 'Share your referral code with friends' },
              { step: '2', text: 'Friend signs up using your code — they instantly earn GHS 5 wallet credit' },
              { step: '3', text: 'When your friend completes their first job, you BOTH earn GHS 10 wallet credit' },
            ].map(({ step, text }) => (
              <View key={step} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#1e40af', alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{step}</Text>
                </View>
                <Text style={{ flex: 1, color: '#475569', fontSize: 13 }}>{text}</Text>
              </View>
            ))}
          </AppCard>

          <AppCard style={{ marginBottom: 12 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>Referred Users</Text>
            {referrals.length === 0 ? (
              <Text style={{ color: '#64748b' }}>No referrals yet. Share your code to get started!</Text>
            ) : (
              referrals.map((person) => {
                const email = person.email || person.id || '';
                const parts = email.split('@');
                const masked = parts.length === 2 ? parts[0].slice(0, 2) + '****@' + parts[1] : email;
                const completed = !!person.referralFirstJobCompletedAt;
                return (
                  <View key={person.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: '#1e293b' }}>{masked}</Text>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: completed ? '#dcfce7' : '#fef9c3' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: completed ? '#166534' : '#854d0e' }}>
                        {completed ? 'Completed' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </AppCard>
        </>
      )}

      <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} />
    </ScreenShell>
  );
}
