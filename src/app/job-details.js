import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, Text, View } from 'react-native';

import useAuthUser from '../hooks/use-auth-user';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import EmptyState from '../components/ui/empty-state';
import { STATUS_LABELS } from '../constants/access';
import { AppColors, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import { toDisplayDateTime } from '../utils/date-time';
import { getLocationCoords, getLocationLabel } from '../utils/location';

let NativeMapView = null;
let NativeMarker = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  NativeMapView = maps.default;
  NativeMarker = maps.Marker;
}

const STATUS_THEME = {
  open: { bg: '#dbeafe', fg: '#1d4ed8' },
  accepted: { bg: '#ffedd5', fg: '#c2410c' },
  in_progress: { bg: '#ede9fe', fg: '#5b21b6' },
  pending_confirmation: { bg: '#fef3c7', fg: '#b45309' },
  completed: { bg: '#dcfce7', fg: '#15803d' },
  paid: { bg: '#dcfce7', fg: '#166534' },
};

function TimelineRow({ title, value, done, isLast }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
      <View
        style={{
          width: 20,
          alignItems: 'center',
          marginTop: 1,
        }}
      >
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: done ? '#16a34a' : '#cbd5e1',
            backgroundColor: done ? '#16a34a' : '#fff',
          }}
        />
        {!isLast ? (
          <View
            style={{
              width: 2,
              height: 24,
              marginTop: 2,
              backgroundColor: done ? '#86efac' : '#e2e8f0',
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text style={{ color: AppColors.ink900, fontWeight: done ? '800' : '700' }}>{title}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>{value || 'Pending'}</Text>
      </View>
    </View>
  );
}

export default function JobDetails() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams();
  const resolvedRequestId = useMemo(() => (Array.isArray(requestId) ? requestId[0] : requestId), [requestId]);
  const { user, isAuthReady } = useAuthUser();

  useEffect(() => {
    if (isAuthReady && !user) router.replace('/auth');
  }, [isAuthReady, user, router]);

  const [job, setJob] = useState(null);
  const [owner, setOwner] = useState(null);
  const [provider, setProvider] = useState(null);
  const [doneCountdown, setDoneCountdown] = useState('');

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

  const statusKey = String(job?.status || '').trim().toLowerCase() || 'open';
  const tone = STATUS_THEME[statusKey] || STATUS_THEME.open;
  const isOwner = String(job?.user || '').trim().toLowerCase() === String(user?.email || '').trim().toLowerCase();
  const isAssignedProvider = String(job?.acceptedBy || '').trim().toLowerCase() === String(user?.email || '').trim().toLowerCase();
  const hasProvider = Boolean(job?.acceptedBy);
  const canFundEscrow = isOwner && statusKey === 'accepted' && !job?.escrowFunded && !job?.payment_received;
  const canConfirm = isOwner && statusKey === 'pending_confirmation';
  const canRate = isOwner && (statusKey === 'paid' || job?.paid) && !job?.rating;
  const isDoneLike = statusKey === 'done' || statusKey === 'pending_confirmation';
  const canOpenChat = hasProvider && (isOwner || isAssignedProvider);
  const destinationCoords = useMemo(() => getLocationCoords(job?.location), [job?.location]);
  const canOpenDirections = Boolean(hasProvider && destinationCoords);

  const handleOpenDirections = async () => {
    if (!destinationCoords) {
      Alert.alert('Missing location', 'This job does not have exact map coordinates yet.');
      return;
    }

    const { latitude, longitude } = destinationCoords;
    const destination = `${latitude},${longitude}`;
    const googleFallback = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL(`http://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`);
        return;
      }

      const androidNavigationUrl = `google.navigation:q=${encodeURIComponent(destination)}&mode=d`;
      const canOpenNavigation = await Linking.canOpenURL(androidNavigationUrl);
      if (canOpenNavigation) {
        await Linking.openURL(androidNavigationUrl);
      } else {
        await Linking.openURL(googleFallback);
      }
    } catch {
      Alert.alert('Unable to open directions', 'Please try again in a moment.');
    }
  };

  useEffect(() => {
    if (!job || !isDoneLike) {
      setDoneCountdown('');
      return undefined;
    }

    const completedMs = job?.completedAt?.seconds
      ? job.completedAt.seconds * 1000
      : new Date(job?.completedAt || Date.now()).getTime();
    if (!Number.isFinite(completedMs) || completedMs <= 0) {
      setDoneCountdown('Awaiting confirmation window details');
      return undefined;
    }

    const endMs = completedMs + (48 * 60 * 60 * 1000);
    const tick = () => {
      const remaining = endMs - Date.now();
      if (remaining <= 0) {
        setDoneCountdown('Auto-confirm window elapsed');
        return;
      }
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      setDoneCountdown(`${hours}h ${mins}m remaining to confirm`);
    };

    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [isDoneLike, job]);

  if (!job) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: AppSpace.lg }}>
        <EmptyState
          title="Job details unavailable"
          description="This request might have been removed, or your access changed."
        />
        <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: 16, padding: 18, marginBottom: 12 }}>
        <Text style={{ color: '#93c5fd', fontWeight: '700', fontSize: 12, letterSpacing: 0.8 }}>CONNECTHUB</Text>
        <Text style={{ fontWeight: '800', color: '#fff', fontSize: 24, marginTop: 4 }} numberOfLines={2}>{job.title}</Text>
        <View style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 12 }}>
            {STATUS_LABELS[job.status] || job.status || 'Open'}
          </Text>
        </View>
      </View>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', color: AppColors.ink900, fontSize: 16, marginBottom: 8 }}>Overview</Text>
        <Text style={{ color: AppColors.ink700, marginBottom: 8 }}>{job.description || 'Work details shared in request chat.'}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Location: {getLocationLabel(job.location) || job.locationText || 'Accra, Ghana'}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Amount: GHS {job.price || 0}</Text>
        <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Created: {toDisplayDateTime(job.createdAt)}</Text>

        {destinationCoords ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: AppColors.ink700, fontWeight: '700', marginBottom: 6 }}>Map Preview</Text>
            {Platform.OS === 'web' || !NativeMapView ? (
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', padding: 10 }}>
                <Text style={{ color: AppColors.ink700, fontSize: 12 }}>Map preview is available in Android/iPhone builds.</Text>
                <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 4 }}>
                  {destinationCoords.latitude.toFixed(6)}, {destinationCoords.longitude.toFixed(6)}
                </Text>
              </View>
            ) : (
              <View style={{ height: 170, borderRadius: 10, overflow: 'hidden' }}>
                <NativeMapView
                  style={{ flex: 1 }}
                  pointerEvents="none"
                  initialRegion={{
                    latitude: destinationCoords.latitude,
                    longitude: destinationCoords.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                >
                  {NativeMarker ? <NativeMarker coordinate={destinationCoords} title="Job location" /> : null}
                </NativeMapView>
              </View>
            )}
          </View>
        ) : null}
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', marginBottom: 10, color: AppColors.ink900, fontSize: 16 }}>Progress Timeline</Text>
        <TimelineRow title="Job posted" value={toDisplayDateTime(job.createdAt)} done isLast={false} />
        <TimelineRow title="Provider accepted" value={job.acceptedAt ? toDisplayDateTime(job.acceptedAt) : 'Waiting for provider'} done={Boolean(job.acceptedAt || job.acceptedBy)} isLast={false} />
        <TimelineRow title="Escrow funded" value={job.payment_received || job.escrowFunded ? 'Payment secured' : 'Pending customer payment'} done={Boolean(job.payment_received || job.escrowFunded)} isLast={false} />
        <TimelineRow title="Work in progress" value={job.work_started ? 'Provider started work' : 'Not started'} done={Boolean(job.work_started)} isLast={false} />
        <TimelineRow title="Work completed" value={job.completedAt ? toDisplayDateTime(job.completedAt) : 'Awaiting completion'} done={Boolean(job.work_completed || job.completedAt)} isLast={false} />
        <TimelineRow title="Customer confirmed" value={job.completionConfirmedAt ? toDisplayDateTime(job.completionConfirmedAt) : 'Awaiting confirmation'} done={Boolean(job.customer_confirmed || job.completionConfirmedAt)} isLast={true} />
      </AppCard>

      {isDoneLike ? (
        <AppCard style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: '700', color: AppColors.ink900, fontSize: 16 }}>Confirmation Countdown</Text>
          <Text style={{ marginTop: 6, color: '#1e3a8a', fontWeight: '700' }}>{doneCountdown || 'Calculating...'}</Text>
        </AppCard>
      ) : null}

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', marginBottom: 10, color: AppColors.ink900, fontSize: 16 }}>Payout</Text>
        <TimelineRow title="Payout released" value={job.paidAt ? toDisplayDateTime(job.paidAt) : 'Awaiting payout'} done={Boolean(job.paid || job.paidAt)} isLast={true} />
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '700', marginBottom: 10, color: AppColors.ink900, fontSize: 16 }}>People</Text>
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
        <Text style={{ fontWeight: '700', marginBottom: 8, color: AppColors.ink900, fontSize: 16 }}>Review Summary</Text>
        <Text style={{ color: AppColors.ink700 }}>Provider rating: {job.rating ? `${job.rating} ★` : 'Not yet rated'}</Text>
        {job.review ? <Text style={{ color: AppColors.ink500, marginTop: 4 }}>&quot;{job.review}&quot;</Text> : null}
        <Text style={{ color: AppColors.ink700, marginTop: 8 }}>Customer rating: {job.customerRating ? `${job.customerRating} ★` : 'Not yet rated'}</Text>
        {job.customerReview ? <Text style={{ color: AppColors.ink500, marginTop: 4 }}>&quot;{job.customerReview}&quot;</Text> : null}
      </AppCard>

      <View style={{ marginBottom: 8 }}>
        {canOpenChat ? (
          <AppButton
            label="Open Chat"
            onPress={() => router.push({ pathname: '/chat', params: { requestId: job.id } })}
            style={{ marginBottom: 8 }}
          />
        ) : null}

        {canOpenDirections ? (
          <AppButton
            label="Open Directions"
            onPress={handleOpenDirections}
            style={{ marginBottom: 8, backgroundColor: '#0ea5e9' }}
          />
        ) : null}

        {canFundEscrow ? (
          <AppButton
            label="Fund Escrow"
            onPress={() => router.push({ pathname: '/pay', params: { id: job.id, amount: job.price, email: user?.email || '' } })}
            style={{ marginBottom: 8, backgroundColor: '#16a34a' }}
          />
        ) : null}

        {canConfirm ? (
          <AppButton
            label="Confirm Completion"
            onPress={() => router.push({ pathname: '/confirm-completion', params: { requestId: job.id } })}
            style={{ marginBottom: 8, backgroundColor: '#2563eb' }}
          />
        ) : null}

        {canRate ? (
          <AppButton
            label="Leave Review"
            variant="warning"
            onPress={() => router.push({ pathname: '/rate', params: { requestId: job.id, providerEmail: job.acceptedBy || '' } })}
            style={{ marginBottom: 8 }}
          />
        ) : null}
      </View>

      <AppButton label="Back" variant="neutral" onPress={() => router.back()} />
    </ScrollView>
  );
}
