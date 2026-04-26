import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { useRouter } from 'expo-router';
import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors } from '../constants/design-tokens';
import useAuthUser from '../hooks/use-auth-user';

// Firebase
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

export default function Profile() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const [stats, setStats] = useState({
    jobs: 0,
    rating: 0,
    earned: 0,
  });
  const [profilePicture, setProfilePicture] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);

  const handleUploadPicture = async () => {
    if (Platform.OS === 'web') {
      // Web: use native file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await uploadFile(file);
      };
      input.click();
    } else {
      // Native: request permission then launch image library
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access your photo library is required to set a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      // Fetch the image as a blob and upload
      const { uri } = result.assets[0];
      const response = await fetch(uri);
      const blob = await response.blob();
      await uploadFile(blob);
    }
  };

  const uploadFile = async (fileOrBlob) => {
    setIsUploading(true);
    try {
      const userId = user?.uid;
      if (!userId) {
        throw new Error('You need to be signed in to upload a picture.');
      }

      const storageRef = ref(storage, `profile-pictures/${userId}`);
      await uploadBytes(storageRef, fileOrBlob);
      const downloadURL = await getDownloadURL(storageRef);

      await setDoc(
        doc(db, 'users', currentEmail),
        {
          email: currentEmail,
          profilePicture: downloadURL,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setProfilePicture(downloadURL);
      setUploadNotice({ tone: 'success', title: 'Picture updated', message: 'Your profile picture was saved.' });
    } catch (error) {
      console.error('Error uploading picture:', error);
      setUploadNotice({ tone: 'error', title: 'Upload failed', message: error?.message || 'Could not upload your picture. Please try again.' });
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!currentEmail) {
      router.replace('/auth');
      return;
    }

    const fetchStats = async () => {
      const snapshot = await getDocs(collection(db, 'requests'));

      let jobs = 0;
      let totalRating = 0;
      let ratingCount = 0;
      let earned = 0;

      snapshot.forEach((doc) => {
        const data = doc.data();

        // Jobs completed (accepted + paid)
        if (data.acceptedBy === currentEmail && data.paid) {
          jobs++;
          earned += Number(data.price || 0);
        }

        // Ratings received
        if (data.acceptedBy === currentEmail && data.rating) {
          totalRating += data.rating;
          ratingCount++;
        }
      });

      const avgRating = ratingCount ? (totalRating / ratingCount).toFixed(1) : 0;

      setStats({
        jobs,
        rating: avgRating,
        earned,
      });

      await (async () => {
        if (!currentEmail) return;
        try {
          const userDoc = await getDoc(doc(db, 'users', currentEmail));
          if (userDoc.exists()) {
            setProfilePicture(userDoc.data().profilePicture || null);
          }
        } catch (error) {
          console.log('Error fetching profile:', error.message);
        }
      })();
      setIsLoading(false);
    };

    fetchStats();
  }, [currentEmail, isAuthReady, router]);

  return (
    <ScreenShell
      eyebrow="ACCOUNT"
      title="Profile"
      subtitle={currentEmail || 'Unavailable'}
      accentColor="#0f172a"
      accentTextColor="#cbd5e1"
    >
      {isLoading ? (
        <AppCard>
          <LoadingSkeleton height={16} width="35%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={28} width="25%" style={{ marginBottom: 18 }} />
          <LoadingSkeleton height={16} width="40%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={28} width="20%" style={{ marginBottom: 18 }} />
          <LoadingSkeleton height={16} width="35%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={28} width="30%" />
        </AppCard>
      ) : (
        <View>
          <AppCard style={{ marginBottom: 12, paddingVertical: 20, alignItems: 'center' }}>
            <Pressable onPress={handleUploadPicture} disabled={isUploading}>
              <Avatar
                src={profilePicture}
                email={currentEmail}
                size={80}
                style={{ opacity: isUploading ? 0.6 : 1 }}
              />
              <Text style={{ fontSize: 12, color: AppColors.ink500, marginTop: 8, textAlign: 'center' }}>
                {isUploading ? 'Uploading...' : 'Tap to change picture'}
              </Text>
            </Pressable>
          </AppCard>

          <AppNotice
            tone={uploadNotice?.tone}
            title={uploadNotice?.title}
            message={uploadNotice?.message}
            style={{ marginBottom: 12 }}
          />

          <AppCard style={{ marginBottom: 12 }}>
            <Text style={{ color: AppColors.ink500, marginBottom: 6 }}>Jobs Completed</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: AppColors.ink900 }}>{stats.jobs}</Text>
          </AppCard>

          <AppCard style={{ marginBottom: 12 }}>
            <Text style={{ color: AppColors.ink500, marginBottom: 6 }}>Average Rating</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: AppColors.ink900 }}>{stats.rating}</Text>
          </AppCard>

          <AppCard>
            <Text style={{ color: AppColors.ink500, marginBottom: 6 }}>Total Earned</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: AppColors.ink900 }}>GHS {stats.earned}</Text>
          </AppCard>

          <AppButton
            label="← Back to Home"
            variant="neutral"
            onPress={() => router.replace('/home')}
            style={{ marginTop: 16 }}
          />
        </View>
      )}
    </ScreenShell>
  );
}
