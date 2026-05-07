import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

const ALL = 'All';
const FILTER_CATEGORIES = [
  'All', 'Cleaning', 'Plumbing', 'Electrical', 'Driving', 'Cooking', 'Beauty', 'Construction', 'Moving', 'Security', 'Tech', 'Gardening', 'Tutoring',
];

const AVATAR_COLORS = ['#dbeafe', '#fef3c7', '#dcfce7', '#ede9fe', '#fee2e2'];

function buildStars(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating || 0))));
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

function EmptyState({ category, onBrowseAll, onBecomeProvider, onPostRequest }) {
  const title = category && category !== ALL ? `No ${category} providers found` : 'No providers available right now';
  return (
    <View style={{ alignItems: 'center', paddingVertical: 52, paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 56 }}>🔍</Text>
      <Text style={{ marginTop: 10, color: AppColors.ink900, fontWeight: '800', fontSize: 18, textAlign: 'center' }}>{title}</Text>
      <Text style={{ marginTop: 6, color: '#94a3b8', textAlign: 'center' }}>Check back later, browse all categories, or post your request now.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 14, gap: 8 }}>
        <TouchableOpacity onPress={onBrowseAll} style={{ backgroundColor: '#2563eb', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Browse All</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPostRequest} style={{ backgroundColor: '#0f766e', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Post a Job</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBecomeProvider} style={{ backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: '#334155', fontWeight: '800', fontSize: 12 }}>Become Provider</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function Providers() {
  const router = useRouter();
  const { user, isAuthReady } = useAuthUser();

  const [providers, setProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [sortBy, setSortBy] = useState('rating');

  useEffect(() => {
    if (isAuthReady && !user) router.replace('/auth');
  }, [isAuthReady, router, user]);

  useEffect(() => {
    const q = query(collection(db, 'providers'), where('isAvailable', '==', true));
    return onSnapshot(q, (snap) => {
      (async () => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const enriched = await Promise.all(rows.map(async (row) => {
          const email = String(row.email || row.id || '').trim().toLowerCase();
          if (!email) return row;
          try {
            const userSnap = await getDoc(doc(db, 'users', email));
            const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
            return {
              ...row,
              email,
              subscriptionPlan: userData.subscriptionPlan || row.subscriptionPlan || 'free',
            };
          } catch {
            return { ...row, email };
          }
        }));
        setProviders(enriched);
        setIsLoading(false);
      })();
    }, () => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const rows = providers.filter((p) => {
      const categoryMatch = selectedCategory === ALL || String(p.category || '').toLowerCase().includes(selectedCategory.toLowerCase());
      if (!categoryMatch) return false;
      if (!q) return true;
      const hay = `${p.name || ''} ${p.category || ''} ${p.location || ''} ${p.bio || ''}`.toLowerCase();
      return hay.includes(q);
    });

    rows.sort((a, b) => {
      if (sortBy === 'price') return Number(a.startingPrice || 0) - Number(b.startingPrice || 0);
      if (sortBy === 'experience') return Number(b.experience || 0) - Number(a.experience || 0);
      return Number(b.avgRating || 0) - Number(a.avgRating || 0);
    });

    return rows;
  }, [providers, searchText, selectedCategory, sortBy]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 450);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: 12 }}>
        <Text style={{ color: '#93c5fd', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>CONNECTHUB</Text>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>Browse Providers</Text>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}>
        <TextInput
          placeholder="Search by name, skill, or location"
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor="#94a3b8"
          style={{ color: AppColors.ink900 }}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        {FILTER_CATEGORIES.map((cat) => {
          const active = selectedCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => setSelectedCategory(cat)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? '#2563eb' : '#fff',
                borderWidth: 1,
                borderColor: active ? '#2563eb' : '#cbd5e1',
                marginRight: 8,
              }}
            >
              <Text style={{ color: active ? '#fff' : '#64748b', fontWeight: '700', fontSize: 12 }}>{cat}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ color: '#64748b', fontSize: 12, marginRight: 10 }}>Sort by:</Text>
        {['rating', 'price', 'experience'].map((key) => {
          const active = sortBy === key;
          const label = key === 'rating' ? 'Rating' : key === 'price' ? 'Price' : 'Experience';
          return (
            <TouchableOpacity key={key} onPress={() => setSortBy(key)} style={{ marginRight: 12 }}>
              <Text style={{ color: active ? '#2563eb' : '#94a3b8', fontWeight: '800', fontSize: 13 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View>
          {[1, 2, 3].map((n) => (
            <AppCard key={n} style={{ marginBottom: 10 }}>
              <LoadingSkeleton height={18} width="52%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={14} width="70%" style={{ marginBottom: 8 }} />
              <LoadingSkeleton height={36} width="100%" />
            </AppCard>
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={(
            <EmptyState
              category={selectedCategory}
              onBrowseAll={() => setSelectedCategory(ALL)}
              onPostRequest={() => router.push('/request-wizard')}
              onBecomeProvider={() => router.push('/provider-setup')}
            />
          )}
          renderItem={({ item, index }) => {
            const letter = String(item.name || item.email || '?').trim().charAt(0).toUpperCase();
            const avatarBg = AVATAR_COLORS[index % AVATAR_COLORS.length];
            const reviews = Number(item.jobsCompleted || item.reviewCount || 0);
            const photoCount = Array.isArray(item.portfolioPhotos) ? item.portfolioPhotos.length : 0;
            return (
              <AppCard style={{ marginBottom: 12, borderRadius: 12, ...AppShadow.card }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: avatarBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ color: '#1e3a8a', fontWeight: '900', fontSize: 18 }}>{letter || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <Text style={{ color: AppColors.ink900, fontWeight: '800', fontSize: 16 }}>{item.name || item.email}</Text>
                      <SubscriptionBadge plan={item.subscriptionPlan} />
                    </View>
                    <View style={{ marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#1d4ed8', fontSize: 11, fontWeight: '700' }}>{item.category || 'General'}</Text>
                    </View>
                  </View>
                </View>

                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: '#0f172a', fontWeight: '700' }}>{buildStars(item.avgRating)} ({Number(item.avgRating || 0).toFixed(1)}) — {reviews} reviews</Text>
                  <Text style={{ color: '#64748b', marginTop: 4 }}>📍 {item.location || 'Location not provided'}</Text>
                  <Text style={{ color: '#16a34a', marginTop: 4, fontWeight: '800' }}>From GHS {Number(item.startingPrice || 0).toFixed(2)}</Text>
                  {photoCount > 0 ? <Text style={{ color: '#94a3b8', marginTop: 4 }}>📷 {photoCount} photos</Text> : null}
                </View>

                <AppButton
                  label="View Profile →"
                  onPress={() => router.push({ pathname: '/provider-detail', params: { email: item.email } })}
                  style={{ marginTop: 10, backgroundColor: '#2563eb' }}
                />
              </AppCard>
            );
          }}
        />
      )}

      <AppButton label="← Back to Home" variant="neutral" onPress={() => router.replace('/home')} style={{ marginTop: 8 }} />
    </View>
  );
}
