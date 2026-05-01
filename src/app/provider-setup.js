import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { KYC_STATUS } from '../constants/access';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { useUserProfile } from '../hooks/use-user-profile';

export const SERVICE_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Cleaning',
  'Carpentry',
  'Painting',
  'Moving & Transport',
  'Gardening & Landscaping',
  'Tech & IT Support',
  'Tutoring & Teaching',
  'Tailoring & Fashion',
  'Cooking & Catering',
  'Security',
  'Other',
];

export default function ProviderSetup() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const { profile: userProfile } = useUserProfile(currentEmail);
  const isKycVerified = userProfile?.kycStatus === KYC_STATUS.VERIFIED;

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [experience, setExperience] = useState('');
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  // Load existing provider profile if it exists
  useEffect(() => {
    if (!currentEmail) return;

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'providers', currentEmail));
        if (snap.exists()) {
          const data = snap.data();
          setName(data.name || '');
          setBio(data.bio || '');
          setCategory(data.category || '');
          setLocation(data.location || '');
          setPhone(data.phone || '');
          setStartingPrice(data.startingPrice || '');
          setExperience(data.experience || '');
          setSkills(Array.isArray(data.skills) ? data.skills : []);
          setIsAvailable(data.isAvailable !== false);
        }
      } catch {
        // Non-blocking — fresh form if load fails
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [currentEmail]);

  const validate = () => {
    const errors = {};
    const trimmedName = name.trim();
    const trimmedBio = bio.trim();
    const trimmedLocation = location.trim();
    const trimmedPhone = phone.trim();
    const trimmedPrice = startingPrice.trim();
    const trimmedExp = experience.trim();

    if (!trimmedName) {
      errors.name = 'Enter your full name or business name.';
    } else if (trimmedName.length > 100) {
      errors.name = 'Name must be 100 characters or fewer.';
    }

    if (!trimmedBio) {
      errors.bio = 'Write a short description of what you offer.';
    } else if (trimmedBio.length > 500) {
      errors.bio = 'Bio must be 500 characters or fewer.';
    }

    if (!category) {
      errors.category = 'Select the service category that best matches your work.';
    }

    if (!trimmedLocation) {
      errors.location = 'Enter the area or city you serve.';
    } else if (trimmedLocation.length > 200) {
      errors.location = 'Location must be 200 characters or fewer.';
    }

    if (trimmedPhone && !/^\+?[\d\s\-()]{7,20}$/.test(trimmedPhone)) {
      errors.phone = 'Enter a valid phone number.';
    }

    if (trimmedPrice) {
      const parsed = Number(trimmedPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.startingPrice = 'Enter a valid price greater than zero.';
      } else if (parsed > 1_000_000) {
        errors.startingPrice = 'Price cannot exceed 1,000,000.';
      }
    }

    if (trimmedExp) {
      const parsed = Number(trimmedExp);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) {
        errors.experience = 'Enter valid years of experience (0–60).';
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setNotice({ tone: 'error', title: 'Review your details', message: 'Fix the highlighted fields and try again.' });
      return false;
    }

    setNotice(null);
    return true;
  };

  const handleSave = async () => {
    if (!isKycVerified) {
      setNotice({ tone: 'warning', title: 'KYC Required', message: 'You must complete identity verification (KYC) before setting up a provider profile. Go to your profile to start.' });
      return;
    }
    if (!validate()) return;

    setIsSaving(true);
    setNotice(null);

    try {
      await setDoc(
        doc(db, 'providers', currentEmail),
        {
          email: currentEmail,
          name: name.trim(),
          bio: bio.trim(),
          category,
          location: location.trim(),
          phone: phone.trim(),
          startingPrice: startingPrice.trim(),
          experience: experience.trim(),
          skills: skills.filter((s) => s.trim().length > 0),
          isAvailable,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
        { merge: true }
      );

      setNotice({ tone: 'success', title: 'Profile saved!', message: 'Your provider profile is now visible to clients.' });
    } catch {
      setNotice({ tone: 'error', title: 'Could not save', message: 'Something went wrong. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenShell
        eyebrow="PROVIDER"
        title="Set Up Profile"
        subtitle="Loading your details..."
        accentColor="#4f46e5"
        accentTextColor="#e0e7ff"
        backgroundColor="#eef2ff"
      >
        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <Text style={{ color: AppColors.ink500 }}>Loading...</Text>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#eef2ff' }}>
      <View style={{ padding: AppSpace.lg }}>
        {/* Header */}
        <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
          <Text style={{ fontSize: AppType.overline, color: '#c7d2fe', fontWeight: '700', letterSpacing: 0.4, fontFamily: 'serif' }}>
            PROVIDER
          </Text>
          <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.white, marginTop: 4 }}>
            Set Up Profile
          </Text>
          <Text style={{ color: '#e0e7ff', marginTop: 6, lineHeight: 20 }}>
            Fill in your details so clients can find and trust you.
          </Text>
        </View>

        <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: AppSpace.md }} />

        {/* Availability toggle */}
        <View style={{
          backgroundColor: AppColors.white,
          borderRadius: AppRadius.lg,
          borderWidth: 1,
          borderColor: '#dbe4ef',
          padding: 16,
          marginBottom: AppSpace.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontWeight: '700', fontSize: AppType.body, color: AppColors.ink900 }}>Available for Work</Text>
            <Text style={{ fontSize: 13, color: AppColors.ink500, marginTop: 3 }}>
              {isAvailable ? 'You are visible to clients as available' : 'Hidden — clients will not see you as available'}
            </Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={setIsAvailable}
            trackColor={{ false: '#cbd5e1', true: '#818cf8' }}
            thumbColor={isAvailable ? '#4f46e5' : AppColors.white}
          />
        </View>

        {/* Main form card */}
        <View style={{
          backgroundColor: AppColors.white,
          borderRadius: AppRadius.lg,
          borderWidth: 1,
          borderColor: '#dbe4ef',
          padding: 16,
          marginBottom: AppSpace.md,
          shadowColor: '#0f172a',
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}>
          <AppInput
            label="Full Name / Business Name *"
            placeholder="e.g. John Mensah Electricals"
            value={name}
            onChangeText={setName}
            editable={!isSaving}
            error={fieldErrors.name}
          />

          <AppInput
            label="About You *"
            placeholder="Describe your skills, experience, and what makes you reliable…"
            value={bio}
            onChangeText={setBio}
            editable={!isSaving}
            multiline
            error={fieldErrors.bio}
          />

          {/* Category selector */}
          <Text style={{ fontSize: AppType.body, fontWeight: '600', color: AppColors.ink900, marginBottom: AppSpace.xs }}>
            Service Category *
          </Text>
          {fieldErrors.category ? (
            <Text style={{ color: '#b91c1c', fontSize: 13, marginBottom: AppSpace.xs }}>{fieldErrors.category}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: AppSpace.md }}>
            {SERVICE_CATEGORIES.map((cat) => {
              const selected = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: AppRadius.md,
                    backgroundColor: selected ? '#4f46e5' : '#f1f5f9',
                    borderWidth: 1,
                    borderColor: selected ? '#4f46e5' : '#cbd5e1',
                  }}
                >
                  <Text style={{ fontWeight: '600', fontSize: 13, color: selected ? AppColors.white : AppColors.ink700 }}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <AppInput
            label="Service Location / Area *"
            placeholder="e.g. Accra, East Legon"
            value={location}
            onChangeText={setLocation}
            editable={!isSaving}
            error={fieldErrors.location}
          />

          <AppInput
            label="Phone Number (optional)"
            placeholder="e.g. +233 20 000 0000"
            value={phone}
            onChangeText={setPhone}
            editable={!isSaving}
            error={fieldErrors.phone}
            keyboardType="phone-pad"
          />

          <AppInput
            label="Starting Price — GHS (optional)"
            placeholder="e.g. 50"
            value={startingPrice}
            onChangeText={setStartingPrice}
            editable={!isSaving}
            error={fieldErrors.startingPrice}
            keyboardType="numeric"
          />

          <AppInput
            label="Years of Experience (optional)"
            placeholder="e.g. 5"
            value={experience}
            onChangeText={setExperience}
            editable={!isSaving}
            error={fieldErrors.experience}
            keyboardType="numeric"
            containerStyle={{ marginBottom: 0 }}
          />

          {/* Skills section */}
          <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 20 }}>
            <Text style={{ fontWeight: '700', fontSize: 14, color: AppColors.ink900, marginBottom: 8 }}>
              🏆 Skills & Tags (optional)
            </Text>
            <Text style={{ fontSize: 12, color: AppColors.ink500, marginBottom: 12 }}>
              Add skills to help clients find you. Press Enter to add.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput
                value={skillInput}
                onChangeText={setSkillInput}
                placeholder="e.g. Pipe Repair, Gas Fitting, Leaks"
                placeholderTextColor="#94a3b8"
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  borderRadius: AppRadius.md,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  fontSize: 13,
                  color: AppColors.ink900,
                }}
                editable={!isSaving}
                onSubmitEditing={() => {
                  if (skillInput.trim() && !skills.includes(skillInput.trim())) {
                    setSkills([...skills, skillInput.trim()]);
                    setSkillInput('');
                  }
                }}
              />
              <TouchableOpacity
                onPress={() => {
                  if (skillInput.trim() && !skills.includes(skillInput.trim())) {
                    setSkills([...skills, skillInput.trim()]);
                    setSkillInput('');
                  }
                }}
                disabled={!skillInput.trim()}
                style={{
                  backgroundColor: skillInput.trim() ? '#4f46e5' : '#cbd5e1',
                  borderRadius: AppRadius.md,
                  paddingHorizontal: 14,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Add</Text>
              </TouchableOpacity>
            </View>
            {skills.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {skills.map((skill, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setSkills(skills.filter((_, i) => i !== idx))}
                    style={{
                      backgroundColor: '#eef2ff',
                      borderRadius: 16,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderWidth: 1,
                      borderColor: '#4f46e5',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: '#4f46e5', fontWeight: '600', fontSize: 12 }}>{skill}</Text>
                    <Text style={{ color: '#4f46e5', fontWeight: '800', fontSize: 12 }}>×</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        <AppButton
          label="Save Provider Profile"
          variant="primary"
          onPress={handleSave}
          disabled={isSaving}
          loading={isSaving}
          style={{ marginBottom: AppSpace.sm, backgroundColor: '#4f46e5' }}
        />

        <AppButton
          label="← Back"
          variant="neutral"
          onPress={() => router.back()}
          style={{ marginBottom: AppSpace.lg }}
        />
      </View>
    </ScrollView>
  );
}
