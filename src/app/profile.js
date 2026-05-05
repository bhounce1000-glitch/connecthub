import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, TouchableOpacity, View } from 'react-native';

import { useRouter } from 'expo-router';
import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import useAuthUser from '../hooks/use-auth-user';

// Firebase
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

const TERMINAL_STATUSES = new Set(['completed', 'paid', 'disputed', 'cancelled']);

const STATUS_BADGE = {
  paid:      { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
  completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
  disputed:  { label: 'Disputed',  bg: '#fee2e2', color: '#991b1b' },
  cancelled: { label: 'Cancelled', bg: '#f1f5f9', color: '#475569' },
};

function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <View style={{
      flexDirection: 'row',
      marginBottom: AppSpace.md,
      borderRadius: AppRadius.md,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#e2e8f0',
    }}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          onPress={() => onTabChange(tab.key)}
          style={{
            flex: 1,
            paddingVertical: 11,
            backgroundColor: activeTab === tab.key ? '#0f172a' : '#f8fafc',
            alignItems: 'center',
          }}
        >
          <Text style={{
            fontWeight: '700',
            fontSize: 13,
            color: activeTab === tab.key ? '#ffffff' : '#64748b',
          }}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function StarRating({ value }) {
  if (!value) return null;
  const n = Math.min(5, Math.max(1, Number(value)));
  return (
    <Text style={{ color: '#d97706', fontSize: 14, letterSpacing: 1 }}>
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </Text>
  );
}

function JobHistoryCard({ job, role, profiles }) {
  const isWorker = role === 'worker';
  const otherPartyEmail = isWorker ? job.user : (job.acceptedBy || null);
  const ratingReceived = isWorker ? job.rating : job.customerRating;

  const rawDate = job.paidAt || job.completedAt || job.ratedAt || job.updatedAt;
  let formattedDate = '—';
  if (rawDate) {
    try {
      const d = typeof rawDate === 'string' ? new Date(rawDate) : rawDate.toDate?.();
      if (d && !Number.isNaN(d.getTime())) formattedDate = d.toLocaleDateString();
    } catch {}
  }

  const badge = STATUS_BADGE[job.status] || STATUS_BADGE.paid;
  const profile = otherPartyEmail ? profiles[otherPartyEmail] : null;
  const displayName = profile?.name || otherPartyEmail || 'Unknown';

  return (
    <AppCard style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
        <Avatar src={profile?.profilePicture || null} email={otherPartyEmail} size={40} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={{ fontWeight: '700', color: AppColors.ink900, fontSize: 15 }} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={{ fontSize: 12, color: AppColors.ink500, marginTop: 2 }}>
            {isWorker ? 'Customer' : 'Worker'}: {displayName}
          </Text>
        </View>
        <View style={{
          backgroundColor: badge.bg,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
          marginLeft: 8,
          alignSelf: 'flex-start',
        }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: badge.color }}>{badge.label}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ fontSize: 12, color: AppColors.ink500 }}>{formattedDate}</Text>
          <Text style={{ fontWeight: '700', color: AppColors.ink900, marginTop: 2, fontSize: 15 }}>
            GHS {Number(job.price || 0).toFixed(2)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {ratingReceived ? (
            <StarRating value={ratingReceived} />
          ) : (
            <Text style={{ fontSize: 12, color: AppColors.ink500 }}>No rating</Text>
          )}
          <Text style={{ fontSize: 11, color: AppColors.ink500, marginTop: 2 }}>
            {isWorker ? 'Rating received' : 'Your rating'}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

export default function Profile() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const [stats, setStats] = useState({ jobs: 0, rating: 0, earned: 0 });
  const [profilePicture, setProfilePicture] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);

  const [activeTab, setActiveTab] = useState('overview');
  const [historyJobs, setHistoryJobs] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [otherPartyProfiles, setOtherPartyProfiles] = useState({});

  const handleUploadPicture = async () => {
    if (Platform.OS === 'web') {
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
      if (!userId) throw new Error('You need to be signed in to upload a picture.');
      const storageRef = ref(storage, `profile-pictures/${userId}`);
      await uploadBytes(storageRef, fileOrBlob);
      const downloadURL = await getDownloadURL(storageRef);
      await setDoc(
        doc(db, 'users', currentEmail),
        { email: currentEmail, profilePicture: downloadURL, updatedAt: new Date() },
        { merge: true }
      );
      setProfilePicture(downloadURL);
      setUploadNotice({ tone: 'success', title: 'Picture updated', message: 'Your profile picture was saved.' });
    } catch {
      setUploadNotice({ tone: 'error', title: 'Upload failed', message: 'Could not upload your picture. Please try again.' });
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!isAuthReady) return;
    if (!currentEmail) { router.replace('/auth'); return; }

    const fetchStats = async () => {
      const q = query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail));
      const snapshot = await getDocs(q);

      let jobs = 0;
      let totalRating = 0;
      let ratingCount = 0;
      let earned = 0;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.paid) { jobs++; earned += Number(data.price || 0); }
        if (data.rating) { totalRating += data.rating; ratingCount++; }
      });

      setStats({ jobs, rating: ratingCount ? (totalRating / ratingCount).toFixed(1) : 0, earned });

      try {
        const userDoc = await getDoc(doc(db, 'users', currentEmail));
        if (userDoc.exists()) setProfilePicture(userDoc.data().profilePicture || null);
      } catch {}

      setIsLoading(false);
    };

    fetchStats();
  }, [currentEmail, isAuthReady, router]);

  const loadHistory = async () => {
    if (historyLoaded || isHistoryLoading) return;
    setIsHistoryLoading(true);
    try {
      const [customerSnap, workerSnap] = await Promise.all([
        getDocs(query(collection(db, 'requests'), where('user', '==', currentEmail))),
        getDocs(query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail))),
      ]);

      // Merge & deduplicate — worker role wins if the same doc appears in both queries
      const seen = new Map();
      customerSnap.docs.forEach((d) => {
        const data = d.data();
        if (TERMINAL_STATUSES.has(data.status) || data.paid) {
          seen.set(d.id, { id: d.id, role: 'customer', ...data });
        }
      });
      workerSnap.docs.forEach((d) => {
        const data = d.data();
        if (TERMINAL_STATUSES.has(data.status) || data.paid) {
          seen.set(d.id, { id: d.id, role: 'worker', ...data });
        }
      });

      const jobs = Array.from(seen.values()).sort((a, b) => {
        const ts = (j) => {
          const v = j.paidAt || j.completedAt || j.createdAt || '';
          return typeof v === 'string' ? v : v?.seconds ? String(v.seconds) : '';
        };
        return ts(b).localeCompare(ts(a));
      });

      setHistoryJobs(jobs);

      // Batch-fetch other-party name + profile picture
      const emailsToFetch = new Set();
      jobs.forEach((job) => {
        const other = job.role === 'worker' ? job.user : job.acceptedBy;
        if (other && other !== currentEmail) emailsToFetch.add(other);
      });

      const profileResults = {};
      await Promise.all([...emailsToFetch].map(async (email) => {
        try {
          const [userSnap, providerSnap] = await Promise.all([
            getDoc(doc(db, 'users', email)),
            getDoc(doc(db, 'providers', email)),
          ]);
          profileResults[email] = {
            name: providerSnap.data()?.name || userSnap.data()?.name || null,
            profilePicture: userSnap.data()?.profilePicture || providerSnap.data()?.profilePicture || null,
          };
        } catch {}
      }));

      setOtherPartyProfiles(profileResults);
    } catch {}

    setIsHistoryLoading(false);
    setHistoryLoaded(true);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'history') loadHistory();
  };

  return (
    <ScreenShell
      eyebrow="ACCOUNT"
      title="Profile"
      subtitle={currentEmail || 'Unavailable'}
      accentColor="#0f172a"
      accentTextColor="#cbd5e1"
      scroll
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
              <View>
                <Avatar
                  src={profilePicture}
                  email={currentEmail}
                  size={88}
                  style={{ opacity: isUploading ? 0.6 : 1 }}
                />
                <View style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                  <Text style={{ color: '#fff', fontSize: 12 }}>📷</Text>
                </View>
              </View>
              <Text style={{ fontWeight: '800', color: AppColors.ink900, textAlign: 'center', marginTop: 8, fontSize: 18 }}>{currentEmail.split('@')[0]}</Text>
              <Text style={{ color: AppColors.ink500, textAlign: 'center', marginTop: 2 }}>{currentEmail}</Text>
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

          {/* Tab bar */}
          <TabBar
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'history', label: 'Job History' },
            ]}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <AppCard style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18 }}>🏆</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: AppColors.ink900, marginTop: 4 }}>{stats.jobs}</Text>
                  <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Jobs Completed</Text>
                </AppCard>
                <AppCard style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18 }}>⭐</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: AppColors.ink900, marginTop: 4 }}>{stats.rating || '0.0'}/5</Text>
                  <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Average Rating</Text>
                </AppCard>
                <AppCard style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18 }}>💰</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: AppColors.ink900, marginTop: 4 }}>GHS {stats.earned}</Text>
                  <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Total Earned</Text>
                </AppCard>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <AppButton label="⭐ My Reviews" variant="neutral" onPress={() => handleTabChange('history')} style={{ flex: 1 }} />
                <AppButton label="🧰 Portfolio" variant="neutral" onPress={() => router.push('/provider-portfolio')} style={{ flex: 1 }} />
                <AppButton label="🚀 Subscription" variant="neutral" onPress={() => router.push('/subscription')} style={{ flex: 1 }} />
              </View>

              <AppCard>
                <Text style={{ fontWeight: '800', color: AppColors.ink900, marginBottom: 8 }}>Settings</Text>
                <TouchableOpacity onPress={() => router.push('/provider-setup')} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}><Text style={{ color: AppColors.ink900 }}>Edit Profile  →</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/referral')} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}><Text style={{ color: AppColors.ink900 }}>Invite Friends  →</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/help')} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}><Text style={{ color: AppColors.ink900 }}>Help & Support  →</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => router.replace('/auth')} style={{ paddingTop: 12 }}><Text style={{ color: '#dc2626', fontWeight: '700' }}>Sign Out</Text></TouchableOpacity>
              </AppCard>

              <AppButton
                label="← Back to Home"
                variant="neutral"
                onPress={() => router.replace('/home')}
                style={{ marginTop: 16 }}
              />

              <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 20 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Provider Marketplace
                </Text>
                <AppButton
                  label="Set Up / Edit Provider Profile"
                  onPress={() => router.push('/provider-setup')}
                  style={{ marginBottom: 10, backgroundColor: '#4f46e5' }}
                />
                <AppButton
                  label="Browse Available Providers"
                  variant="neutral"
                  onPress={() => router.push('/providers')}
                />
              </View>
            </View>
          )}

          {/* Job History tab */}
          {activeTab === 'history' && (
            <View>
              {isHistoryLoading ? (
                <View>
                  {[0, 1, 2].map((i) => (
                    <AppCard key={i} style={{ marginBottom: 10 }}>
                      <LoadingSkeleton height={14} width="60%" style={{ marginBottom: 8 }} />
                      <LoadingSkeleton height={12} width="40%" style={{ marginBottom: 8 }} />
                      <LoadingSkeleton height={12} width="30%" />
                    </AppCard>
                  ))}
                </View>
              ) : historyJobs.length === 0 ? (
                <AppCard>
                  <Text style={{ textAlign: 'center', color: AppColors.ink500, paddingVertical: 20, lineHeight: 22 }}>
                    No past jobs yet.{'\n'}Completed, disputed, and cancelled jobs will appear here.
                  </Text>
                </AppCard>
              ) : (
                historyJobs.map((job) => (
                  <JobHistoryCard
                    key={job.id}
                    job={job}
                    role={job.role}
                    profiles={otherPartyProfiles}
                  />
                ))
              )}
            </View>
          )}
        </View>
      )}
    </ScreenShell>
  );
}
