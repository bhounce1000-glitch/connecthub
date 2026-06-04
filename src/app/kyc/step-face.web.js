import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppNotice from '../../components/ui/app-notice';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Face', 'Review'];
const MAX_SELFIE_SIZE = 10 * 1024 * 1024;

function StepIndicator({ current }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: AppSpace.xl, paddingHorizontal: AppSpace.lg }}>
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              {i > 0 && <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />}
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
              {i < STEP_LABELS.length - 1 && <View style={{ flex: 1, height: 2, backgroundColor: done ? '#6366f1' : '#e2e8f0' }} />}
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

async function uploadSelfie(uri, email) {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) {
    throw new Error('Captured selfie was not found. Please try again.');
  }
  if (typeof info.size === 'number' && info.size > MAX_SELFIE_SIZE) {
    throw new Error('Selfie is too large. Please retake and try again.');
  }

  const storage = getStorage();
  const fileName = `selfie_${Date.now()}.jpg`;
  const storageRef = ref(storage, `kyc/${email}/${fileName}`);

  const response = await fetch(uri);
  const blob = await response.blob();
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}

export default function KycStepFaceWeb() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  const email = String(user.email || '').trim().toLowerCase();

  const saveLivenessResult = async (selfieUrl) => {
    const now = new Date().toISOString();
    await Promise.all([
      setDoc(
        doc(db, 'kyc_submissions', email),
        {
          email,
          selfieUrl,
          livenessCompleted: true,
          livenessSteps: ['WEB_SELFIE_UPLOAD'],
          faceVerificationStatus: 'pending_admin_review',
          faceVerifiedAt: null,
          livenessCompletedAt: now,
          updatedAt: now,
        },
        { merge: true }
      ),
      setDoc(
        doc(db, 'users', email),
        {
          faceVerificationStatus: 'pending_admin_review',
          updatedAt: now,
        },
        { merge: true }
      ),
    ]);
  };

  const handleWebFallbackUpload = async () => {
    setUploading(true);
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.9,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('No image selected.');
      }

      const selfieUrl = await uploadSelfie(asset.uri, email);
      await saveLivenessResult(selfieUrl);
      setNotice({ type: 'success', message: 'Selfie uploaded. Continue to review and submit.' });
      router.push('/kyc/step4');
    } catch (error) {
      setNotice({ type: 'error', message: error?.message || 'Could not upload selfie.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}>
        <View style={{ width: '100%', maxWidth: 520 }}>
          <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
            Facial Liveness Check
          </Text>
          <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
            Step 4 of 5 — Upload a clear selfie for manual face review.
          </Text>

          <StepIndicator current={3} />

          <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.lg, padding: AppSpace.lg, borderWidth: 1, borderColor: '#1e293b' }}>
            <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              Web fallback mode
            </Text>
            <Text style={{ color: '#94a3b8', lineHeight: 21 }}>
              Automatic liveness detection is available on mobile. On web, upload a clear selfie and our admin team will compare it with your ID photo.
            </Text>
          </View>

          {notice ? <AppNotice type={notice.type} message={notice.message} style={{ marginTop: AppSpace.lg }} /> : null}

          <AppButton label={uploading ? 'Uploading...' : 'Upload Selfie'} onPress={handleWebFallbackUpload} disabled={uploading} style={{ marginTop: AppSpace.xl }} />

          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: AppSpace.md, alignItems: 'center', paddingVertical: AppSpace.sm }}>
            <Text style={{ color: AppColors.ink500, fontSize: AppType.body }}>← Back to Payment</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
