import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, ToastAndroid, TouchableOpacity, View } from 'react-native';

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import { CATEGORY_ICONS, KYC_STATUS } from '../constants/access';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { useUserProfile } from '../hooks/use-user-profile';

export const SERVICE_CATEGORIES = [
  'Cleaning', 'Electrical', 'Plumbing', 'Carpentry', 'Painting', 'Moving',
  'Beauty', 'Cooking', 'Driving', 'Security', 'Mechanic', 'Other',
];

export default function ProviderSetup() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();
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
  const [notice, setNotice] = useState(null);
  const [existingCreatedAt, setExistingCreatedAt] = useState(null);

  useEffect(() => {
    if (isAuthReady && !user) router.replace('/auth');
  }, [isAuthReady, router, user]);

  useEffect(() => {
    if (!currentEmail) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'providers', currentEmail));
        if (snap.exists()) {
          const data = snap.data() || {};
          setExistingCreatedAt(data.createdAt || null);
          setName(data.name || '');
          setBio(data.bio || '');
          setCategory(data.category || '');
          setLocation(data.location || '');
          setPhone(data.phone || '');
          setStartingPrice(String(data.startingPrice || ''));
          setExperience(String(data.experience || ''));
          setSkills(Array.isArray(data.skills) ? data.skills : []);
          setIsAvailable(data.isAvailable !== false);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [currentEmail]);

  const addSkill = () => {
    const next = skillInput.trim();
    if (!next) return;
    if (!skills.includes(next)) setSkills((prev) => [...prev, next]);
    setSkillInput('');
  };

  const removeSkill = (skill) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const handleSave = async () => {
    if (!isKycVerified) {
      setNotice({ tone: 'warning', title: 'KYC Required', message: 'Complete KYC verification before enabling provider visibility.' });
      return;
    }
    if (!name.trim() || !bio.trim() || !location.trim() || !category) {
      setNotice({ tone: 'error', title: 'Missing details', message: 'Please complete name, about, category, and location.' });
      return;
    }
    if (bio.trim().length > 300) {
      setNotice({ tone: 'error', title: 'Bio too long', message: 'Keep your bio within 300 characters.' });
      return;
    }
    const price = parseFloat(startingPrice || 0);
    if (price > 0 && price < 10) {
      setNotice({ tone: 'error', title: 'Price too low', message: 'Minimum starting price is GHS 10.' });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    try {
      await setDoc(doc(db, 'providers', currentEmail), {
        email: currentEmail,
        name: name.trim(),
        bio: bio.trim(),
        category,
        location: location.trim(),
        phone: phone.trim(),
        startingPrice: String(startingPrice || '').trim(),
        experience: String(experience || '').trim(),
        skills,
        isAvailable,
        updatedAt: serverTimestamp(),
        createdAt: existingCreatedAt || serverTimestamp(),
      }, { merge: true });

      await setDoc(doc(db, 'providerProfiles', currentEmail), {
        email: currentEmail,
        name: name.trim(),
        bio: bio.trim(),
        category,
        location: location.trim(),
        phone: phone.trim(),
        startingPrice: String(startingPrice || '').trim(),
        experience: String(experience || '').trim(),
        skills,
        isAvailable,
        updatedAt: serverTimestamp(),
        createdAt: existingCreatedAt || serverTimestamp(),
      }, { merge: true });

      await setDoc(doc(db, 'users', currentEmail), {
        role: 'provider',
        name: name.trim(),
        phoneNumber: phone.trim(),
        location: location.trim(),
        category,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      // Show success toast
      if (ToastAndroid) {
        ToastAndroid.show('✅ Profile saved! You are now visible to clients.', ToastAndroid.LONG);
      } else {
        Alert.alert('Profile saved!', 'Your provider profile has been updated.');
      }
      setNotice({ tone: 'success', title: 'Saved', message: 'Your provider profile has been updated.' });
      // Navigate to home to show new listing
      router.replace('/home');
    } catch {
      setNotice({ tone: 'error', title: 'Save failed', message: 'Could not save profile right now.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        <Text style={{ color: '#64748b' }}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg, paddingBottom: 30 }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.md }}>
        <Text style={{ color: '#93c5fd', fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>PROVIDER</Text>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 26, marginTop: 4 }}>Set Up Profile</Text>
      </View>

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

      <View style={{
        backgroundColor: isAvailable ? '#dcfce7' : '#f1f5f9',
        borderWidth: 1,
        borderColor: isAvailable ? '#86efac' : '#cbd5e1',
        borderRadius: AppRadius.lg,
        padding: 14,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 15 }}>Available for Work</Text>
          <Text style={{ color: '#475569', marginTop: 4, fontSize: 13 }}>
            {isAvailable ? '✅ You are visible to clients' : '⛔ You are hidden from clients'}
          </Text>
        </View>
        <Switch value={isAvailable} onValueChange={setIsAvailable} />
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12, ...AppShadow.card }}>
        <Text style={{ fontWeight: '900', color: AppColors.ink900, marginBottom: 10 }}>👤 Personal Info</Text>
        <AppInput label="Full Name" placeholder="Your full or business name" value={name} onChangeText={setName} />
        <AppInput label="Phone" placeholder="+233 ..." value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <AppInput label="Location" placeholder="City / Area" value={location} onChangeText={setLocation} />
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>About You</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Tell clients about your experience"
          maxLength={300}
          multiline
          style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, minHeight: 88, paddingHorizontal: 12, paddingVertical: 10, color: AppColors.ink900, textAlignVertical: 'top' }}
        />
        <Text style={{ color: bio.length > 280 ? '#dc2626' : '#94a3b8', textAlign: 'right', marginTop: 6, fontSize: 12 }}>{bio.length} / 300</Text>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12, ...AppShadow.card }}>
        <Text style={{ fontWeight: '900', color: AppColors.ink900, marginBottom: 10 }}>🧰 Service Details</Text>
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 8 }}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {SERVICE_CATEGORIES.map((cat) => {
            const active = category === cat;
            return (
                <TouchableOpacity
                key={cat}
                onPress={() => setCategory(cat)}
                style={{
                  width: '31%',
                  paddingVertical: 10,
                  borderRadius: AppRadius.md,
                  backgroundColor: active ? '#2563eb' : '#f8fafc',
                  borderWidth: 1,
                  borderColor: active ? '#2563eb' : '#e2e8f0',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: active ? '#fff' : '#334155', fontWeight: '700', fontSize: 12 }}>
                  {CATEGORY_ICONS[cat] || '✨'} {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: 8 }}>
          <AppInput label="Starting Price (GHS)" placeholder="50" value={startingPrice} onChangeText={setStartingPrice} keyboardType="numeric" />
          <AppInput label="Experience (years)" placeholder="5" value={experience} onChangeText={setExperience} keyboardType="numeric" />
        </View>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12, ...AppShadow.card }}>
        <Text style={{ fontWeight: '900', color: AppColors.ink900, marginBottom: 10 }}>🏷 Skills & Tags</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {skills.map((skill) => (
            <View key={skill} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ color: '#1d4ed8', fontWeight: '700', fontSize: 12 }}>{skill}</Text>
              <TouchableOpacity onPress={() => removeSkill(skill)} style={{ marginLeft: 6 }}>
                <Text style={{ color: '#1d4ed8', fontWeight: '900' }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={skillInput}
            onChangeText={setSkillInput}
            onSubmitEditing={addSkill}
            placeholder="Add a skill tag"
            placeholderTextColor="#94a3b8"
            style={{ flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, paddingHorizontal: 12, paddingVertical: 10, color: AppColors.ink900 }}
          />
          <TouchableOpacity onPress={addSkill} style={{ backgroundColor: '#2563eb', borderRadius: AppRadius.md, paddingHorizontal: 14, justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => Alert.alert('Profile Preview', `${name || 'Your name'}\n${category || 'Category'}\n${location || 'Location'}\nFrom GHS ${startingPrice || '0'}\n\n${bio || 'Your bio will appear here.'}`)}
        style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#dbeafe' }}
      >
        <Text style={{ color: '#2563eb', fontWeight: '800' }}>Preview Profile</Text>
      </TouchableOpacity>

      <AppButton label="Save Provider Profile" variant="primary" onPress={handleSave} disabled={isSaving} loading={isSaving} loadingLabel="Saving..." style={{ marginBottom: 10 }} />

      <AppButton label="← Back" variant="neutral" onPress={() => router.back()} />
    </ScrollView>
  );
}
