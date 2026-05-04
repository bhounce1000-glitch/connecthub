import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Clipboard,
    ScrollView,
    Share,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { auth, db } from '../firebase';

function maskEmail(emailValue) {
  const email = String(emailValue || '').trim().toLowerCase();
  if (!email.includes('@')) return email;
  const parts = email.split('@');
  return `${parts[0].slice(0, 2)}****@${parts[1]}`;
}

export default function Referral() {
  const router = useRouter();

  const [referralCode, setReferralCode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [referralCount, setReferralCount] = useState(0);
  const [referralEarnings, setReferralEarnings] = useState(0);
  const [referredUsers, setReferredUsers] = useState([]);
  const [error, setError] = useState('');

  const loadReferralData = async () => {
    setIsLoading(true);
    setError('');

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError('Not logged in');
        return;
      }

      const email = String(currentUser.email || '').trim().toLowerCase();
      if (!email) {
        setError('Not logged in');
        return;
      }

      const userRef = doc(db, 'users', email);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? (userSnap.data() || {}) : {};

      if (userData.referralCode) {
        setReferralCode(String(userData.referralCode));
        setReferralCount(Number(userData.referralCount || 0));
        setReferralEarnings(Number(userData.referralEarnings || 0));
        setReferredUsers(Array.isArray(userData.referredUsers) ? userData.referredUsers : []);
      } else {
        const username = email.split('@')[0].toUpperCase();
        const suffix = Math.random().toString(36).substr(2, 4).toUpperCase();
        const generatedCode = username + suffix;

        await setDoc(
          userRef,
          {
            email,
            referralCode: generatedCode,
            referralCount: Number(userData.referralCount || 0),
            referralEarnings: Number(userData.referralEarnings || 0),
            referredUsers: Array.isArray(userData.referredUsers) ? userData.referredUsers : [],
          },
          { merge: true }
        );

        setReferralCode(generatedCode);
        setReferralCount(Number(userData.referralCount || 0));
        setReferralEarnings(Number(userData.referralEarnings || 0));
        setReferredUsers(Array.isArray(userData.referredUsers) ? userData.referredUsers : []);
      }

      // Backfill legacy accounts where referredUsers was not denormalized into the user document.
      if (!userData.referredUsers || !Array.isArray(userData.referredUsers)) {
        const legacySnap = await getDocs(query(collection(db, 'users'), where('referredBy', '==', email)));
        if (!legacySnap.empty) {
          const legacyUsers = legacySnap.docs.map((item) => {
            const row = item.data() || {};
            return {
              email: row.email || item.id,
              status: row.referralFirstJobCompletedAt ? 'completed' : 'pending',
            };
          });
          setReferredUsers(legacyUsers);
        }
      }
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load referral data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReferralData();
  }, []);

  const handleCopy = () => {
    if (!referralCode) return;

    try {
      if (Clipboard && typeof Clipboard.setString === 'function') {
        Clipboard.setString(referralCode);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(referralCode);
      }
      Alert.alert('Copied!', 'Your referral code has been copied.');
    } catch {
      Alert.alert('Copy failed', 'Could not copy your referral code right now.');
    }
  };

  const handleShare = async () => {
    if (!referralCode) return;

    try {
      await Share.share({
        message: `Join ConnectHub and earn money! Use my referral code ${referralCode} when signing up at https://connecthub-1873e.web.app`,
      });
    } catch {
      Alert.alert('Share failed', 'Could not open share menu right now.');
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={{ marginTop: 12, color: '#334155', fontSize: 14 }}>Loading your referral code...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f8fafc' }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#fecaca' }}>
          <Text style={{ color: '#991b1b', fontSize: 16, fontWeight: '700' }}>Something went wrong</Text>
          <Text style={{ color: '#7f1d1d', marginTop: 8 }}>{error}</Text>
          <TouchableOpacity
            onPress={loadReferralData}
            style={{ marginTop: 16, backgroundColor: '#dc2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <Text style={{ fontSize: 30, fontWeight: '800', color: '#0f172a' }}>Referral Program</Text>
      <Text style={{ marginTop: 6, marginBottom: 16, color: '#475569' }}>
        Invite friends to ConnectHub and earn wallet rewards together.
      </Text>

      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 14 }}>
        <Text style={{ fontSize: 12, color: '#475569', fontWeight: '700' }}>Your Referral Code</Text>
        <View style={{ marginTop: 8, backgroundColor: '#dbeafe', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: '#93c5fd' }}>
          <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, textAlign: 'center', color: '#1d4ed8' }}>
            {referralCode}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            onPress={handleCopy}
            style={{ flex: 1, backgroundColor: '#1d4ed8', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Copy Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={{ flex: 1, backgroundColor: '#0f766e', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 }}>
          <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 12 }}>Total Referrals</Text>
          <Text style={{ marginTop: 6, fontSize: 25, fontWeight: '800', color: '#0f172a' }}>{referralCount}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 }}>
          <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 12 }}>Rewards Earned</Text>
          <Text style={{ marginTop: 6, fontSize: 25, fontWeight: '800', color: '#0f172a' }}>GHS {Number(referralEarnings).toFixed(2)}</Text>
        </View>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 10 }}>How It Works</Text>
        <Text style={{ color: '#334155', marginBottom: 8 }}>1. Share your code with friends</Text>
        <Text style={{ color: '#334155', marginBottom: 8 }}>2. Friend signs up using your code</Text>
        <Text style={{ color: '#334155' }}>3. When friend completes first job, you BOTH earn GHS 10 wallet credit</Text>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 18 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 10 }}>Referred Users</Text>

        {referredUsers.length === 0 ? (
          <Text style={{ color: '#64748b' }}>No referrals yet. Share your code to get started!</Text>
        ) : (
          referredUsers.map((userRow, index) => {
            const referredEmail = String(userRow?.email || '').trim().toLowerCase();
            const status = String(userRow?.status || 'pending').toLowerCase();
            const completed = status === 'completed';
            return (
              <View
                key={`${referredEmail || 'referred'}-${index}`}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 10,
                  borderBottomWidth: index === referredUsers.length - 1 ? 0 : 1,
                  borderBottomColor: '#f1f5f9',
                }}
              >
                <Text style={{ color: '#0f172a', fontWeight: '700' }}>{maskEmail(referredEmail)}</Text>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: completed ? '#dcfce7' : '#fef9c3',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: completed ? '#166534' : '#854d0e' }}>
                    {completed ? 'Completed' : 'Pending'}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.replace('/home')}
        style={{ backgroundColor: '#334155', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
