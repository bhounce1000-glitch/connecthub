import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

// mode: 'provider' (customer rates provider) | 'customer' (provider rates customer)
export default function Rate() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const { requestId, providerEmail, mode } = useLocalSearchParams();

  useEffect(() => {
    if (isAuthReady && !user) router.replace('/auth');
  }, [isAuthReady, router, user]);

  const resolvedRequestId = Array.isArray(requestId) ? requestId[0] : requestId;
  const resolvedProviderEmail = Array.isArray(providerEmail) ? providerEmail[0] : providerEmail;
  const rateMode = (Array.isArray(mode) ? mode[0] : mode) || 'provider';

  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const isRatingProvider = rateMode !== 'customer';
  const targetLabel = isRatingProvider ? (resolvedProviderEmail || 'Provider') : 'Customer';
  const title = isRatingProvider ? '⭐ Rate Provider' : '⭐ Rate Customer';
  const subtitle = isRatingProvider
    ? `How was your experience with ${resolvedProviderEmail || 'the provider'}?`
    : `How was the customer for this job?`;

  const saveReview = async () => {
    if (!resolvedRequestId) { setError('Missing request context.'); return; }
    if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) { setError('Please select a valid rating.'); return; }
    if (review.trim().length > 500) { setError('Review must be under 500 characters.'); return; }

    setIsSaving(true);
    setError('');
    try {
      if (isRatingProvider) {
        await updateDoc(doc(db, 'requests', resolvedRequestId), {
          rating: Number(rating),
          review: review.trim(),
          ratedAt: new Date().toISOString(),
        });
        // Notify provider
        if (resolvedProviderEmail) {
          addDoc(collection(db, 'notifications'), {
            user: resolvedProviderEmail,
            text: `${auth.currentUser?.email} rated you ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}${review.trim() ? ` — "${review.trim()}"` : ''}.`,
            read: false,
            createdAt: new Date().toISOString(),
          }).catch(() => {});
        }
      } else {
        // Provider rates customer
        const reqSnap = await getDoc(doc(db, 'requests', resolvedRequestId));
        const customerEmail = reqSnap.data()?.user;
        await updateDoc(doc(db, 'requests', resolvedRequestId), {
          customerRating: Number(rating),
          customerReview: review.trim(),
          customerRatedAt: new Date().toISOString(),
        });
        // Notify customer
        if (customerEmail) {
          addDoc(collection(db, 'notifications'), {
            user: customerEmail,
            text: `${auth.currentUser?.email} gave you ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} as a customer${review.trim() ? ` — "${review.trim()}"` : ''}.`,
            read: false,
            createdAt: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      router.replace('/home');
    } catch (e) {
      setError(e.message || 'Failed to save review. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fffbeb' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#92400e', paddingTop: 52, paddingBottom: 24, paddingHorizontal: AppSpace.lg }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 12 }}>
          <Text style={{ color: '#fef3c7', fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 11, color: '#fbbf24', letterSpacing: 1, fontWeight: '700', marginBottom: 4 }}>REPUTATION</Text>
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#fef9c3' }}>{title}</Text>
        <Text style={{ color: '#fde68a', fontSize: 13, marginTop: 4 }}>{subtitle}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: AppSpace.lg }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={{ backgroundColor: '#fef2f2', borderRadius: AppRadius.md, padding: 12, marginBottom: 16 }}>
            <Text style={{ color: '#dc2626', fontWeight: '600' }}>{error}</Text>
          </View>
        ) : null}

        {/* Star picker */}
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 12, fontSize: 15 }}>Your rating</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 24 }}>
          {[1, 2, 3, 4, 5].map((val) => (
            <TouchableOpacity
              key={val}
              onPress={() => setRating(val)}
              style={{ padding: 6 }}
            >
              <Text style={{ fontSize: 38, opacity: rating >= val ? 1 : 0.25 }}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ textAlign: 'center', color: '#92400e', fontWeight: '800', fontSize: 18, marginBottom: 24 }}>
          {rating} / 5 — {['', 'Terrible', 'Poor', 'Okay', 'Good', 'Excellent'][rating]}
        </Text>

        {/* Review input */}
        <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>
          Review (optional)
        </Text>
        <TextInput
          value={review}
          onChangeText={setReview}
          placeholder={isRatingProvider ? 'Say a few words about the provider...' : 'Say a few words about the customer...'}
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={4}
          editable={!isSaving}
          style={{
            backgroundColor: '#fff',
            borderWidth: 1,
            borderColor: '#e2e8f0',
            borderRadius: AppRadius.md,
            padding: 14,
            fontSize: 15,
            color: AppColors.ink900,
            height: 110,
            textAlignVertical: 'top',
            marginBottom: 20,
          }}
        />

        <TouchableOpacity
          onPress={saveReview}
          disabled={isSaving || !resolvedRequestId}
          style={{
            backgroundColor: isSaving ? '#fbbf24' : '#d97706',
            borderRadius: AppRadius.md,
            paddingVertical: 14,
            alignItems: 'center',
            marginBottom: AppSpace.sm,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
            {isSaving ? 'Saving...' : 'Submit Review'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: '#92400e', fontWeight: '600' }}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
