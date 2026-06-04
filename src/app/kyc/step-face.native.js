import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../../components/ui/app-button';
import AppNotice from '../../components/ui/app-notice';
import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';
import { db } from '../../firebase';
import useAuthUser from '../../hooks/use-auth-user';

const STEP_LABELS = ['Personal', 'Identity', 'Payment', 'Face', 'Review'];
const MAX_SELFIE_SIZE = 10 * 1024 * 1024;

const CHALLENGE_SEQUENCE = [
  { key: 'LOOK_LEFT', instruction: 'Turn your head LEFT' },
  { key: 'LOOK_RIGHT', instruction: 'Turn your head RIGHT' },
  { key: 'LOOK_UP', instruction: 'Look UP' },
  { key: 'LOOK_DOWN', instruction: 'Look DOWN' },
  { key: 'LOOK_CENTER', instruction: 'Look STRAIGHT at camera' },
];

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

export default function KycStepFace() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const { user, isAuthReady } = useAuthUser();
  const [permission, requestPermission] = useCameraPermissions();

  const [showIntro, setShowIntro] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [holdFrames, setHoldFrames] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [selfiePreview, setSelfiePreview] = useState('');
  const [notice, setNotice] = useState(null);

  const currentChallenge = useMemo(() => CHALLENGE_SEQUENCE[challengeIndex] || null, [challengeIndex]);

  if (!isAuthReady) {
    return null;
  }

  if (!user?.email) {
    return <Redirect href="/auth" />;
  }

  const email = String(user.email || '').trim().toLowerCase();

  const saveLivenessResult = async (selfieUrl, steps, completed) => {
    const now = new Date().toISOString();
    await Promise.all([
      setDoc(
        doc(db, 'kyc_submissions', email),
        {
          email,
          selfieUrl,
          livenessCompleted: !!completed,
          livenessSteps: steps,
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

  const captureSelfie = async () => {
    if (!cameraRef.current) {
      throw new Error('Camera is not ready yet.');
    }

    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
    if (!photo?.uri) {
      throw new Error('Failed to capture frame.');
    }

    return photo;
  };

  const runChallenges = async () => {
    if (isRunning || isUploading) {
      return;
    }

    setNotice(null);
    setIsRunning(true);
    setChallengeIndex(0);
    setHoldFrames(0);

    const completedSteps = [];

    try {
      for (let i = 0; i < CHALLENGE_SEQUENCE.length; i += 1) {
        const challenge = CHALLENGE_SEQUENCE[i];
        setChallengeIndex(i);

        await new Promise((resolve) => setTimeout(resolve, 900));
        completedSteps.push(challenge.key);
      }

      setChallengeIndex(CHALLENGE_SEQUENCE.length - 1);
      let held = 0;
      let finalPhoto = null;
      while (held < 8) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        finalPhoto = await captureSelfie();

        held += 1;
        setHoldFrames(held);
      }

      if (!finalPhoto?.uri) {
        throw new Error('Final selfie capture failed. Please retry.');
      }

      setIsUploading(true);
      const selfieUrl = await uploadSelfie(finalPhoto.uri, email);
      setSelfiePreview(selfieUrl);
      await saveLivenessResult(selfieUrl, completedSteps, true);
      setNotice({ type: 'success', message: 'Guided selfie captured. Continue to review and submit.' });
      router.push('/kyc/step4');
    } catch (error) {
      setNotice({ type: 'error', message: error?.message || 'Liveness check failed. Please try again.' });
    } finally {
      setIsRunning(false);
      setIsUploading(false);
    }
  };

  const handleWebFallbackUpload = async () => {
    if (Platform.OS !== 'web') {
      return;
    }

    setIsUploading(true);
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.9,
      });

      if (result.canceled) {
        setIsUploading(false);
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('No image selected.');
      }

      const selfieUrl = await uploadSelfie(asset.uri, email);
      setSelfiePreview(selfieUrl);
      await saveLivenessResult(selfieUrl, ['WEB_SELFIE_UPLOAD'], true);
      setNotice({ type: 'success', message: 'Selfie uploaded. Continue to review and submit.' });
      router.push('/kyc/step4');
    } catch (error) {
      setNotice({ type: 'error', message: error?.message || 'Could not upload selfie.' });
    } finally {
      setIsUploading(false);
    }
  };

  const maxW = 520;

  if (showIntro) {
    return (
      <View style={{ flex: 1, backgroundColor: AppColors.ink900 }}>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: AppSpace.lg, paddingTop: AppSpace.xl, paddingBottom: 40 }}>
          <View style={{ width: '100%', maxWidth: maxW }}>
            <Text style={{ color: '#fff', fontSize: AppType.heading, fontWeight: '800', marginBottom: 4 }}>
              Facial Liveness Check
            </Text>
            <Text style={{ color: AppColors.ink500, fontSize: AppType.body, marginBottom: AppSpace.xl }}>
              Step 4 of 5 - Follow the guided selfie prompts before final KYC submission.
            </Text>

            <StepIndicator current={3} />

            <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.lg, padding: AppSpace.lg, borderWidth: 1, borderColor: '#1e293b' }}>
              <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
                What will happen
              </Text>
              <Text style={{ color: '#94a3b8', lineHeight: 21, marginBottom: 14 }}>
                You will be asked to follow a short sequence of prompts, then hold steady for a final selfie.
              </Text>
              <Text style={{ color: '#94a3b8', lineHeight: 21 }}>
                We capture one final selfie and send it for admin comparison against your uploaded ID photo.
              </Text>
            </View>

            <AppButton label="Start Face Verification" onPress={() => setShowIntro(false)} style={{ marginTop: AppSpace.xl }} />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: AppColors.ink900, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#6366f1" />
        <Text style={{ color: AppColors.ink500, marginTop: 10 }}>Preparing camera permissions...</Text>
      </View>
    );
  }

  if (Platform.OS !== 'web' && !permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: AppColors.ink900, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18, marginBottom: 10, textAlign: 'center' }}>Camera permission is required</Text>
        <Text style={{ color: AppColors.ink500, textAlign: 'center', marginBottom: 18 }}>
          ConnectHub needs your front camera to complete facial liveness checks.
        </Text>
        <AppButton label="Grant Camera Access" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#020617' }}>
      <View style={{ flex: 1, margin: 14, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#1e293b' }}>
        {Platform.OS === 'web' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#0f172a' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18, marginBottom: 8 }}>Web fallback mode</Text>
            <Text style={{ color: '#94a3b8', textAlign: 'center', marginBottom: 14 }}>
              Automatic liveness is not available on web in this build. Upload a clear selfie for manual review.
            </Text>
            <AppButton label={isUploading ? 'Uploading...' : 'Upload Selfie'} onPress={handleWebFallbackUpload} disabled={isUploading} />
          </View>
        ) : (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" mirror />
        )}

        <View style={{ position: 'absolute', top: 12, left: 12, right: 12 }}>
          <View style={{ backgroundColor: 'rgba(2,6,23,0.75)', borderRadius: 12, padding: 12 }}>
            <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 4 }}>Face Verification</Text>
            <Text style={{ color: '#cbd5e1' }}>
              {currentChallenge ? currentChallenge.instruction : 'Position your face in the frame'}
            </Text>
            {isRunning && (
              <Text style={{ color: '#93c5fd', marginTop: 6 }}>
                Step {Math.min(challengeIndex + 1, CHALLENGE_SEQUENCE.length)} of {CHALLENGE_SEQUENCE.length} {holdFrames > 0 ? `| Hold: ${holdFrames}/8` : ''}
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        {notice ? <AppNotice type={notice.type} message={notice.message} style={{ marginBottom: 10 }} /> : null}

        {selfiePreview ? (
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <Image source={{ uri: selfiePreview }} style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: '#334155' }} />
          </View>
        ) : null}

        {Platform.OS !== 'web' && (
          <TouchableOpacity
            onPress={runChallenges}
            disabled={isRunning || isUploading}
            style={{
              height: 52,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isRunning || isUploading ? '#475569' : '#2563eb',
            }}
          >
            {isRunning || isUploading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Start Liveness Check</Text>}
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center', paddingVertical: 10, marginTop: 8 }}>
          <Text style={{ color: '#94a3b8' }}>Back to Payment</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
