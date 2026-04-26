import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

export default function RateProvider() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const { requestId, providerEmail } = useLocalSearchParams();

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState(
    requestId
      ? null
      : {
        tone: 'warning',
        title: 'Missing request context',
        message: 'No request id was found for this review. Go back and open the rating flow from a completed request.',
      }
  );

  const resolvedRequestId = useMemo(() => {
    return Array.isArray(requestId) ? requestId[0] : requestId;
  }, [requestId]);

  const resolvedProviderEmail = useMemo(() => {
    return Array.isArray(providerEmail) ? providerEmail[0] : providerEmail;
  }, [providerEmail]);

  const saveReview = async () => {
    if (!resolvedRequestId) {
      setNotice({
        tone: 'warning',
        title: 'Missing request context',
        message: 'No request id was found for this review. Go back and open the rating flow from a completed request.',
      });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      await updateDoc(doc(db, 'requests', resolvedRequestId), {
        rating: Number(rating),
        review: review.trim(),
        ratedAt: new Date().toISOString(),
      });

      // Notify the provider that they received a rating
      if (resolvedProviderEmail) {
        const stars = '★'.repeat(Number(rating)) + '☆'.repeat(5 - Number(rating));
        const reviewText = review.trim();
        addDoc(collection(db, 'notifications'), {
          user: resolvedProviderEmail,
          text: `${auth.currentUser?.email} rated you ${stars}${reviewText ? ` — "${reviewText}"` : ''} for request ${resolvedRequestId}.`,
          read: false,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }

      router.replace('/home');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Could not save rating',
        message: error.message || 'Try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormScreen
      eyebrow="REPUTATION"
      title="Rate Provider"
      subtitle={`Provider: ${resolvedProviderEmail || 'Unavailable'}`}
      accentColor="#92400e"
      accentTextColor="#fef3c7"
      backgroundColor="#fffbeb"
      scroll
    >
        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />

        <Text style={{ fontWeight: '600', marginBottom: 10, color: AppColors.ink900 }}>Select a rating</Text>
        <View style={{ flexDirection: 'row', marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map((value) => (
            <AppButton
              key={value}
              label={rating >= value ? '★' : '☆'}
              onPress={() => setRating(value)}
              style={{
                backgroundColor: rating >= value ? '#f59e0b' : '#d1d5db',
                marginRight: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
              }}
              textStyle={{ color: rating >= value ? 'white' : '#6b7280', fontSize: 22 }}
            />
          ))}
        </View>

        <AppInput
          label="Review (optional)"
          value={review}
          onChangeText={setReview}
          placeholder="Say a few words about the provider"
          multiline
          editable={!isSaving}
          helper="A short review helps future customers make better decisions."
        />

        <AppButton
          label="Submit Review"
          variant="primary"
          onPress={saveReview}
          disabled={!resolvedRequestId}
          loading={isSaving}
          style={{ marginBottom: AppSpace.sm }}
        />

        <AppButton
          label="Cancel"
          variant="neutral"
          onPress={() => router.back()}
        />
    </FormScreen>
  );
}
