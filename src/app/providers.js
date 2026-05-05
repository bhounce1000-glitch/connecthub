import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { SERVICE_CATEGORIES } from './provider-setup';

const ALL = 'All';

export default function Providers() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  const [providers, setProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [sortBy, setSortBy] = useState('rating');

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    const q = query(collection(db, 'providers'), where('isAvailable', '==', true));
    return onSnapshot(q, (snap) => {
      (async () => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const enrichedRows = await Promise.all(
          rows.map(async (row) => {
            const providerEmail = String(row.email || row.id || '').trim().toLowerCase();
            if (!providerEmail) return row;

            try {
              const userSnap = await getDoc(doc(db, 'users', providerEmail));
              const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
              return {
                ...row,
                subscriptionPlan: userData.subscriptionPlan || row.subscriptionPlan || 'free',
              };
            } catch {
              return row;
            }
          })
        );

        enrichedRows.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
        setProviders(enrichedRows);
        setIsLoading(false);
      })();
    }, () => setIsLoading(false));
  }, []);

  const categories = useMemo(() => [ALL, ...SERVICE_CATEGORIES], []);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const rows = providers.filter((p) => {
      const matchesCategory = selectedCategory === ALL || p.category === selectedCategory;
      if (!q) return matchesCategory;
      const inName = (p.name || '').toLowerCase().includes(q);
      const inBio = (p.bio || '').toLowerCase().includes(q);
      const inLocation = (p.location || '').toLowerCase().includes(q);
      const inCategory = (p.category || '').toLowerCase().includes(q);
      return matchesCategory && (inName || inBio || inLocation || inCategory);
    });

    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'price') {
        return Number(a.startingPrice || 0) - Number(b.startingPrice || 0);
      }
      if (sortBy === 'experience') {
        return Number(b.experience || 0) - Number(a.experience || 0);
      }
      return Number(b.avgRating || 0) - Number(a.avgRating || 0);
    });

    return sorted;
  }, [providers, searchText, selectedCategory, sortBy]);

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2ff', padding: AppSpace.lg }}>
      {/* Header */}
      <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.md }}>
        <Text style={{ fontSize: AppType.overline, color: '#c7d2fe', fontWeight: '700', letterSpacing: 0.4, fontFamily: 'serif' }}>
          CONNECTHUB
        </Text>
        <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.white, marginTop: 4 }}>
          Browse Providers
        </Text>
        <Text style={{ color: '#e0e7ff', marginTop: 6, lineHeight: 20 }}>
          Find verified, available service providers near you.
        </Text>
      </View>

      {/* Search bar */}
      <View style={{
        backgroundColor: AppColors.white,
        borderRadius: AppRadius.md,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: AppSpace.sm,
      }}>
        <TextInput
          placeholder="Search by name, skill, or location…"
          placeholderTextColor="#94a3b8"
          value={searchText}
          onChangeText={setSearchText}
          style={{ color: AppColors.ink900, fontSize: AppType.body }}
        />
      </View>

      {/* Category filter chips */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(item) => item}
        style={{ marginBottom: AppSpace.sm, flexGrow: 0 }}
        renderItem={({ item: cat }) => {
          const active = selectedCategory === cat;
          return (
            <TouchableOpacity
              onPress={() => setSelectedCategory(cat)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: AppRadius.md,
                backgroundColor: active ? '#4f46e5' : AppColors.white,
                borderWidth: 1,
                borderColor: active ? '#4f46e5' : '#cbd5e1',
                marginRight: 8,
              }}
            >
              <Text style={{ fontWeight: '600', fontSize: 13, color: active ? AppColors.white : AppColors.ink700 }}>
                {cat}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      <View style={{ flexDirection: 'row', marginBottom: AppSpace.sm, gap: 8 }}>
        {['rating', 'price', 'experience'].map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => setSortBy(key)}
            style={{
              borderRadius: AppRadius.md,
              borderWidth: 1,
              borderColor: sortBy === key ? '#2563eb' : '#cbd5e1',
              backgroundColor: sortBy === key ? '#eff6ff' : '#fff',
              paddingHorizontal: 10,
              paddingVertical: 7,
            }}
          >
            <Text style={{ color: sortBy === key ? '#1d4ed8' : '#475569', fontWeight: '700', fontSize: 12 }}>
              {key === 'rating' ? 'Sort: Rating' : key === 'price' ? 'Sort: Price' : 'Sort: Experience'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Provider list */}
      {isLoading ? (
        <View>
          {[1, 2, 3].map((n) => (
            <AppCard key={n} style={{ marginBottom: 14 }}>
              <LoadingSkeleton height={18} width="55%" style={{ marginBottom: 10 }} />
              <LoadingSkeleton height={14} width="35%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={14} width="45%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={40} width="100%" />
            </AppCard>
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Text style={{ fontSize: 16, color: AppColors.ink500, textAlign: 'center', marginBottom: 6 }}>
                {searchText || selectedCategory !== ALL ? `No ${selectedCategory === ALL ? '' : selectedCategory + ' '}providers near you.` : 'No providers available right now.'}
              </Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
                Try a different category or location.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ProviderCard provider={item} onPress={() => router.push({ pathname: '/provider-detail', params: { email: item.email } })} />
          )}
        />
      )}

      <AppButton
        label="← Back to Home"
        variant="neutral"
        onPress={() => router.replace('/home')}
        style={{ marginTop: AppSpace.sm }}
      />
    </View>
  );
}

function ProviderCard({ provider, onPress }) {
  const photoCount = Array.isArray(provider.portfolioPhotos) ? provider.portfolioPhotos.length : 0;
  const rating = Number(provider.avgRating || 0);
  const stars = rating > 0 ? `${'★'.repeat(Math.round(Math.min(5, rating)))}${'☆'.repeat(5 - Math.round(Math.min(5, rating)))}` : '☆☆☆☆☆';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <AppCard style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Avatar src={provider.profilePicture} email={provider.email} size={48} style={{ marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>{provider.name || provider.email}</Text>
              <SubscriptionBadge plan={provider.subscriptionPlan} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 }}>
              {/* Availability badge */}
              <View style={{ backgroundColor: '#d1fae5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#065f46' }}>AVAILABLE</Text>
              </View>
              {provider.category ? (
                <View style={{ backgroundColor: '#e0e7ff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#3730a3' }}>{provider.category}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {provider.bio ? (
          <Text style={{ color: AppColors.ink700, fontSize: 13, lineHeight: 19, marginBottom: 10 }} numberOfLines={2}>
            {provider.bio}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {provider.location ? (
            <Text style={{ fontSize: 13, color: AppColors.ink500 }}>📍 {provider.location}</Text>
          ) : null}
          {provider.experience ? (
            <Text style={{ fontSize: 13, color: AppColors.ink500 }}>  •  {provider.experience} yrs exp</Text>
          ) : null}
          {provider.startingPrice ? (
            <Text style={{ fontSize: 13, color: AppColors.ink500 }}>  •  From GHS {provider.startingPrice}</Text>
          ) : null}
        </View>

        <View style={{ backgroundColor: '#f1f5f9', borderRadius: AppRadius.sm, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, color: AppColors.ink700 }}>{stars} {provider.avgRating ? Number(provider.avgRating).toFixed(1) : 'New'}</Text>
          <Text style={{ fontSize: 13, color: AppColors.ink700 }}>{provider.jobsCompleted || 0} reviews</Text>
          <Text style={{ fontSize: 13, color: '#4f46e5', fontWeight: '700' }}>From GHS {provider.startingPrice || '--'}</Text>
        </View>

        {photoCount > 0 ? <Text style={{ marginTop: 8, color: '#475569', fontSize: 12 }}>📷 {photoCount} photos</Text> : null}
        <AppButton label="View Profile" variant="primary" onPress={onPress} style={{ marginTop: 10 }} />
      </AppCard>
    </TouchableOpacity>
  );
}
