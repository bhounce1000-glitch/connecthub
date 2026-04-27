import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

function StatBox({ label, value }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: '#f8fafc',
      borderRadius: AppRadius.md,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#e2e8f0',
    }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900 }}>{value}</Text>
      <Text style={{ fontSize: 12, color: AppColors.ink500, marginTop: 3, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function Badge({ label, color = '#e0e7ff', textColor = '#3730a3' }) {
  return (
    <View style={{ backgroundColor: color, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: textColor }}>{label}</Text>
    </View>
  );
}

export default function ProviderDetail() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const { user, isAuthReady } = useAuthUser();

  const [provider, setProvider] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    if (!email) return;

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'providers', email));
        if (snap.exists()) {
          setProvider({ id: snap.id, ...snap.data() });
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [email]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#eef2ff', padding: AppSpace.lg }}>
        <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
          <LoadingSkeleton height={14} width="25%" style={{ marginBottom: 8 }} />
          <LoadingSkeleton height={34} width="60%" />
        </View>
        <AppCard style={{ marginBottom: AppSpace.md }}>
          <LoadingSkeleton height={80} width={80} style={{ borderRadius: 40, marginBottom: 12 }} />
          <LoadingSkeleton height={20} width="50%" style={{ marginBottom: 8 }} />
          <LoadingSkeleton height={14} width="70%" style={{ marginBottom: 6 }} />
          <LoadingSkeleton height={14} width="60%" />
        </AppCard>
      </View>
    );
  }

  if (notFound || !provider) {
    return (
      <View style={{ flex: 1, backgroundColor: '#eef2ff', padding: AppSpace.lg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: AppColors.ink900, marginBottom: 8 }}>Provider not found</Text>
        <Text style={{ color: AppColors.ink500, marginBottom: 20, textAlign: 'center' }}>
          This provider profile may have been removed or made unavailable.
        </Text>
        <AppButton label="← Browse Providers" variant="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  const rating = provider.avgRating ? Number(provider.avgRating).toFixed(1) : null;
  const jobs = provider.jobsCompleted || 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#eef2ff' }}>
      <View style={{ padding: AppSpace.lg }}>
        {/* Header banner */}
        <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
          <Text style={{ fontSize: AppType.overline, color: '#c7d2fe', fontWeight: '700', letterSpacing: 0.4, fontFamily: 'serif' }}>
            PROVIDER PROFILE
          </Text>
          <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.white, marginTop: 4 }} numberOfLines={2}>
            {provider.name || provider.email}
          </Text>
          {provider.category ? (
            <Text style={{ color: '#c7d2fe', marginTop: 6, fontWeight: '600' }}>{provider.category}</Text>
          ) : null}
        </View>

        {/* Identity card */}
        <AppCard style={{ marginBottom: AppSpace.md, alignItems: 'center', paddingVertical: 24 }}>
          <Avatar src={provider.profilePicture} email={provider.email} size={80} />
          <Text style={{ fontSize: 20, fontWeight: '800', color: AppColors.ink900, marginTop: 12 }}>
            {provider.name || provider.email}
          </Text>
          <Text style={{ fontSize: 14, color: AppColors.ink500, marginTop: 4 }}>{provider.email}</Text>

          <View style={{ flexDirection: 'row', marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {provider.isAvailable ? (
              <Badge label="✓ AVAILABLE NOW" color="#d1fae5" textColor="#065f46" />
            ) : (
              <Badge label="UNAVAILABLE" color="#fee2e2" textColor="#991b1b" />
            )}
            {provider.category ? (
              <Badge label={provider.category} />
            ) : null}
          </View>
        </AppCard>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: AppSpace.md }}>
          <StatBox label="Rating" value={rating ? `⭐ ${rating}` : 'New'} />
          <StatBox label="Jobs Done" value={jobs} />
          {provider.experience ? (
            <StatBox label="Experience" value={`${provider.experience} yrs`} />
          ) : null}
        </View>

        {/* About */}
        {provider.bio ? (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              About
            </Text>
            <Text style={{ color: AppColors.ink700, lineHeight: 22 }}>{provider.bio}</Text>
          </AppCard>
        ) : null}

        {/* Details */}
        <AppCard style={{ marginBottom: AppSpace.md }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Details
          </Text>

          {provider.location ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>📍</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Service Area</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.location}</Text>
              </View>
            </View>
          ) : null}

          {provider.startingPrice ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>💰</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Starting Price</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>GHS {provider.startingPrice}</Text>
              </View>
            </View>
          ) : null}

          {provider.phone ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>📞</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Phone</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.phone}</Text>
              </View>
            </View>
          ) : null}

          {provider.experience ? (
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ width: 28, fontSize: 16 }}>🏆</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Experience</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.experience} year{Number(provider.experience) !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          ) : null}
        </AppCard>

        {/* Action buttons */}
        <AppButton
          label="Post a Request"
          variant="primary"
          onPress={() => router.push('/request')}
          style={{ marginBottom: AppSpace.sm, backgroundColor: '#4f46e5' }}
        />
        <Text style={{ fontSize: 13, color: AppColors.ink500, textAlign: 'center', marginBottom: AppSpace.md, lineHeight: 18 }}>
          Post your request on the board — providers like this one can see it and accept it. You can also chat to negotiate the price.
        </Text>

        <AppButton
          label="← Back to Providers"
          variant="neutral"
          onPress={() => router.back()}
          style={{ marginBottom: AppSpace.lg }}
        />
      </View>
    </ScrollView>
  );
}
