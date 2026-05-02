import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { collection, getDocs, query, where } from 'firebase/firestore';
import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { auth, db } from '../firebase';
import { apiClient } from '../utils/api-client';

export default function Portfolio() {
  const router = useRouter();
  const user = auth.currentUser;

  const [portfolioItems, setPortfolioItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState(null);

  const userEmail = user?.email?.toLowerCase()?.trim() || '';

  useEffect(() => {
    if (!user) {
      router.replace('/auth');
      return;
    }
    loadPortfolioItems();
  }, [user]);

  const loadPortfolioItems = async () => {
    setIsLoading(true);
    try {
      if (!userEmail) {
        setPortfolioItems([]);
        return;
      }

      const snap = await getDocs(
        query(
          collection(db, 'portfolios', userEmail, 'items'),
          where('active', '==', true)
        )
      );

      const items = snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setPortfolioItems(items.sort((a, b) => (b.uploadedAt?.seconds || 0) - (a.uploadedAt?.seconds || 0)));
    } catch (err) {
      console.error('Error loading portfolio:', err);
      setNotice({ tone: 'error', title: 'Error', message: 'Failed to load portfolio items.' });
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedImage(result.assets[0]);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const uploadItem = async () => {
    if (!selectedImage) {
      setNotice({ tone: 'warning', title: 'No Image', message: 'Please select an image to upload.' });
      return;
    }

    if (!description.trim()) {
      setNotice({ tone: 'warning', title: 'No Description', message: 'Please add a description for this portfolio item.' });
      return;
    }

    setIsUploading(true);
    setNotice(null);

    try {
      // Read image file and convert to base64
      const fileInfo = await FileSystem.getInfoAsync(selectedImage.uri);
      if (!fileInfo.exists) {
        throw new Error('Image file not found');
      }

      const base64 = await FileSystem.readAsStringAsync(selectedImage.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const mimeType = 'image/jpeg';

      // Call backend to upload portfolio item
      const response = await apiClient.post('/portfolio', {
        image: `data:${mimeType};base64,${base64}`,
        description: description.trim(),
      });

      if (response?.success) {
        setSelectedImage(null);
        setDescription('');
        setNotice({ tone: 'success', title: 'Success', message: 'Portfolio item uploaded!' });
        await loadPortfolioItems();
      } else {
        throw new Error(response?.message || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setNotice({
        tone: 'error',
        title: 'Upload Error',
        message: err?.message || 'Failed to upload portfolio item.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const deleteItem = async (itemId) => {
    Alert.alert(
      'Delete Item',
      'Are you sure you want to remove this portfolio item?',
      [
        { text: 'Cancel', onPress: () => {} },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await apiClient.delete(`/portfolio/${itemId}`);
              await loadPortfolioItems();
              setNotice({ tone: 'success', title: 'Deleted', message: 'Portfolio item removed.' });
            } catch (err) {
              setNotice({ tone: 'error', title: 'Error', message: 'Failed to delete item.' });
            }
          },
        },
      ]
    );
  };

  return (
    <ScreenShell title="Portfolio" showBackButton>
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, color: AppColors.ink700 }}>Loading portfolio...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: AppSpace.xl }}>
          <AppNotice
            tone={notice?.tone}
            title={notice?.title}
            message={notice?.message}
          />

          {/* Upload Section */}
          <View style={{ marginBottom: AppSpace.xl, backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: AppSpace.md, borderWidth: 1, borderColor: '#e2e8f0' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: AppColors.ink900, marginBottom: AppSpace.md }}>Add Portfolio Item</Text>

            {/* Image Preview */}
            {selectedImage ? (
              <View style={{ marginBottom: AppSpace.md, borderRadius: AppRadius.md, overflow: 'hidden' }}>
                <Image
                  source={{ uri: selectedImage.uri }}
                  style={{ width: '100%', height: 200, backgroundColor: '#f0f0f0' }}
                />
                <TouchableOpacity
                  onPress={() => setSelectedImage(null)}
                  style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 6 }}
                >
                  <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={pickImage}
                disabled={isUploading}
                style={{
                  marginBottom: AppSpace.md,
                  borderRadius: AppRadius.md,
                  borderWidth: 2,
                  borderColor: '#a5f3fc',
                  borderStyle: 'dashed',
                  padding: AppSpace.lg,
                  backgroundColor: '#ecfeff',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📸</Text>
                <Text style={{ color: '#0f766e', fontWeight: '600', textAlign: 'center' }}>Tap to select image</Text>
                <Text style={{ color: '#0d9488', fontSize: 12, marginTop: 4 }}>JPG, PNG (up to 5MB)</Text>
              </TouchableOpacity>
            )}

            {/* Description */}
            <AppInput
              label="Description"
              placeholder="Describe this portfolio piece (tools, result, timeline)"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              maxLength={500}
              editable={!isUploading}
              inputStyle={{ backgroundColor: '#f8fafc', height: 100 }}
            />

            <AppButton
              label={isUploading ? 'Uploading...' : 'Upload Item'}
              variant="neutral"
              onPress={uploadItem}
              disabled={!selectedImage || !description.trim() || isUploading}
              loading={isUploading}
              style={{ borderRadius: 12 }}
            />
          </View>

          {/* Portfolio Items Grid */}
          <View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: AppColors.ink900, marginBottom: AppSpace.md }}>
              Your Portfolio ({portfolioItems.length})
            </Text>

            {portfolioItems.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: AppSpace.xl }}>
                <Text style={{ fontSize: 48, marginBottom: 12 }}>📭</Text>
                <Text style={{ fontSize: 16, color: AppColors.ink700, fontWeight: '600', marginBottom: 4 }}>No portfolio items yet</Text>
                <Text style={{ fontSize: 14, color: AppColors.ink600, textAlign: 'center' }}>
                  Upload images of your work to showcase your skills and attract customers
                </Text>
              </View>
            ) : (
              <View style={{ gap: AppSpace.md }}>
                {portfolioItems.map((item) => (
                  <View key={item.id} style={{ borderRadius: AppRadius.lg, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' }}>
                    {item.imageUrl && (
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={{ width: '100%', height: 180, backgroundColor: '#f0f0f0' }}
                      />
                    )}
                    <View style={{ padding: AppSpace.md }}>
                      <Text style={{ fontSize: 14, color: AppColors.ink900, lineHeight: 20, marginBottom: AppSpace.sm }}>
                        {item.description}
                      </Text>
                      <Text style={{ fontSize: 12, color: AppColors.ink600, marginBottom: AppSpace.md }}>
                        {item.uploadedAt ? new Date(item.uploadedAt.seconds * 1000).toLocaleDateString() : 'Recently added'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => deleteItem(item.id)}
                        style={{
                          alignItems: 'center',
                          paddingVertical: 10,
                          backgroundColor: '#fee2e2',
                          borderRadius: AppRadius.md,
                        }}
                      >
                        <Text style={{ color: '#dc2626', fontWeight: '600', fontSize: 13 }}>Delete Item</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </ScreenShell>
  );
}
