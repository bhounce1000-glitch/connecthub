import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import { STATUS_LABELS } from '../constants/access';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import { toDisplayDateTime } from '../utils/date-time';

export default function JobDetails() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams();
  const resolvedRequestId = useMemo(() => (Array.isArray(requestId) ? requestId[0] : requestId), [requestId]);

  const [job, setJob] = useState(null);
  const [owner, setOwner] = useState(null);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!resolvedRequestId) return;
      const snap = await getDoc(doc(db, 'requests', resolvedRequestId));
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() };
      setJob(data);

      if (data.user) {
        const ownerSnap = await getDoc(doc(db, 'users', data.user));
        setOwner(ownerSnap.exists() ? ownerSnap.data() : null);
      }
      if (data.acceptedBy) {
        const providerSnap = await getDoc(doc(db, 'users', data.acceptedBy));
        setProvider(providerSnap.exists() ? providerSnap.data() : null);
      }
    };

    load().catch(() => {});
  }, [resolvedRequestId]);

  if (!job) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: AppSpace.lg }}>
        <Text style={{ color: AppColors.ink500, marginBottom: 12 }}>Job details unavailable.</Text>
        <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg }}>
      <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 24, marginBottom: 12 }}>Job Summary</Text>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 17, marginBottom: 4 }}>{job.title}</Text>
        <Text style={{ color: AppColors.ink700, marginBottom: 8 }}>{job.description || 'No description provided.'}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Status: {STATUS_LABELS[job.status] || job.status || 'Open'}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Amount: GHS {job.price || 0}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Created: {toDisplayDateTime(job.createdAt)}</Text>
        {job.completedAt ? <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Completed: {toDisplayDateTime(job.completedAt)}</Text> : null}
        {job.paidAt ? <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Paid: {toDisplayDateTime(job.paidAt)}</Text> : null}
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', marginBottom: 8, color: AppColors.ink900 }}>Parties</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Avatar src={owner?.profilePicture} email={job.user} size={28} />
          <Text style={{ marginLeft: 8, color: AppColors.ink700 }}>Customer: {owner?.name || job.user || 'Unavailable'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar src={provider?.profilePicture} email={job.acceptedBy} size={28} />
          <Text style={{ marginLeft: 8, color: AppColors.ink700 }}>Provider: {provider?.name || job.acceptedBy || 'Unassigned'}</Text>
        </View>
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', marginBottom: 8, color: AppColors.ink900 }}>Review Summary</Text>
        <Text style={{ color: AppColors.ink700 }}>Provider rating: {job.rating ? `${job.rating} ★` : 'Not yet rated'}</Text>
        {job.review ? <Text style={{ color: AppColors.ink500, marginTop: 4 }}>"{job.review}"</Text> : null}
        <Text style={{ color: AppColors.ink700, marginTop: 8 }}>Customer rating: {job.customerRating ? `${job.customerRating} ★` : 'Not yet rated'}</Text>
        {job.customerReview ? <Text style={{ color: AppColors.ink500, marginTop: 4 }}>"{job.customerReview}"</Text> : null}
      </AppCard>

      <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
    </ScrollView>
  );
}
