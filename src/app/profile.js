import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';

import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { KYC_STATUS, isAdminEmail } from '../constants/access';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { auth, db, storage } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { useUserProfile } from '../hooks/use-user-profile';

function Stat({ icon, value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ marginTop: 4, fontWeight: '900', fontSize: 16, color: AppColors.ink900 }}>{value}</Text>
      <Text style={{ marginTop: 2, fontSize: 12, color: '#94a3b8' }}>{label}</Text>
    </View>
  );
}

function QuickAction({ label, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: '48%',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: AppRadius.md,
        paddingVertical: 14,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function Profile() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();
  const { profile } = useUserProfile(currentEmail);

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [profilePicture, setProfilePicture] = useState(null);
  const [stats, setStats] = useState({ jobs: 0, rating: 'N/A', earned: 0 });

  useEffect(() => {
    if (isAuthReady && !currentEmail) router.replace('/auth');
  }, [currentEmail, isAuthReady, router]);

  useEffect(() => {
    if (!currentEmail) return;
    (async () => {
      try {
        const q = query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail));
        const snap = await getDocs(q);
        let jobs = 0;
        let ratingTotal = 0;
        let ratingCount = 0;
        let earned = 0;

        snap.forEach((row) => {
          const data = row.data();
          if (data.paid) {
            jobs += 1;
            earned += Number(data.price || 0);
          }
          if (data.rating) {
            ratingTotal += Number(data.rating || 0);
            ratingCount += 1;
          }
        });

        const userDoc = await getDoc(doc(db, 'users', currentEmail));
        if (userDoc.exists()) setProfilePicture(userDoc.data()?.profilePicture || null);

        setStats({ jobs, rating: ratingCount ? (ratingTotal / ratingCount).toFixed(1) : 'N/A', earned });
      } catch {
        // non-blocking
      } finally {
        setIsLoading(false);
      }
    })();
  }, [currentEmail]);

  const handleUploadPicture = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await uploadFile(file);
      };
      input.click();
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const response = await fetch(result.assets[0].uri);
    const blob = await response.blob();
    await uploadFile(blob);
  };

  const uploadFile = async (fileOrBlob) => {
    setIsUploading(true);
    try {
      const userId = user?.uid;
      if (!userId || !currentEmail) throw new Error('Missing user context');
      const storageRef = ref(storage, `profile-pictures/${userId}`);
      await uploadBytes(storageRef, fileOrBlob);
      const downloadURL = await getDownloadURL(storageRef);
      await setDoc(doc(db, 'users', currentEmail), {
        email: currentEmail,
        profilePicture: downloadURL,
        updatedAt: new Date(),
      }, { merge: true });
      setProfilePicture(downloadURL);
      setUploadNotice({ tone: 'success', title: 'Profile updated', message: 'Your picture has been updated.' });
    } catch {
      setUploadNotice({ tone: 'error', title: 'Upload failed', message: 'Could not upload your photo.' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // Non-blocking: still navigate to auth gate.
    }
    router.replace('/auth');
  };

  const initial = useMemo(() => String(currentEmail || '?').charAt(0).toUpperCase(), [currentEmail]);
  const role = isAdminEmail(currentEmail) ? 'Admin' : String(profile?.role || 'customer').toLowerCase() === 'provider' ? 'Provider' : 'Customer';
  const joinedDate = useMemo(() => {
    const raw = profile?.createdAt;
    const date = raw?.seconds ? new Date(raw.seconds * 1000) : new Date(raw || 0);
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  }, [profile?.createdAt]);
  const kycStatus = profile?.kycStatus;
  const kycMeta =
    kycStatus === KYC_STATUS.VERIFIED
      ? { label: '✅ Verified', bg: '#dcfce7', text: '#166534' }
      : kycStatus === KYC_STATUS.PENDING_VERIFICATION
        ? { label: '⏳ Pending', bg: '#fef3c7', text: '#92400e' }
        : { label: '❌ Not Verified', bg: '#fee2e2', text: '#b91c1c' };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        {[1, 2, 3].map((n) => (
          <AppCard key={n} style={{ marginBottom: 10 }}>
            <LoadingSkeleton height={20} width="45%" style={{ marginBottom: 8 }} />
            <LoadingSkeleton height={14} width="70%" />
          </AppCard>
        ))}
      </View>
    );
  }

  const handleShareProfile = async () => {
    try {
      await Share.share({
        message: `Check out my ConnectHub profile: https://connecthub-1873e.web.app/providers?email=${encodeURIComponent(currentEmail)}`,
      });
    } catch {
      // Non-blocking share failure.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={{ backgroundColor: '#1e3a8a', height: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: AppSpace.lg }}>
          <Pressable onPress={handleUploadPicture} disabled={isUploading}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              {profilePicture ? (
                <Image source={{ uri: profilePicture }} style={{ width: 80, height: 80, borderRadius: 40 }} />
              ) : (
                <Text style={{ color: '#1e3a8a', fontSize: 28, fontWeight: '900' }}>{initial}</Text>
              )}
              <View style={{ position: 'absolute', right: -1, bottom: -1, width: 24, height: 24, borderRadius: 12, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                <Text style={{ color: '#fff', fontSize: 11 }}>📷</Text>
              </View>
            </View>
          </Pressable>
          <Text style={{ color: '#fff', marginTop: 12, fontWeight: '900', fontSize: 22 }}>{profile?.username || profile?.name || currentEmail.split('@')[0]}</Text>
          <Text style={{ color: '#cbd5e1', marginTop: 4, fontSize: 13 }}>{currentEmail}</Text>
          <Text style={{ color: '#cbd5e1', marginTop: 4, fontSize: 12 }}>Joined {joinedDate}</Text>
        </View>

        <View style={{ marginHorizontal: AppSpace.lg, marginTop: -28 }}>
          <AppCard style={{ borderRadius: 12, ...AppShadow.card, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Stat icon="🏆" value={stats.jobs} label="Jobs" />
              <View style={{ width: 1, height: 52, backgroundColor: '#e2e8f0' }} />
              <Stat icon="⭐" value={stats.rating} label="Rating" />
              <View style={{ width: 1, height: 52, backgroundColor: '#e2e8f0' }} />
              <Stat icon="💰" value={`GHS ${Number(stats.earned || 0).toFixed(0)}`} label="Earned" />
            </View>
          </AppCard>

          <AppNotice tone={uploadNotice?.tone} title={uploadNotice?.title} message={uploadNotice?.message} style={{ marginBottom: 10 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <View style={{ backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#1d4ed8', fontWeight: '800', fontSize: 12 }}>{role}</Text>
            </View>
            <View style={{ backgroundColor: kycMeta.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: kycMeta.text, fontWeight: '800', fontSize: 12 }}>{kycMeta.label}</Text>
            </View>
            <SubscriptionBadge plan={profile?.subscriptionPlan || 'free'} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
            <QuickAction label="📋 My Reviews" onPress={() => router.push('/history')} />
            <QuickAction label="📷 Portfolio" onPress={() => router.push('/provider-portfolio')} />
            <QuickAction label="💳 Subscription" onPress={() => router.push('/subscription')} />
            <QuickAction label="👥 Invite Friends" onPress={() => router.push('/referral')} />
            <QuickAction label="🔗 Share Profile" onPress={handleShareProfile} />
            {isAdminEmail(currentEmail) ? <QuickAction label="🛡 Admin Desk" onPress={() => router.push('/admin')} /> : null}
          </View>

          <AppCard>
            <Text style={{ color: AppColors.ink900, fontWeight: '900', marginBottom: 8 }}>Settings</Text>
            <TouchableOpacity onPress={() => router.push('/provider-setup')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
              <Text style={{ color: AppColors.ink900 }}>Edit Profile  →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/help')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
              <Text style={{ color: AppColors.ink900 }}>Help & Support  →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/privacy-policy')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
              <Text style={{ color: AppColors.ink900 }}>Privacy Policy  →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSignOut} style={{ paddingTop: 12 }}>
              <Text style={{ color: '#dc2626', fontWeight: '800' }}>Sign Out</Text>
            </TouchableOpacity>
          </AppCard>
        </View>
      </ScrollView>
    </View>
  );
}
