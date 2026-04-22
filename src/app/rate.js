import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { db } from '../firebase';

export default function RateProvider() {
  const router = useRouter();
  const { requestId, providerEmail } = useLocalSearchParams();
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const resolvedRequestId = useMemo(() => {
    return Array.isArray(requestId) ? requestId[0] : requestId;
  }, [requestId]);

  const resolvedProviderEmail = useMemo(() => {
    return Array.isArray(providerEmail) ? providerEmail[0] : providerEmail;
  }, [providerEmail]);

  const saveReview = async () => {
    if (!resolvedRequestId) {
      Alert.alert('Missing request', 'No request id found for this review.');
      return;
    }

    setIsSaving(true);

    try {
      await updateDoc(doc(db, 'requests', resolvedRequestId), {
        rating: Number(rating),
        review: review.trim(),
        ratedAt: new Date().toISOString(),
      });

      Alert.alert('Thank you', 'Your rating has been saved.');
      router.replace('/home');
    } catch (error) {
      Alert.alert('Could not save rating', error.message || 'Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6f8', padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 8 }}>Rate Provider</Text>
      <Text style={{ color: '#4b5563', marginBottom: 20 }}>
        Provider: {resolvedProviderEmail || 'Unavailable'}
      </Text>

      <Text style={{ fontWeight: '600', marginBottom: 10 }}>Select a rating</Text>
      <View style={{ flexDirection: 'row', marginBottom: 20 }}>
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity
            key={value}
            onPress={() => setRating(value)}
            style={{
              backgroundColor: rating >= value ? '#f59e0b' : '#d1d5db',
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 8,
              marginRight: 8,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>{value}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontWeight: '600', marginBottom: 10 }}>Review (optional)</Text>
      <TextInput
        value={review}
        onChangeText={setReview}
        placeholder="Say a few words about the provider"
        multiline
        style={{
          minHeight: 120,
          textAlignVertical: 'top',
          borderWidth: 1,
          borderColor: '#d1d5db',
          borderRadius: 12,
          padding: 12,
          backgroundColor: 'white',
          marginBottom: 16,
        }}
      />

      <TouchableOpacity
        style={{
          backgroundColor: isSaving ? '#9ca3af' : '#2563eb',
          padding: 14,
          borderRadius: 10,
          marginBottom: 10,
        }}
        onPress={saveReview}
        disabled={isSaving}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: '700' }}>
          {isSaving ? 'Saving...' : 'Submit Review'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{
          backgroundColor: '#111827',
          padding: 14,
          borderRadius: 10,
        }}
        onPress={() => router.back()}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}
