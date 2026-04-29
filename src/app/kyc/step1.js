/**
 * KYC Step 1 — Personal Information
 * Collects: full name, DOB, gender, nationality, country of residence, city, home address, occupation
 */
import { useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppInput from '../../components/ui/app-input';
import AppNotice from '../../components/ui/app-notice';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Review'];

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

  const [form, setForm] = useState({
    fullName: '',
    dob: '',
    gender: '',
    nationality: '',
    countryOfResidence: '',
    city: '',
    homeAddress: '',
    occupation: '',
  });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  // Pre-fill from any existing draft
  useEffect(() => {
    (async () => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) return;
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
          }));
        }
      } catch {
        // silent — proceed with blank form
      }
    })();
  }, []);

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = 'Full legal name is required';
    if (!form.dob.trim()) next.dob = 'Date of birth is required';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dob.trim())) next.dob = 'Use YYYY-MM-DD format';
    if (!form.gender) next.gender = 'Please select a gender';
    if (!form.nationality.trim()) next.nationality = 'Nationality is required';
    if (!form.countryOfResidence.trim()) next.countryOfResidence = 'Country of residence is required';
    if (!form.city.trim()) next.city = 'City is required';
    if (!form.homeAddress.trim()) next.homeAddress = 'Home address is required';
    if (!form.occupation.trim()) next.occupation = 'Occupation is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleNext = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const email = (user.email || '').trim().toLowerCase();

      await setDoc(
        doc(db, 'kyc_submissions', email),
        {
          email,
          fullName: form.fullName.trim(),
          dob: form.dob.trim(),
          gender: form.gender,
          nationality: form.nationality.trim(),
          countryOfResidence: form.countryOfResidence.trim(),
          city: form.city.trim(),
          homeAddress: form.homeAddress.trim(),
          occupation: form.occupation.trim(),
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

          <AppInput
            label="Full Legal Name"
            placeholder="As it appears on your ID"
            value={form.fullName}
            onChangeText={(v) => set('fullName', v)}
            error={errors.fullName}
            autoCapitalize="words"
          />

          <AppInput
            label="Date of Birth"
            placeholder="YYYY-MM-DD"
            value={form.dob}
            onChangeText={(v) => set('dob', v)}
            error={errors.dob}
            keyboardType="numeric"
          />

          {/* Gender picker */}
          <Text style={{ fontSize: AppType.body, fontWeight: '600', color: AppColors.ink900, marginBottom: AppSpace.xs }}>
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
          />

          <AppInput
            label="Country of Residence"
            placeholder="e.g. Ghana"
            value={form.countryOfResidence}
            onChangeText={(v) => set('countryOfResidence', v)}
            error={errors.countryOfResidence}
            autoCapitalize="sentences"
          />

          <AppInput
            label="City"
            placeholder="e.g. Accra"
            value={form.city}
            onChangeText={(v) => set('city', v)}
            error={errors.city}
            autoCapitalize="sentences"
          />

          <AppInput
            label="Home Address"
            placeholder="Street, area, landmark"
            value={form.homeAddress}
            onChangeText={(v) => set('homeAddress', v)}
            error={errors.homeAddress}
            autoCapitalize="sentences"
            multiline
          />

          <AppInput
            label="Occupation"
            placeholder="Your current job or profession"
            value={form.occupation}
            onChangeText={(v) => set('occupation', v)}
            error={errors.occupation}
            autoCapitalize="sentences"
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
