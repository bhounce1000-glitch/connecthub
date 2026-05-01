import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useState } from 'react';
import {
    FlatList,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

import { CATEGORY_ICONS } from '../constants/access';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { auth, db, storage } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

const CATEGORIES = Object.keys(CATEGORY_ICONS);
const TOTAL_STEPS = 4;

export default function RequestWizard() {
  const router = useRouter();
  const { user } = useAuthUser();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isFlexible, setIsFlexible] = useState(false);
  const [urgency, setUrgency] = useState('normal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [imageUri, setImageUri] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageUri(URL.createObjectURL(file));
        await uploadImage(file);
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { setError('Grant photo library access to attach an image.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const { uri } = result.assets[0];
      setImageUri(uri);
      const blob = await (await fetch(uri)).blob();
      await uploadImage(blob);
    }
  };

  const uploadImage = async (fileOrBlob) => {
    setIsUploadingImage(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not authenticated');
      const storageRef = ref(storage, `request-images/${uid}/${Date.now()}`);
      await uploadBytes(storageRef, fileOrBlob);
      const url = await getDownloadURL(storageRef);
      setImageUrl(url);
    } catch {
      setError('Image upload failed. You can still post without one.');
      setImageUri(null);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const progressPct = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  const goNext = () => {
    setError('');
    if (step === 1 && !category) { setError('Please select a category.'); return; }
    if (step === 2 && !title.trim()) { setError('Please enter a job title.'); return; }
    if (step === 2 && !location.trim()) { setError('Please enter a location.'); return; }
    if (step === 3 && !isFlexible && (!price.trim() || isNaN(Number(price)))) { setError('Please enter a valid price.'); return; }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };

  const goBack = () => { setError(''); setStep((s) => Math.max(s - 1, 1)); };

  const handleSubmit = async () => {
    if (!user?.email) return;
    setIsSubmitting(true);
    setError('');
    try {
      await addDoc(collection(db, 'requests'), {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        price: isFlexible ? 0 : Number(price),
        category,
        urgency,
        preferredDate: preferredDate.trim(),
        image: imageUrl || '',
        user: user.email,
        status: 'open',
        paid: false,
        acceptedBy: null,
        createdAt: serverTimestamp(),
      });
      setIsSuccess(true);
    } catch (_e) {
      setError('Failed to post job. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: AppSpace.xl }}>
        <Text style={{ fontSize: 60, marginBottom: 16 }}>🎉</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: '#f8fafc', textAlign: 'center', marginBottom: 8 }}>
          Your job is live!
        </Text>
        <Text style={{ fontSize: 15, color: '#94a3b8', textAlign: 'center', marginBottom: 32 }}>
          Providers will respond shortly. You&apos;ll get a notification when someone accepts.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/home')}
          style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.md, paddingVertical: 14, paddingHorizontal: 32 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Go to Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setIsSuccess(false); setStep(1); setCategory(''); setTitle(''); setDescription(''); setLocation(''); setPrice(''); setPreferredDate(''); setIsFlexible(false); setUrgency('normal'); }} style={{ marginTop: 16 }}>
          <Text style={{ color: '#6366f1', fontWeight: '600' }}>Post another job</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        {/* Header */}
        <View style={{ backgroundColor: '#0f172a', paddingTop: 52, paddingBottom: 20, paddingHorizontal: AppSpace.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <TouchableOpacity onPress={() => (step === 1 ? router.back() : goBack())} style={{ marginRight: 12, padding: 4 }}>
              <Text style={{ color: '#93c5fd', fontSize: 22 }}>←</Text>
            </TouchableOpacity>
            <Text style={{ color: '#f8fafc', fontWeight: '800', fontSize: 18, flex: 1 }}>Post a Job</Text>
            <Text style={{ color: '#94a3b8', fontSize: 13 }}>Step {step} of {TOTAL_STEPS}</Text>
          </View>
          {/* Progress bar */}
          <View style={{ height: 4, backgroundColor: '#334155', borderRadius: 2 }}>
            <View style={{ height: 4, backgroundColor: '#6366f1', borderRadius: 2, width: `${progressPct}%` }} />
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: AppSpace.lg }} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={{ backgroundColor: '#fef2f2', borderRadius: AppRadius.md, padding: 12, marginBottom: 16 }}>
              <Text style={{ color: '#dc2626', fontWeight: '600' }}>{error}</Text>
            </View>
          ) : null}

          {/* Step 1 — Category */}
          {step === 1 && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>What type of service?</Text>
              <Text style={{ color: AppColors.ink500, marginBottom: 20 }}>Pick the category that best describes your job.</Text>
              <FlatList
                data={CATEGORIES}
                numColumns={2}
                keyExtractor={(c) => c}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 10, marginBottom: 10 }}
                renderItem={({ item: cat }) => {
                  const active = cat === category;
                  return (
                    <TouchableOpacity
                      onPress={() => setCategory(cat)}
                      style={{
                        flex: 1,
                        paddingVertical: 18,
                        paddingHorizontal: 10,
                        borderRadius: AppRadius.lg,
                        borderWidth: 2,
                        borderColor: active ? '#4f46e5' : '#e2e8f0',
                        backgroundColor: active ? '#eef2ff' : '#fff',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 26, marginBottom: 6 }}>{CATEGORY_ICONS[cat] || '✨'}</Text>
                      <Text style={{ fontWeight: '700', fontSize: 12, color: active ? '#4f46e5' : AppColors.ink700, textAlign: 'center' }}>{cat}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          )}

          {/* Step 2 — Job Details */}
          {step === 2 && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>Job Details</Text>
              <Text style={{ color: AppColors.ink500, marginBottom: 20 }}>Give providers enough information to respond.</Text>

              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Job Title *</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Fix leaking kitchen pipe"
                placeholderTextColor="#94a3b8"
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 14, fontSize: 15, color: AppColors.ink900, marginBottom: 14 }}
              />

              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Location *</Text>
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Accra, East Legon"
                placeholderTextColor="#94a3b8"
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 14, fontSize: 15, color: AppColors.ink900, marginBottom: 14 }}
              />

              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe the job in detail..."
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 14, fontSize: 15, color: AppColors.ink900, marginBottom: 14, height: 110, textAlignVertical: 'top' }}
              />

              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Preferred Date (optional)</Text>
              <TextInput
                value={preferredDate}
                onChangeText={setPreferredDate}
                placeholder="e.g. 2026-02-14 or ASAP"
                placeholderTextColor="#94a3b8"
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 14, fontSize: 15, color: AppColors.ink900 }}
              />

              {/* Image attachment */}
              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginTop: 14, marginBottom: 6 }}>Photo (optional)</Text>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={{ width: '100%', height: 160, borderRadius: AppRadius.md, marginBottom: 8 }} resizeMode="cover" />
              ) : null}
              <TouchableOpacity
                onPress={pickImage}
                disabled={isUploadingImage}
                style={{ backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#4f46e5', fontWeight: '600' }}>
                  {isUploadingImage ? 'Uploading...' : imageUri ? '📷 Change Photo' : '📷 Attach Photo'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 3 — Budget */}
          {step === 3 && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>Budget & Urgency</Text>
              <Text style={{ color: AppColors.ink500, marginBottom: 20 }}>Set your price expectation and how soon you need it.</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <TouchableOpacity
                  onPress={() => setIsFlexible((f) => !f)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: isFlexible ? '#4f46e5' : '#e2e8f0', backgroundColor: isFlexible ? '#4f46e5' : '#fff', justifyContent: 'center', alignItems: 'center' }}>
                    {isFlexible && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={{ fontWeight: '600', color: AppColors.ink900, fontSize: 15 }}>I&apos;m flexible on price</Text>
                </TouchableOpacity>
              </View>

              {!isFlexible && (
                <>
                  <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Budget (GHS) *</Text>
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    placeholder="e.g. 150"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 14, fontSize: 15, color: AppColors.ink900, marginBottom: 20 }}
                  />
                </>
              )}

              <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 10 }}>Urgency</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {[
                  { value: 'normal', label: '📅 Normal', desc: 'Within a few days' },
                  { value: 'urgent', label: '🚨 Urgent', desc: 'ASAP / Today' },
                ].map((opt) => {
                  const active = urgency === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setUrgency(opt.value)}
                      style={{ flex: 1, padding: 16, borderRadius: AppRadius.lg, borderWidth: 2, borderColor: active ? '#4f46e5' : '#e2e8f0', backgroundColor: active ? '#eef2ff' : '#fff', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 20, marginBottom: 4 }}>{opt.label.split(' ')[0]}</Text>
                      <Text style={{ fontWeight: '700', color: active ? '#4f46e5' : AppColors.ink900 }}>{opt.label.split(' ')[1]}</Text>
                      <Text style={{ fontSize: 11, color: AppColors.ink500, marginTop: 2, textAlign: 'center' }}>{opt.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>Review & Post</Text>
              <Text style={{ color: AppColors.ink500, marginBottom: 20 }}>Confirm your job details before going live.</Text>

              <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', gap: 10 }}>
                <Row label="Category" value={`${CATEGORY_ICONS[category] || ''} ${category}`} />
                <Row label="Title" value={title} />
                {location ? <Row label="Location" value={location} /> : null}
                {description ? <Row label="Description" value={description} /> : null}
                {preferredDate ? <Row label="Preferred Date" value={preferredDate} /> : null}
                <Row label="Budget" value={isFlexible ? 'Flexible' : `GHS ${price}`} />
                <Row label="Urgency" value={urgency === 'urgent' ? '🚨 Urgent' : '📅 Normal'} />
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={{ width: '100%', height: 140, borderRadius: AppRadius.md, marginTop: 4 }} resizeMode="cover" />
                ) : null}
              </View>

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isSubmitting}
                style={{ marginTop: 24, backgroundColor: isSubmitting ? '#a5b4fc' : '#4f46e5', borderRadius: AppRadius.md, paddingVertical: 16, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                  {isSubmitting ? 'Posting...' : '🚀 Post Job'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Nav buttons (steps 1-3) */}
          {step < TOTAL_STEPS && (
            <TouchableOpacity
              onPress={goNext}
              style={{ marginTop: 24, backgroundColor: '#4f46e5', borderRadius: AppRadius.md, paddingVertical: 16, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Next →</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ color: AppColors.ink500, fontSize: 13, width: 100, flexShrink: 0 }}>{label}:</Text>
      <Text style={{ color: AppColors.ink900, fontWeight: '600', fontSize: 13, flex: 1 }}>{value}</Text>
    </View>
  );
}
