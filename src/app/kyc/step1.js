/**
 * KYC Step 1 — Personal Information
 * Collects: full name, DOB, gender, nationality, country of residence, city, home address, occupation
 */
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Alert, Image, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppInput from '../../components/ui/app-input';
import AppNotice from '../../components/ui/app-notice';
import { KYC_STATUS } from '../../constants/access';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Face', 'Review'];

const uploadProfilePhoto = async (file) => {
  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) throw new Error('Not authenticated');

  const storage = getStorage();
  const userId = currentUser.uid;
  const fileName = `profile_${Date.now()}.jpg`;
  const storagePath = `kyc_photos/${userId}/${fileName}`;
  const storageRef = ref(storage, storagePath);

  let uploadData = file;
  if (Platform.OS !== 'web' && file?.uri) {
    const response = await fetch(file.uri);
    uploadData = await response.blob();
  }

  await uploadBytes(storageRef, uploadData);
  const downloadURL = await getDownloadURL(storageRef);
  return downloadURL;
};

function StepIndicator({ current }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: AppSpace.xl, paddingHorizontal: AppSpace.lg }}>
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              {i > 0 && (
                <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />
              )}
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: done ? '#6366f1' : active ? '#6366f1' : '#e2e8f0',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: active ? 2 : 0,
                  borderColor: active ? '#818cf8' : 'transparent',
                }}
              >
                <Text style={{ color: done || active ? '#fff' : AppColors.ink500, fontSize: 12, fontWeight: '700' }}>
                  {done ? '✓' : String(i + 1)}
                </Text>
              </View>
              {i < STEP_LABELS.length - 1 && (
                <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />
              )}
            </View>
            <Text style={{ fontSize: 10, color: active ? '#6366f1' : AppColors.ink500, marginTop: 4, fontWeight: active ? '700' : '400' }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function KycStep1() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  const [form, setForm] = useState({
    fullName: '',
    dob: '',
    gender: '',
    nationality: '',
    countryOfResidence: '',
    city: '',
    homeAddress: '',
    occupation: '',
    profilePhotoUrl: '',
  });
  const [profilePhotoFile, setProfilePhotoFile] = useState(null); // File or {uri, name, type}
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthReady && !user?.email) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  // Guard against direct URL access when KYC has already been reviewed.
  useEffect(() => {
    (async () => {
      if (!isAuthReady || !user?.email) {
        return;
      }

      try {
        const email = (user.email || '').trim().toLowerCase();
        const [userSnap, submissionSnap] = await Promise.all([
          getDoc(doc(db, 'users', email)),
          getDoc(doc(db, 'kyc_submissions', email)),
        ]);

        const userStatus = String(userSnap.exists() ? userSnap.data()?.kycStatus || '' : '').trim().toLowerCase();
        const submissionStatus = String(submissionSnap.exists() ? submissionSnap.data()?.kycStatus || '' : '').trim().toLowerCase();
        const effectiveKycStatus = submissionStatus || userStatus;

        if (effectiveKycStatus === KYC_STATUS.VERIFIED) {
          router.replace('/home');
        } else if (effectiveKycStatus === KYC_STATUS.PENDING_VERIFICATION) {
          router.replace('/kyc/pending');
        } else if (effectiveKycStatus === KYC_STATUS.REJECTED) {
          router.replace('/kyc/rejected');
        }
      } catch {
        // If lookup fails, keep step 1 accessible as fallback.
      }
    })();
  }, [isAuthReady, router, user?.email]);

  // Pre-fill from any existing draft
  useEffect(() => {
    (async () => {
      if (!user?.email) return;
      try {
        const email = (user.email || '').trim().toLowerCase();
        const snap = await getDoc(doc(db, 'kyc_submissions', email));
        if (snap.exists()) {
          const d = snap.data();
          setForm((prev) => ({
            ...prev,
            fullName: d.fullName || '',
            dob: d.dob || '',
            gender: d.gender || '',
            nationality: d.nationality || '',
            countryOfResidence: d.countryOfResidence || '',
            city: d.city || '',
            homeAddress: d.homeAddress || '',
            occupation: d.occupation || '',
            profilePhotoUrl: d.profilePhotoUrl || '',
          }));
        }
      } catch {
        // silent — proceed with blank form
      }
    })();
  }, [user?.email]);

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = 'Full legal name is required';
    if (!form.dob.trim()) next.dob = 'Date of birth is required';
    else if (!/^\d{8}$/.test(form.dob.trim())) next.dob = 'Use YYYYMMDD format (numbers only, e.g. 19900115)';
    else {
      // Age validation (must be 18+)
      const raw = form.dob.trim();
      const year = Number(raw.slice(0, 4));
      const month = Number(raw.slice(4, 6));
      const day = Number(raw.slice(6, 8));
      const dobDate = new Date(year, month - 1, day);
      const now = new Date();
      const age = now.getFullYear() - dobDate.getFullYear() - (now.getMonth() < dobDate.getMonth() || (now.getMonth() === dobDate.getMonth() && now.getDate() < dobDate.getDate()) ? 1 : 0);
      if (isNaN(age) || age < 18) next.dob = 'You must be at least 18 years old';
    }
    if (!form.gender) next.gender = 'Please select a gender';
    if (!form.nationality.trim()) next.nationality = 'Nationality is required';
    if (!form.countryOfResidence.trim()) next.countryOfResidence = 'Country of residence is required';
    if (!form.city.trim()) next.city = 'City is required';
    if (!form.homeAddress.trim()) next.homeAddress = 'Home address is required';
    if (!form.occupation.trim()) next.occupation = 'Occupation is required';
    if (!form.profilePhotoUrl) next.profilePhotoUrl = 'Profile photo is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleNext = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (!user?.email) throw new Error('Not authenticated');
      const email = (user.email || '').trim().toLowerCase();
      const nationality = typeof form.nationality === 'object'
        ? (form.nationality?.name || form.nationality?.cca2 || '')
        : (form.nationality || '');
      const countryOfResidence = typeof form.countryOfResidence === 'object'
        ? (form.countryOfResidence?.name || form.countryOfResidence?.cca2 || '')
        : (form.countryOfResidence || '');

      let profilePhotoUrl = form.profilePhotoUrl;
      // If a new file is selected, upload it
      if (profilePhotoFile) {
        profilePhotoUrl = await uploadProfilePhoto(profilePhotoFile);
      }

      // Normalise 8-digit DOB to YYYY-MM-DD for storage consistency
      const rawDob = form.dob.trim();
      const storedDob = rawDob.length === 8
        ? `${rawDob.slice(0, 4)}-${rawDob.slice(4, 6)}-${rawDob.slice(6, 8)}`
        : rawDob;

      await setDoc(
        doc(db, 'kyc_submissions', email),
        {
          email,
          fullName: form.fullName.trim(),
          dob: storedDob,
          gender: String(form.gender || ''),
          nationality: String(nationality).trim(),
          countryOfResidence: String(countryOfResidence).trim(),
          city: form.city.trim(),
          homeAddress: form.homeAddress.trim(),
          occupation: form.occupation.trim(),
          profilePhotoUrl,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      router.push('/kyc/step2');
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Failed to save. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const maxW = 520;

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  // Cross-platform profile photo picker
  const pickProfilePhoto = async () => {
    if (Platform.OS === 'web') {
      // Web: trigger file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          setProfilePhotoFile(file);
          setForm(prev => ({ ...prev, profilePhotoUrl: URL.createObjectURL(file) }));
        }
      };
      input.click();
    } else {
      // Mobile: use expo-image-picker
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'We need access to your photos to upload your profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setProfilePhotoFile(asset);
        setForm((prev) => ({ ...prev, profilePhotoUrl: asset.uri }));
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: maxW }}>
          {/* Header */}
          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
            Verify Your Identity
          </Text>
          <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
            This helps us keep ConnectHub safe and trustworthy for everyone.
          </Text>

          <StepIndicator current={0} />

          {notice && (
            <AppNotice type={notice.type} message={notice.message} style={{ marginBottom: AppSpace.md }} />
          )}

          <Text style={sectionTitle}>Personal Information</Text>

          {/* Profile Photo Upload */}
          <Text style={{ fontSize: AppType.body, fontWeight: '700', color: '#6366f1', marginBottom: AppSpace.xs }}>
            Profile Photo <Text style={{ color: '#f87171' }}>*</Text>
          </Text>
          {errors.profilePhotoUrl ? (
            <Text style={{ color: '#b91c1c', fontSize: 13, marginBottom: AppSpace.xs }}>{errors.profilePhotoUrl}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: AppSpace.md }}>
            {form.profilePhotoUrl ? (
              <Image
                source={{ uri: form.profilePhotoUrl }}
                style={{ width: 64, height: 64, borderRadius: 32, marginRight: 16, borderWidth: 2, borderColor: '#6366f1' }}
              />
            ) : null}
            <TouchableOpacity
              onPress={pickProfilePhoto}
              style={{ backgroundColor: '#6366f1', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{form.profilePhotoUrl ? 'Replace Photo' : 'Upload Photo'}</Text>
            </TouchableOpacity>
          </View>

          <AppInput
            label="Full Legal Name"
            placeholder="As it appears on your ID"
            value={form.fullName}
            onChangeText={(v) => set('fullName', v)}
            error={errors.fullName}
            autoCapitalize="words"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="Date of Birth"
            placeholder="YYYYMMDD"
            value={form.dob}
            onChangeText={(v) => set('dob', v)}
            error={errors.dob}
            keyboardType="numeric"
            maxLength={8}
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          {/* Gender picker */}
          <Text style={{ fontSize: AppType.body, fontWeight: '700', color: '#6366f1', marginBottom: AppSpace.xs }}>
            Gender
          </Text>
          {errors.gender ? (
            <Text style={{ color: '#b91c1c', fontSize: 13, marginBottom: AppSpace.xs }}>{errors.gender}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: AppSpace.md }}>
            {GENDERS.map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => set('gender', g)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: AppRadius.xl,
                  backgroundColor: form.gender === g ? '#6366f1' : AppColors.white,
                  borderWidth: 1,
                  borderColor: form.gender === g ? '#6366f1' : '#cbd5e1',
                }}
              >
                <Text style={{ color: form.gender === g ? '#fff' : AppColors.ink700, fontWeight: '600', fontSize: 13 }}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <AppInput
            label="Nationality"
            placeholder="e.g. Ghanaian"
            value={form.nationality}
            onChangeText={(v) => set('nationality', v)}
            error={errors.nationality}
            autoCapitalize="sentences"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="Country of Residence"
            placeholder="e.g. Ghana"
            value={form.countryOfResidence}
            onChangeText={(v) => set('countryOfResidence', v)}
            error={errors.countryOfResidence}
            autoCapitalize="sentences"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="City"
            placeholder="e.g. Accra"
            value={form.city}
            onChangeText={(v) => set('city', v)}
            error={errors.city}
            autoCapitalize="sentences"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="Home Address"
            placeholder="Street, area, landmark"
            value={form.homeAddress}
            onChangeText={(v) => set('homeAddress', v)}
            error={errors.homeAddress}
            autoCapitalize="sentences"
            multiline
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="Occupation"
            placeholder="Your current job or profession"
            value={form.occupation}
            onChangeText={(v) => set('occupation', v)}
            error={errors.occupation}
            autoCapitalize="sentences"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppButton
            label={loading ? 'Saving…' : 'Next: Identity Documents →'}
            onPress={handleNext}
            disabled={loading}
            style={{ marginTop: AppSpace.lg }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const sectionTitle = {
  fontSize: 13,
  fontWeight: '700',
  color: '#6366f1',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  marginBottom: AppSpace.md,
};
