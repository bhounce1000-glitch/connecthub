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
  'National ID': 'e.g. GHA-123456789-0',
  Passport: 'e.g. A1234567',
  "Driver's License": 'e.g. D-1234-567890',
  "Voter's ID": 'e.g. VOT-123456789',
};
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function validateFile(file) {
  if (!file) return { valid: false, error: 'No file selected' };

  if (file.size && file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File too large. Maximum size is 10MB.' };
  }

  const mime = String(file.type || '').toLowerCase();
  if (mime && !ALLOWED_TYPES.includes(mime)) {
    return { valid: false, error: 'Only JPG, PNG, HEIC, or HEIF images are allowed.' };
  }

  const uri = String(file.uri || file.name || '');
  const ext = uri.split('.').pop()?.toLowerCase();
  const allowedExt = ['jpg', 'jpeg', 'png', 'heic', 'heif'];
  if (ext && !allowedExt.includes(ext)) {
    return { valid: false, error: 'Only JPG, PNG, HEIC, or HEIF images are allowed.' };
  }

  return { valid: true };
}

function normalizeIdNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Auto-format a Ghana Card number on blur.
// Input variants accepted: raw digits, GHA digits, GHA-...-. etc.
function formatGhanaCard(raw) {
  const upper = String(raw || '').toUpperCase().replace(/\s/g, '');
  // Already correct format — leave it alone.
  if (/^GHA-\d{7,10}-\d$/.test(upper)) return upper;
  // Strip GHA prefix (with or without hyphen), then grab only digits.
  const stripped = upper.replace(/^GHA-?/, '');
  const digits = stripped.replace(/\D/g, '');
  if (digits.length < 2) return upper; // Not enough to format — return as-is.
  const middle = digits.slice(0, digits.length - 1);
  const check = digits.slice(-1);
  return `GHA-${middle}-${check}`;
}

// Normalise Ghana phone numbers: +233XXXXXXXXX → 0XXXXXXXXX.
function normalizeGhanaPhone(value) {
  const v = String(value || '').trim().replace(/\s/g, '');
  if (v.startsWith('+233') && v.length > 4) return '0' + v.slice(4);
  if (v.startsWith('233') && v.length > 3) return '0' + v.slice(3);
  return v;
}

function validateIdNumberByType(idType, rawValue) {
  const value = normalizeIdNumber(rawValue);
  if (!value) {
    return 'ID number is required';
  }

  const rules = {
    // GHA-<7-10 digits>-<1 check digit>  — real cards use 9 middle digits
    'National ID': /^GHA-\d{7,10}-\d$/,
    Passport: /^[A-Z][0-9]{7,8}$/,
    "Driver's License": /^[A-Z]-\d{4}-\d{6}$/,
    "Voter's ID": /^VOT-\d{9}$/,
  };

  const samples = {
    'National ID': 'GHA-123456789-0',
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
          const fileValidation = validateFile(file);
          if (!fileValidation.valid) {
            throw new Error(fileValidation.error);
          }

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

  // Auto-format Ghana Card as the user types; uppercase everything else.
  const handleIdNumberChange = (raw) => {
    if (form.idType !== 'National ID') {
      set('idNumber', raw.toUpperCase().trimStart());
      return;
    }
    const upper = raw.toUpperCase().replace(/\s/g, '');
    // User is typing manually with hyphens — let them lead, just uppercase.
    if (upper.includes('-')) {
      set('idNumber', upper);
      return;
    }
    // Digit-only (or GHA prefix without hyphens) — auto-insert separators.
    const withoutGha = upper.startsWith('GHA') ? upper.slice(3) : upper;
    const digits = withoutGha.replace(/\D/g, '');
    if (digits.length === 0) { set('idNumber', upper.startsWith('GHA') ? 'GHA-' : ''); return; }
    if (digits.length < 10) {
      set('idNumber', `GHA-${digits}`);
    } else {
      set('idNumber', `GHA-${digits.slice(0, -1)}-${digits.slice(-1)}`);
    }
  };

  // On blur, apply full Ghana Card formatting and phone normalisation.
  const handleIdNumberBlur = () => {
    if (form.idType === 'National ID' && form.idNumber) {
      set('idNumber', formatGhanaCard(form.idNumber));
    }
  };

  const handlePhoneBlur = () => {
    if (form.phone) set('phone', normalizeGhanaPhone(form.phone));
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
            placeholder="0553 000 000"
            value={form.phone}
            onChangeText={(v) => set('phone', v)}
            onBlur={handlePhoneBlur}
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
            onChangeText={handleIdNumberChange}
            onBlur={handleIdNumberBlur}
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
