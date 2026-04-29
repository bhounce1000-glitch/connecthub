import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import { REQUEST_STATUS } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db, storage } from '../firebase';
import { apiPost, assertApiSuccess } from '../utils/api-client';

export default function ConfirmCompletion() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams();
  const resolvedRequestId = useMemo(() => (Array.isArray(requestId) ? requestId[0] : requestId), [requestId]);

  const [item, setItem] = useState(null);
  const [providerProfile, setProviderProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState([]);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [successMode, setSuccessMode] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!resolvedRequestId) {
        setNotice({ tone: 'warning', title: 'Missing job context', message: 'Open this flow from a job card.' });
        setLoading(false);
        return;
      }

      try {
        const reqSnap = await getDoc(doc(db, 'requests', resolvedRequestId));
        if (!reqSnap.exists()) {
          setNotice({ tone: 'error', title: 'Job not found', message: 'This job record is unavailable.' });
          setLoading(false);
          return;
        }

        const data = { id: reqSnap.id, ...reqSnap.data() };
        if (!cancelled) {
          setItem(data);
        }

        if (data.acceptedBy) {
          const providerSnap = await getDoc(doc(db, 'providers', data.acceptedBy));
          if (providerSnap.exists() && !cancelled) {
            setProviderProfile(providerSnap.data());
          }
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ tone: 'error', title: 'Could not load job', message: error.message || 'Try again.' });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [resolvedRequestId]);

  const uploadEvidence = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          setNotice({ tone: 'warning', title: 'Permission required', message: 'Please allow photo access to upload evidence.' });
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      setSaving(true);
      const uploaded = [];
      for (const asset of result.assets) {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const fileRef = ref(storage, `disputes/${resolvedRequestId}/${fileName}`);
        await uploadBytes(fileRef, blob);
        const url = await getDownloadURL(fileRef);
        uploaded.push(url);
      }
      setEvidenceUrls((prev) => [...prev, ...uploaded]);
      setNotice({ tone: 'success', title: 'Evidence uploaded', message: `${uploaded.length} file(s) attached to this dispute.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Upload failed', message: error.message || 'Could not upload evidence.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmAndRelease = async () => {
    if (rating < 1 || rating > 5) {
      setNotice({ tone: 'warning', title: 'Rating required', message: 'Please add a 1-5 star rating before confirming completion.' });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${resolvedRequestId}/confirm-completion`, {
        rating,
        comment: comment.trim(),
      }, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not confirm completion');
      setSuccessMode('confirmed');
    } catch (error) {
      setNotice({ tone: 'error', title: 'Confirmation failed', message: error.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const openDispute = async () => {
    if (!disputeReason.trim()) {
      setNotice({ tone: 'warning', title: 'Dispute reason required', message: 'Please explain what went wrong before submitting.' });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${resolvedRequestId}/dispute`, {
        reason: disputeReason.trim(),
        comment: comment.trim(),
        evidenceUrls,
      }, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not open dispute');
      setSuccessMode('disputed');
    } catch (error) {
      setNotice({ tone: 'error', title: 'Dispute failed', message: error.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg, justifyContent: 'center' }}>
        <Text style={{ color: AppColors.ink500, textAlign: 'center' }}>Loading confirmation details...</Text>
      </View>
    );
  }

  if (successMode === 'confirmed') {
    return (
      <View style={{ flex: 1, backgroundColor: '#ecfdf5', justifyContent: 'center', alignItems: 'center', padding: AppSpace.lg }}>
        <Text style={{ fontSize: 52, marginBottom: 12 }}>✅</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#166534', textAlign: 'center', marginBottom: 8 }}>
          Job completed successfully!
        </Text>
        <Text style={{ color: '#166534', textAlign: 'center', marginBottom: 24 }}>
          Payment has been released to your provider. You can view this in history and both parties can now rate each other.
        </Text>
        <AppButton label="Go to Home" variant="success" onPress={() => router.replace('/home')} />
      </View>
    );
  }

  if (successMode === 'disputed') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', padding: AppSpace.lg }}>
        <Text style={{ fontSize: 52, marginBottom: 12 }}>⚠️</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#991b1b', textAlign: 'center', marginBottom: 8 }}>
          Dispute submitted
        </Text>
        <Text style={{ color: '#991b1b', textAlign: 'center', marginBottom: 24 }}>
          Payment is frozen in escrow. An admin will review your case and notify both parties.
        </Text>
        <AppButton label="Back to Home" variant="danger" onPress={() => router.replace('/home')} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: AppSpace.lg }}>
        <Text style={{ color: AppColors.ink700, marginBottom: 10 }}>Unable to load this job.</Text>
        <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  const providerName = providerProfile?.name || item.acceptedBy || 'Provider';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg }}>
      <AppCard style={{ marginBottom: 12, backgroundColor: '#0f172a', borderWidth: 0 }}>
        <Text style={{ color: '#93c5fd', fontWeight: '700', letterSpacing: 1, fontSize: 12 }}>JOB CONFIRMATION</Text>
        <Text style={{ color: '#f8fafc', fontWeight: '800', fontSize: 24, marginTop: 6 }}>Review Completion</Text>
      </AppCard>

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 12 }} />

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '800', fontSize: 17, color: AppColors.ink900, marginBottom: 4 }}>{item.title}</Text>
        <Text style={{ color: AppColors.ink700, marginBottom: 8 }}>{item.description || 'No description provided.'}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Location: {item.location}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Amount: GHS {item.price}</Text>
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Avatar src={providerProfile?.profilePicture} email={item.acceptedBy} size={44} />
          <View style={{ marginLeft: 10 }}>
            <Text style={{ fontWeight: '700', color: AppColors.ink900 }}>{providerName}</Text>
            <Text style={{ color: AppColors.ink500, fontSize: 12 }}>{item.acceptedBy || 'Unknown provider'}</Text>
          </View>
        </View>
        <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 16, lineHeight: 23 }}>
          Has {providerName} completed your job to your satisfaction?
        </Text>
      </AppCard>

      {(item.status || REQUEST_STATUS.OPEN) !== REQUEST_STATUS.PENDING_CONFIRMATION ? (
        <AppNotice
          tone="warning"
          title="Not in confirmation state"
          message="This screen is only available while the job status is Pending Confirmation."
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 10 }}>Required rating before confirmation</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((val) => (
            <TouchableOpacity key={val} onPress={() => setRating(val)} style={{ padding: 4 }}>
              <Text style={{ fontSize: 34, opacity: rating >= val ? 1 : 0.25 }}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
        {rating < 1 ? (
          <Text style={{ color: '#b45309', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            Select a rating (1-5 stars) to enable confirmation.
          </Text>
        ) : null}
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>Leave a comment about this job (optional)</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Share a brief note about the quality of work..."
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={4}
          style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, padding: 12, minHeight: 100, textAlignVertical: 'top', color: AppColors.ink900 }}
        />
      </AppCard>

      <TouchableOpacity
        onPress={confirmAndRelease}
        disabled={saving || rating < 1 || (item.status || REQUEST_STATUS.OPEN) !== REQUEST_STATUS.PENDING_CONFIRMATION}
        style={{
          backgroundColor: '#16a34a',
          borderRadius: AppRadius.md,
          paddingVertical: 16,
          alignItems: 'center',
          marginBottom: 10,
          opacity: saving || rating < 1 ? 0.7 : 1,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>YES - Confirm & Release Payment</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setShowDisputeForm((v) => !v)}
        disabled={saving || (item.status || REQUEST_STATUS.OPEN) !== REQUEST_STATUS.PENDING_CONFIRMATION}
        style={{
          backgroundColor: '#fee2e2',
          borderRadius: AppRadius.md,
          paddingVertical: 14,
          alignItems: 'center',
          marginBottom: 12,
          borderWidth: 1,
          borderColor: '#fecaca',
        }}
      >
        <Text style={{ color: '#b91c1c', fontWeight: '800', fontSize: 15 }}>NO - Open a Dispute</Text>
      </TouchableOpacity>

      {showDisputeForm ? (
        <AppCard style={{ marginBottom: 14 }}>
          <Text style={{ fontWeight: '800', color: '#991b1b', marginBottom: 8 }}>Dispute details</Text>
          <TextInput
            value={disputeReason}
            onChangeText={setDisputeReason}
            placeholder="Explain what went wrong..."
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
            style={{ borderWidth: 1, borderColor: '#fecaca', borderRadius: AppRadius.md, padding: 12, minHeight: 100, textAlignVertical: 'top', color: AppColors.ink900, marginBottom: 10 }}
          />

          <AppButton label="Upload Evidence Photos" variant="neutral" onPress={uploadEvidence} disabled={saving} style={{ marginBottom: 10 }} />
          {evidenceUrls.length ? (
            <Text style={{ color: AppColors.ink500, marginBottom: 10, fontSize: 12 }}>{evidenceUrls.length} evidence file(s) attached</Text>
          ) : null}

          <AppButton label="Submit Dispute" variant="danger" onPress={openDispute} disabled={saving} loading={saving} />
        </AppCard>
      ) : null}

      <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
    </ScrollView>
  );
}
