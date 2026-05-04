/**
 * KYC Step 2 — Contact & Identity Documents
 * Collects: phone, alt phone, ID type, ID number, ID front photo, ID back photo
 */
import { Redirect, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppInput from '../../components/ui/app-input';
import AppNotice from '../../components/ui/app-notice';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

const ID_TYPES = ["National ID", "Passport", "Driver's License", "Voter's ID"];

const ID_TYPE_HINTS = {
  'National ID': 'e.g. GHA-12345678-0',
  Passport: 'e.g. A1234567',
  "Driver's License": 'e.g. D-1234-567890',
  "Voter's ID": 'e.g. VOT-123456789',
};

function normalizeIdNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function validateIdNumberByType(idType, rawValue) {
  const value = normalizeIdNumber(rawValue);
  if (!value) {
    return 'ID number is required';
  }

  const rules = {
    'National ID': /^GHA-\d{8}-\d$/,
    Passport: /^[A-Z][0-9]{7,8}$/,
    "Driver's License": /^[A-Z]-\d{4}-\d{6}$/,
    "Voter's ID": /^VOT-\d{9}$/,
  };

  const samples = {
    'National ID': 'GHA-12345678-0',
    Passport: 'A1234567',
    "Driver's License": 'D-1234-567890',
    "Voter's ID": 'VOT-123456789',
  };

  const rule = rules[idType];
  if (!rule) {
    return null;
  }

  if (!rule.test(value)) {
    return `Invalid ${idType} format. Example: ${samples[idType]}`;
  }

  return null;
}

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

async function pickAndUpload(side) {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) { resolve(null); return; }
        try {
          const auth = getAuth();
          const currentUser = auth.currentUser;
          if (!currentUser?.uid) {
            throw new Error('Not authenticated');
          }
          const storage = getStorage();
          const userId = currentUser.uid;
          const fileName = side === 'front' ? `front_${Date.now()}.jpg` : `back_${Date.now()}.jpg`;
          const storageRef = ref(storage, `kyc_documents/${userId}/${fileName}`);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      };
      input.click();
    });
  }
  // Native: would use expo-image-picker — return null for now
  return null;
}

export default function KycStep2() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  const [form, setForm] = useState({
    phone: '',
    altPhone: '',
    idType: '',
    idNumber: '',
    idFrontUrl: '',
    idBackUrl: '',
    countryCode: 'GH',
  });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState({ front: false, back: false });
  const [, setCountry] = useState({ cca2: 'GH', callingCode: ['233'] });

  useEffect(() => {
    if (isAuthReady && !user?.email) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

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
            phone: d.phone || '',
            countryCode: d.countryCode || 'GH',
            idType: d.idType || '',
            idNumber: d.idNumber || '',
            idFrontUrl: d.idFrontUrl || '',
            idBackUrl: d.idBackUrl || '',
          }));
          setCountry({ cca2: d.countryCode || 'GH', callingCode: d.callingCode || ['233'] });
        }
      } catch {
        // silent
      }
    })();
  }, [user?.email]);

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleUpload = async (side) => {
    setUploading((prev) => ({ ...prev, [side]: true }));
    setErrors((prev) => ({ ...prev, [`id${side === 'front' ? 'Front' : 'Back'}Url`]: undefined }));
    try {
      if (!user?.email) throw new Error('Not authenticated');
      const url = await pickAndUpload(side);
      if (url) {
        set(side === 'front' ? 'idFrontUrl' : 'idBackUrl', url);
        setNotice({ type: 'success', message: `ID ${side} photo uploaded.` });
      }
    } catch (err) {
      setNotice({ type: 'error', message: err.message || `Upload failed for ID ${side}.` });
    } finally {
      setUploading((prev) => ({ ...prev, [side]: false }));
    }
  };

  const validate = () => {
    const next = {};
    const phonePattern = /^\+?[\d\s\-()]{7,20}$/;
    if (!form.phone.trim()) next.phone = 'Phone number is required';
    else if (!phonePattern.test(form.phone.trim())) next.phone = 'Enter a valid phone number';
    if (form.altPhone.trim() && !phonePattern.test(form.altPhone.trim())) next.altPhone = 'Enter a valid phone number';
    if (!form.idType) next.idType = 'Please select an ID type';
    const idError = validateIdNumberByType(form.idType, form.idNumber);
    if (idError) next.idNumber = idError;
    if (!form.idFrontUrl) next.idFrontUrl = 'Front photo of ID is required';
    if (!form.countryCode) next.countryCode = 'Select country code';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleNext = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (!user?.email) throw new Error('Not authenticated');
      const email = (user.email || '').trim().toLowerCase();

      await setDoc(
        doc(db, 'kyc_submissions', email),
        {
          email,
          phone: form.phone.trim(),
          altPhone: form.altPhone.trim(),
          idType: form.idType,
          idNumber: normalizeIdNumber(form.idNumber),
          idFrontUrl: form.idFrontUrl,
          idBackUrl: form.idBackUrl,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      router.push('/kyc/step3');
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

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: maxW }}>
          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
            Verify Your Identity
          </Text>
          <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
            Step 2 of 4 — Contact details and government-issued ID.
          </Text>

          <StepIndicator current={1} />

          {notice && (
            <AppNotice type={notice.type} message={notice.message} style={{ marginBottom: AppSpace.md }} />
          )}

          <Text style={sectionTitle}>Contact Details</Text>

          <AppInput
            label="Primary Phone Number"
            placeholder="+233 20 000 0000"
            value={form.phone}
            onChangeText={(v) => set('phone', v)}
            error={errors.phone}
            keyboardType="phone-pad"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <AppInput
            label="Alternate Phone (optional)"
            placeholder="+233 24 000 0000"
            value={form.altPhone}
            onChangeText={(v) => set('altPhone', v)}
            error={errors.altPhone}
            keyboardType="phone-pad"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          <Text style={sectionTitle}>Identity Document</Text>

          {/* ID type picker */}
          <Text style={{ fontSize: AppType.body, fontWeight: '700', color: '#6366f1', marginBottom: AppSpace.xs }}>
            ID Type
          </Text>
          {errors.idType ? (
            <Text style={{ color: '#b91c1c', fontSize: 13, marginBottom: AppSpace.xs }}>{errors.idType}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: AppSpace.md }}>
            {ID_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => set('idType', t)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: AppRadius.xl,
                  backgroundColor: form.idType === t ? '#6366f1' : AppColors.white,
                  borderWidth: 1,
                  borderColor: form.idType === t ? '#6366f1' : '#cbd5e1',
                }}
              >
                <Text style={{ color: form.idType === t ? '#fff' : AppColors.ink700, fontWeight: '600', fontSize: 13 }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <AppInput
            label="ID Number"
            placeholder={ID_TYPE_HINTS[form.idType] || 'As shown on your document'}
            value={form.idNumber}
            onChangeText={(v) => set('idNumber', v)}
            error={errors.idNumber}
            autoCapitalize="characters"
            labelStyle={{ color: '#6366f1', fontWeight: '700', fontSize: 15 }}
          />

          {/* Photo uploads */}
          <Text style={sectionTitle}>Upload ID Photos</Text>

          <PhotoUploadRow
            label="Front of ID"
            uploaded={!!form.idFrontUrl}
            uploading={uploading.front}
            error={errors.idFrontUrl}
            onPress={() => handleUpload('front')}
          />

          <PhotoUploadRow
            label="Back of ID (if applicable)"
            uploaded={!!form.idBackUrl}
            uploading={uploading.back}
            error={errors.idBackUrl}
            onPress={() => handleUpload('back')}
          />

          <View style={{ flexDirection: 'row', gap: AppSpace.sm, marginTop: AppSpace.lg }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: AppRadius.lg,
                borderWidth: 1,
                borderColor: '#475569',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: AppColors.slate200, fontWeight: '600' }}>← Back</Text>
            </TouchableOpacity>

            <AppButton
              label={loading ? 'Saving…' : 'Next: Payment →'}
              onPress={handleNext}
              disabled={loading}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function PhotoUploadRow({ label, uploaded, uploading, error, onPress }) {
  return (
    <View style={{ marginBottom: AppSpace.md }}>
      <TouchableOpacity
        onPress={onPress}
        disabled={uploading}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: AppSpace.md,
          borderRadius: AppRadius.lg,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: error ? '#f87171' : uploaded ? '#22c55e' : '#475569',
          backgroundColor: uploaded ? '#052e16' : '#1e293b',
        }}
      >
        <Text style={{ fontSize: 24 }}>{uploading ? '⏳' : uploaded ? '✅' : '📎'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: AppColors.white, fontWeight: '600', fontSize: AppType.body }}>{label}</Text>
          <Text style={{ color: uploaded ? '#4ade80' : AppColors.ink500, fontSize: 13, marginTop: 2 }}>
            {uploading ? 'Uploading…' : uploaded ? 'Photo uploaded — tap to replace' : 'Tap to upload photo'}
          </Text>
        </View>
      </TouchableOpacity>
      {error ? <Text style={{ color: '#b91c1c', fontSize: 13, marginTop: 4 }}>{error}</Text> : null}
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
