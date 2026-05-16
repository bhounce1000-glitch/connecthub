import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
    EmailAuthProvider,
    GoogleAuthProvider,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    signOut,
} from 'firebase/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';

import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { KYC_STATUS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { auth, db, storage } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { useUserProfile } from '../hooks/use-user-profile';
import { apiGet, apiPost } from '../utils/api-client';
import { formatApiMessage } from '../utils/api-response';

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
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameVerification, setUsernameVerification] = useState({ fullName: '', dob: '', idNumber: '', idCardUrl: '' });
  const [isChangingUsername, setIsChangingUsername] = useState(false);
  const [isUploadingVerificationId, setIsUploadingVerificationId] = useState(false);
  const [usernameNotice, setUsernameNotice] = useState(null);
  const [usernameAudit, setUsernameAudit] = useState([]);
  const [isLoadingUsernameAudit, setIsLoadingUsernameAudit] = useState(false);
  const [requiresRecentLogin, setRequiresRecentLogin] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [isReauthenticating, setIsReauthenticating] = useState(false);

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

        snap.forEach((row) => {
          const data = row.data();
          if (data.paid) {
            jobs += 1;
          }
          if (data.rating) {
            ratingTotal += Number(data.rating || 0);
            ratingCount += 1;
          }
        });

        const userDoc = await getDoc(doc(db, 'users', currentEmail));
        if (userDoc.exists()) setProfilePicture(userDoc.data()?.profilePicture || null);

        let totalEarned = 0;
        if (user?.uid) {
          const walletByUid = await getDoc(doc(db, 'wallets', String(user.uid)));
          if (walletByUid.exists()) {
            const walletData = walletByUid.data() || {};
            totalEarned = Number(walletData.totalEarned || walletData.earned || 0);
          }
        }
        if (!Number.isFinite(totalEarned) || totalEarned <= 0) {
          const walletByEmail = await getDoc(doc(db, 'wallets', currentEmail));
          if (walletByEmail.exists()) {
            const walletData = walletByEmail.data() || {};
            totalEarned = Number(walletData.totalEarned || walletData.earned || 0);
          }
        }

        setStats({ jobs, rating: ratingCount ? (ratingTotal / ratingCount).toFixed(1) : 'N/A', earned: Number.isFinite(totalEarned) ? totalEarned : 0 });
      } catch {
        // non-blocking
      } finally {
        setIsLoading(false);
      }
    })();
  }, [currentEmail, user?.uid]);

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
    if (Number.isNaN(date.getTime())) return 'Recently joined';
    if (date.getTime() <= 60 * 60 * 1000) return 'Recently joined';
    return date.toLocaleDateString();
  }, [profile?.createdAt]);
  const kycStatus = profile?.kycStatus;
  const kycMeta =
    kycStatus === KYC_STATUS.VERIFIED
      ? { label: '✅ Verified', bg: '#dcfce7', text: '#166534' }
      : kycStatus === KYC_STATUS.PENDING_VERIFICATION
        ? { label: '⏳ Pending', bg: '#fef3c7', text: '#92400e' }
        : { label: '❌ Not Verified', bg: '#fee2e2', text: '#b91c1c' };
  const usernameChangeCount = Number(profile?.usernameChangeCount || 0);
  const requiresKycReverification = usernameChangeCount >= 1;
  const currentUsername = String(profile?.username || profile?.name || currentEmail.split('@')[0] || '').trim();
  const usernameAuditPreview = useMemo(
    () => (Array.isArray(usernameAudit) ? usernameAudit.slice(0, 5) : []),
    [usernameAudit]
  );

  useEffect(() => {
    if (!usernameDraft) {
      setUsernameDraft(currentUsername);
    }
  }, [currentUsername, usernameDraft]);

  const loadUsernameAudit = useCallback(async () => {
    if (!currentEmail) return;
    try {
      setIsLoadingUsernameAudit(true);
      const { response, data } = await apiGet(`${API_BASE_URL}/profile/username/audit?limit=8`, { requireAuth: true });
      if (!response.ok || !data?.status || !Array.isArray(data?.data)) {
        return;
      }
      setUsernameAudit(data.data);
    } catch {
      // Non-blocking; audit is a visibility feature.
    } finally {
      setIsLoadingUsernameAudit(false);
    }
  }, [currentEmail]);

  const uploadVerificationId = async () => {
    try {
      setIsUploadingVerificationId(true);
      setUsernameNotice(null);
      if (!user?.uid) throw new Error('Missing user context');

      let fileOrBlob = null;
      if (Platform.OS === 'web') {
        const file = await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => resolve(e.target.files?.[0] || null);
          input.click();
        });
        if (!file) return;
        fileOrBlob = file;
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') throw new Error('Photo library permission is required');
        const pick = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.9,
        });
        if (pick.canceled || !pick.assets?.[0]?.uri) return;
        const response = await fetch(pick.assets[0].uri);
        fileOrBlob = await response.blob();
      }

      const storageRef = ref(storage, `username-change-id/${user.uid}/${Date.now()}.jpg`);
      await uploadBytes(storageRef, fileOrBlob);
      const downloadURL = await getDownloadURL(storageRef);
      setUsernameVerification((prev) => ({ ...prev, idCardUrl: downloadURL }));
      setUsernameNotice({ tone: 'success', title: 'ID uploaded', message: 'Verification ID uploaded successfully.' });
    } catch (error) {
      setUsernameNotice({ tone: 'error', title: 'Upload failed', message: error?.message || 'Could not upload ID card.' });
    } finally {
      setIsUploadingVerificationId(false);
    }
  };

  useEffect(() => {
    if (!currentEmail) return;
    loadUsernameAudit();
  }, [currentEmail, loadUsernameAudit]);

  const handleUsernameChange = async () => {
    const nextUsername = String(usernameDraft || '').trim();
    if (!nextUsername) {
      setUsernameNotice({ tone: 'error', title: 'Missing username', message: 'Enter a username first.' });
      return;
    }

    if (nextUsername.length < 3 || nextUsername.length > 40 || !/^[a-zA-Z0-9 _.-]+$/.test(nextUsername)) {
      setUsernameNotice({
        tone: 'error',
        title: 'Invalid username',
        message: 'Use 3-40 characters with letters, numbers, spaces, underscores, hyphens, or dots only.',
      });
      return;
    }

    if (currentUsername && nextUsername.toLowerCase() === currentUsername.toLowerCase()) {
      setUsernameNotice({ tone: 'warning', title: 'No change', message: 'That is already your current username.' });
      return;
    }

    const payload = { newUsername: nextUsername };
    if (requiresKycReverification) {
      payload.fullName = usernameVerification.fullName;
      payload.dob = usernameVerification.dob;
      payload.idNumber = usernameVerification.idNumber;
      payload.idCardUrl = usernameVerification.idCardUrl;
    }

    setIsChangingUsername(true);
    setUsernameNotice(null);

    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/profile/username/change`, payload, { requireAuth: true });
      if (!response.ok || !data?.status) {
        if (data?.code === 'recent_login_required') {
          setRequiresRecentLogin(true);
          setUsernameNotice({
            tone: 'warning',
            title: 'Security Check Required',
            message: formatApiMessage(data, 'Please re-authenticate and try again.'),
          });
          return;
        }
        throw new Error(formatApiMessage(data, 'Could not change username right now.'));
      }
      setRequiresRecentLogin(false);
      setReauthPassword('');
      setUsernameNotice({ tone: 'success', title: 'Username updated', message: 'Your username was updated successfully.' });
      setUsernameVerification({ fullName: '', dob: '', idNumber: '', idCardUrl: '' });
      await loadUsernameAudit();
    } catch (error) {
      setUsernameNotice({ tone: 'error', title: 'Update failed', message: error?.message || 'Could not change username right now.' });
      await loadUsernameAudit();
    } finally {
      setIsChangingUsername(false);
    }
  };

  const handleReauthenticate = async () => {
    try {
      setIsReauthenticating(true);
      setUsernameNotice(null);

      const currentUser = auth.currentUser;
      if (!currentUser || !currentEmail) {
        throw new Error('Missing user context. Please sign in again.');
      }

      const providerIds = Array.isArray(currentUser.providerData)
        ? currentUser.providerData.map((p) => p?.providerId).filter(Boolean)
        : [];

      if (providerIds.includes('password')) {
        if (!reauthPassword.trim()) {
          throw new Error('Enter your password to re-authenticate.');
        }
        const credential = EmailAuthProvider.credential(currentEmail, reauthPassword);
        await reauthenticateWithCredential(currentUser, credential);
      } else if (Platform.OS === 'web' && providerIds.includes('google.com')) {
        await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
      } else {
        throw new Error('Please sign out and sign back in to continue this security step.');
      }

      setRequiresRecentLogin(false);
      setReauthPassword('');
      setUsernameNotice({ tone: 'success', title: 'Re-authenticated', message: 'Security check passed. You can now update your username.' });
    } catch (error) {
      setUsernameNotice({ tone: 'error', title: 'Re-authentication failed', message: error?.message || 'Could not verify your session.' });
    } finally {
      setIsReauthenticating(false);
    }
  };

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
            <Text style={{ color: AppColors.ink900, fontWeight: '900', marginBottom: 8 }}>Username & Account Security</Text>
            <Text style={{ color: '#475569', fontSize: 12, marginBottom: 8 }}>
              First username change is instant. From the second change onward, automatic KYC re-verification is required.
            </Text>

            <AppNotice tone={usernameNotice?.tone} title={usernameNotice?.title} message={usernameNotice?.message} style={{ marginBottom: 8 }} />

            <AppInput
              label="Current Username"
              value={currentUsername}
              editable={false}
              inputStyle={{ backgroundColor: '#f1f5f9', color: '#64748b' }}
            />

            <AppInput
              label="New Username"
              placeholder="Enter new username"
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              autoCapitalize="none"
            />

            {requiresRecentLogin ? (
              <View style={{ marginTop: 6, marginBottom: 10 }}>
                <Text style={{ color: '#92400e', fontWeight: '700', marginBottom: 6 }}>
                  Session expired for sensitive action. Re-authenticate to continue.
                </Text>
                <AppInput
                  label="Current Password"
                  placeholder="Enter your password"
                  value={reauthPassword}
                  onChangeText={setReauthPassword}
                  secureTextEntry
                />
                <TouchableOpacity
                  onPress={handleReauthenticate}
                  disabled={isReauthenticating}
                  style={{ backgroundColor: '#0f766e', borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{isReauthenticating ? 'Verifying...' : 'Re-authenticate Now'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {requiresKycReverification ? (
              <View style={{ marginTop: 6, marginBottom: 10 }}>
                <Text style={{ color: '#92400e', fontWeight: '700', marginBottom: 6 }}>
                  Additional verification required for repeated username changes
                </Text>
                <AppInput
                  label="Full Name (as submitted for KYC)"
                  placeholder="Full legal name"
                  value={usernameVerification.fullName}
                  onChangeText={(v) => setUsernameVerification((prev) => ({ ...prev, fullName: v }))}
                />
                <AppInput
                  label="Date of Birth"
                  placeholder="YYYY-MM-DD or YYYYMMDD"
                  value={usernameVerification.dob}
                  onChangeText={(v) => setUsernameVerification((prev) => ({ ...prev, dob: v }))}
                />
                <AppInput
                  label="ID Number"
                  placeholder="ID number used in KYC"
                  value={usernameVerification.idNumber}
                  onChangeText={(v) => setUsernameVerification((prev) => ({ ...prev, idNumber: v }))}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  onPress={uploadVerificationId}
                  disabled={isUploadingVerificationId}
                  style={{
                    backgroundColor: '#fff',
                    borderWidth: 1,
                    borderColor: '#cbd5e1',
                    borderRadius: AppRadius.md,
                    paddingVertical: 10,
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '800' }}>
                    {isUploadingVerificationId ? 'Uploading ID...' : 'Upload ID Card for Verification'}
                  </Text>
                </TouchableOpacity>
                {usernameVerification.idCardUrl ? (
                  <Text style={{ color: '#166534', fontSize: 12 }}>ID card uploaded ✅</Text>
                ) : (
                  <Text style={{ color: '#9a3412', fontSize: 12 }}>ID card upload required</Text>
                )}
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleUsernameChange}
              disabled={isChangingUsername}
              style={{ backgroundColor: '#2563eb', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>{isChangingUsername ? 'Updating...' : 'Update Username'}</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#0f172a', fontWeight: '800' }}>Recent Username Security Activity</Text>
                <TouchableOpacity onPress={loadUsernameAudit} disabled={isLoadingUsernameAudit}>
                  <Text style={{ color: '#2563eb', fontWeight: '700', fontSize: 12 }}>{isLoadingUsernameAudit ? 'Refreshing...' : 'Refresh'}</Text>
                </TouchableOpacity>
              </View>
              {usernameAuditPreview.length ? (
                usernameAuditPreview.map((entry, index) => {
                  const when = new Date(entry.createdAt || entry.attemptedAt || Date.now());
                  const whenLabel = Number.isNaN(when.getTime()) ? 'Unknown time' : when.toLocaleString();
                  const success = String(entry.outcome || '').toLowerCase() === 'success';
                  const color = success ? '#166534' : '#b91c1c';
                  const label = success ? 'Success' : 'Blocked';
                  const detail = success
                    ? `Changed to ${entry.newUsername || 'new username'}`
                    : String(entry.reason || 'failed_attempt').replace(/_/g, ' ');
                  return (
                    <View key={String(entry.id || `${entry.createdAt || entry.attemptedAt || 'event'}_${index}`)} style={{ marginTop: 8, backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 8 }}>
                      <Text style={{ color, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                      <Text style={{ color: '#334155', fontSize: 12, marginTop: 2 }}>{detail}</Text>
                      <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{whenLabel}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>No recent username security events yet.</Text>
              )}
            </View>
          </AppCard>

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
            <TouchableOpacity onPress={() => router.push('/terms')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
              <Text style={{ color: AppColors.ink900 }}>Terms of Service  →</Text>
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
