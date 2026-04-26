import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Text } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors } from '../constants/design-tokens';

// Firebase
import { addDoc, collection } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { REQUEST_STATUS } from '../constants/access';
import { auth, db, storage } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

export default function Request() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [imageUri, setImageUri] = useState(null);   // local preview
  const [imageUrl, setImageUrl] = useState('');     // uploaded Storage URL
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const normalizedTitle = title.trim();
  const normalizedLocation = location.trim();
  const normalizedPrice = price.trim();
  const parsedPrice = Number(normalizedPrice);

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUri = URL.createObjectURL(file);
        setImageUri(localUri);
        await uploadImage(file);
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setNotice({ tone: 'warning', title: 'Permission required', message: 'Grant photo library access to attach an image.' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const { uri } = result.assets[0];
      setImageUri(uri);
      const response = await fetch(uri);
      const blob = await response.blob();
      await uploadImage(blob);
    }
  };

  const uploadImage = async (fileOrBlob) => {
    setIsUploadingImage(true);
    setNotice(null);
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        throw new Error('You need to be signed in before uploading images.');
      }

      const fileName = `${Date.now()}`;
      const storageRef = ref(storage, `request-images/${userId}/${fileName}`);
      await uploadBytes(storageRef, fileOrBlob);
      const url = await getDownloadURL(storageRef);
      setImageUrl(url);
    } catch (error) {
      setNotice({ tone: 'error', title: 'Image upload failed', message: error?.message || 'Could not upload image. You can still submit without one.' });
      setImageUri(null);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!normalizedTitle) {
      nextErrors.title = 'Add a short title for the request.';
    }

    if (!normalizedLocation) {
      nextErrors.location = 'Add the service location.';
    }

    if (!normalizedPrice) {
      nextErrors.price = 'Add a price for the request.';
    } else if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      nextErrors.price = 'Enter a valid price greater than zero.';
    }

    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setNotice({
        tone: 'error',
        title: 'Request details need attention',
        message: 'Complete the required fields before submitting.',
      });
      return false;
    }

    setNotice(null);
    return true;
  };

  const submitRequest = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      await addDoc(collection(db, 'requests'), {
        title: normalizedTitle,
        location: normalizedLocation,
        price: normalizedPrice,
        image: imageUrl,
        user: auth.currentUser?.email,
        acceptedBy: null,
        status: REQUEST_STATUS.OPEN,
        paid: false,
        rating: null,
        review: '',
        createdAt: new Date(),
      });

      router.replace('/home');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Request could not be saved',
        message: error.message || 'Could not save this request.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormScreen
      eyebrow="SERVICE DESK"
      title="Create Request"
      subtitle="Publish what you need with clear details and pricing."
      accentColor={AppColors.blue700}
      accentTextColor="#dbeafe"
      backgroundColor="#eff6ff"
      scroll
    >
        <Text style={{ fontSize: 20, marginBottom: 10, fontWeight: '700', color: AppColors.ink900 }}>
          Request Details
        </Text>

        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />

        <AppInput
          label="Title"
          placeholder="Title"
          value={title}
          onChangeText={setTitle}
          editable={!isSaving}
          error={fieldErrors.title}
        />

        <AppInput
          label="Location"
          placeholder="Location"
          value={location}
          onChangeText={setLocation}
          editable={!isSaving}
          error={fieldErrors.location}
        />

        <AppInput
          label="Price"
          placeholder="Price"
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
          editable={!isSaving}
          error={fieldErrors.price}
        />

        <Text style={{ fontWeight: '600', color: AppColors.ink900, marginBottom: 6 }}>Image (optional)</Text>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: '100%', height: 180, borderRadius: 10, marginBottom: 10 }}
            resizeMode="cover"
          />
        ) : null}
        <AppButton
          label={isUploadingImage ? 'Uploading...' : (imageUri ? 'Change Image' : 'Attach Image')}
          variant="neutral"
          onPress={pickImage}
          disabled={isSaving || isUploadingImage}
          loading={isUploadingImage}
          style={{ marginBottom: 16 }}
        />

        <AppButton
          label="Submit Request"
          variant="primary"
          onPress={submitRequest}
          disabled={!normalizedTitle || !normalizedLocation || !normalizedPrice || isUploadingImage}
          loading={isSaving}
        />
    </FormScreen>
  );
}