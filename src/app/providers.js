import { useRouter } from 'expo-router';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { calculateDistance, formatDistance, getCurrentLocation, getLocationCoords } from '../utils/location';
import { getProviderBadge } from '../utils/provider-badges';

const ALL = 'All';
const FILTER_CATEGORIES = [
  'All', 'Cleaning', 'Plumbing', 'Electrical', 'Driving', 'Cooking', 'Beauty', 'Construction', 'Moving', 'Security', 'Tech', 'Gardening', 'Tutoring',
];

const AVATAR_COLORS = ['#dbeafe', '#fef3c7', '#dcfce7', '#ede9fe', '#fee2e2'];
const BLOCKED_PROVIDER_EMAIL_PARTS = ['test', 'gmx.dev', 'mailinator', 'example.com', 'local'];

function isPublicProviderEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return !BLOCKED_PROVIDER_EMAIL_PARTS.some((part) => normalized.includes(part));
}

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
        <TouchableOpacity onPress={onBrowseAll} style={{ backgroundColor: '#1d4ed8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
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
  const [myLocation, setMyLocation] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [nearbyFilter, setNearbyFilter] = useState('any');

  useEffect(() => {
    if (isAuthReady && !user) router.replace('/auth');
  }, [isAuthReady, router, user]);

  useEffect(() => {
    getCurrentLocation().then((loc) => {
      if (loc) setMyLocation(loc);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const usersRoleQ = query(collection(db, 'users'), where('role', '==', 'provider'), limit(100));
    const usersFlagQ = query(collection(db, 'users'), where('isProvider', '==', true), limit(100));
    const providersQ = query(collection(db, 'providers'), limit(100));
    const profilesQ = query(collection(db, 'providerProfiles'), limit(100));

    let roleRows = [];
    let flagRows = [];
    let providerRows = [];
    let profileRows = [];

    const mergeRows = async () => {
      const mergedMap = new Map();
      [...roleRows, ...flagRows, ...providerRows, ...profileRows].forEach((row) => {
        const email = String(row.email || row.id || '').trim().toLowerCase();
        if (!email || !isPublicProviderEmail(email)) return;
        const current = mergedMap.get(email) || {};
        mergedMap.set(email, { ...current, ...row, email, id: email });
      });

      const mergedRows = Array.from(mergedMap.values());
      const enriched = await Promise.all(mergedRows.map(async (row) => {
        try {
          const userSnap = await getDoc(doc(db, 'users', row.email));
          const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
          return {
            ...row,
            subscriptionPlan: userData.subscriptionPlan || row.subscriptionPlan || 'free',
            avgRating: Number(row.avgRating || userData.avgRating || 0),
            jobsCompleted: Number(row.jobsCompleted || userData.jobsCompleted || 0),
            category: row.category || userData.category || '',
            startingPrice: row.startingPrice || userData.startingPrice || '',
            skills: Array.isArray(row.skills) ? row.skills : (Array.isArray(userData.skills) ? userData.skills : []),
            bio: row.bio || row.about || userData.bio || userData.about || '',
            location: row.location || userData.location || '',
          };
        } catch {
          return row;
        }
      }));

      enriched.sort((a, b) => {
        const aProfileScore = Number(Boolean(a.category || a.bio || a.about || a.skills?.length));
        const bProfileScore = Number(Boolean(b.category || b.bio || b.about || b.skills?.length));
        if (aProfileScore !== bProfileScore) return bProfileScore - aProfileScore;
        return Number(b.avgRating || 0) - Number(a.avgRating || 0);
      });

      setProviders(enriched);
      setIsLoading(false);
    };

    const unsubRole = onSnapshot(usersRoleQ, (snap) => {
      roleRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergeRows();
    }, () => setIsLoading(false));

    const unsubFlag = onSnapshot(usersFlagQ, (snap) => {
      flagRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergeRows();
    }, () => setIsLoading(false));

    const unsubProviders = onSnapshot(providersQ, (snap) => {
      providerRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergeRows();
    }, () => setIsLoading(false));

    const unsubProfiles = onSnapshot(profilesQ, (snap) => {
      profileRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergeRows();
    }, () => setIsLoading(false));

    return () => {
      unsubRole();
      unsubFlag();
      unsubProviders();
      unsubProfiles();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    let rows = providers.filter((p) => {
      const categoryMatch = selectedCategory === ALL || String(p.category || '').toLowerCase().includes(selectedCategory.toLowerCase());
      if (!categoryMatch) return false;
      if (!q) return true;
      const hay = `${p.name || ''} ${p.category || ''} ${p.location || ''} ${p.bio || ''}`.toLowerCase();
      return hay.includes(q);
    });

    if (viewMode === 'nearby' && myLocation) {
      // Only include providers that have coordinates.
      rows = rows.filter((p) => {
        const coords =
          getLocationCoords(p.location) ||
          (Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
            ? { latitude: Number(p.latitude), longitude: Number(p.longitude) }
            : null);
        if (!coords) return false;
        if (nearbyFilter === 'any') return true;
        const km = calculateDistance(myLocation.latitude, myLocation.longitude, coords.latitude, coords.longitude);
        return km <= Number(nearbyFilter);
      });

      // Sort closest first.
      rows.sort((a, b) => {
        const toCoords = (p) =>
          getLocationCoords(p.location) ||
          (Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
            ? { latitude: Number(p.latitude), longitude: Number(p.longitude) }
            : null);
        const aC = toCoords(a);
        const bC = toCoords(b);
        const aDist = aC ? calculateDistance(myLocation.latitude, myLocation.longitude, aC.latitude, aC.longitude) : Infinity;
        const bDist = bC ? calculateDistance(myLocation.latitude, myLocation.longitude, bC.latitude, bC.longitude) : Infinity;
        return aDist - bDist;
      });
    } else {
      rows.sort((a, b) => {
        if (sortBy === 'price') return Number(a.startingPrice || 0) - Number(b.startingPrice || 0);
        if (sortBy === 'experience') return Number(b.experience || 0) - Number(a.experience || 0);
        return Number(b.avgRating || 0) - Number(a.avgRating || 0);
      });
    }

    return rows;
  }, [providers, searchText, selectedCategory, sortBy, viewMode, nearbyFilter, myLocation]);

  const topStats = useMemo(() => {
    let premiumCount = 0;
    let avg = 0;
    let countWithRating = 0;

    providers.forEach((p) => {
      const plan = String(p.subscriptionPlan || '').toLowerCase();
      if (plan === 'pro' || plan === 'premium') premiumCount += 1;

      const rating = Number(p.avgRating || 0);
      if (rating > 0) {
        avg += rating;
        countWithRating += 1;
      }
    });

    return {
      total: providers.length,
      premium: premiumCount,
      avgRating: countWithRating > 0 ? (avg / countWithRating).toFixed(1) : 'New ⭐',
    };
  }, [providers]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 450);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.xl, marginHorizontal: 16, marginTop: 12, marginBottom: 12, ...AppShadow.lg }}>
        <Text style={{ color: '#93c5fd', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>CONNECTHUB</Text>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 4 }}>Browse Providers</Text>
        <Text style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 19, marginTop: 6 }}>Discover verified workers by skill, location, rating, and readiness to work.</Text>
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
          <StatBadge label="Total" value={topStats.total} bg="rgba(219,234,254,0.16)" color="#bfdbfe" />
          <StatBadge label="Pro" value={topStats.premium} bg="rgba(236,253,245,0.16)" color="#86efac" />
          <StatBadge label="Avg" value={topStats.avgRating} bg="rgba(254,249,195,0.16)" color="#fde68a" />
        </View>
      </View>

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, marginHorizontal: 16, ...AppShadow.card }}>
        <TextInput
          placeholder="Search providers by name, service, skill, or location"
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
                backgroundColor: active ? '#1d4ed8' : '#fff',
                borderWidth: 1,
                borderColor: active ? '#1d4ed8' : '#e2e8f0',
                marginRight: 8,
              }}
            >
              <Text style={{ color: active ? '#fff' : '#64748b', fontWeight: '700', fontSize: 12 }}>{cat}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingHorizontal: 16 }}>
        {['rating', 'price', 'experience'].map((key) => {
          const active = sortBy === key;
          const label = key === 'rating' ? 'Rating' : key === 'price' ? 'Price' : 'Experience';
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setSortBy(key)}
              style={{
                marginRight: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? '#1d4ed8' : '#cbd5e1',
                backgroundColor: active ? '#eff6ff' : '#fff',
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: active ? '#1d4ed8' : '#64748b', fontWeight: '800', fontSize: 12 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => setViewMode('list')}
          style={{
            flex: 1,
            marginRight: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: viewMode === 'list' ? '#1d4ed8' : '#cbd5e1',
            backgroundColor: viewMode === 'list' ? '#eff6ff' : '#fff',
            paddingVertical: 8,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: viewMode === 'list' ? '#1d4ed8' : '#64748b', fontWeight: '800', fontSize: 12 }}>\uD83D\uDCCB List</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setViewMode('nearby');
            if (!myLocation) {
              getCurrentLocation()
                .then((loc) => { if (loc) setMyLocation(loc); })
                .catch(() => {});
            }
          }}
          style={{
            flex: 1,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: viewMode === 'nearby' ? '#0891b2' : '#cbd5e1',
            backgroundColor: viewMode === 'nearby' ? '#e0f2fe' : '#fff',
            paddingVertical: 8,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: viewMode === 'nearby' ? '#0891b2' : '#64748b', fontWeight: '800', fontSize: 12 }}>\uD83D\uDCCD Nearby</Text>
        </TouchableOpacity>
      </View>

      {/* Distance filter chips — only visible in nearby mode */}
      {viewMode === 'nearby' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          {['5', '10', '20', 'any'].map((km) => {
            const active = nearbyFilter === km;
            const label = km === 'any' ? 'Any distance' : `Within ${km}km`;
            return (
              <TouchableOpacity
                key={km}
                onPress={() => setNearbyFilter(km)}
                style={{
                  marginRight: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? '#0891b2' : '#cbd5e1',
                  backgroundColor: active ? '#e0f2fe' : '#fff',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: active ? '#0891b2' : '#64748b', fontWeight: '800', fontSize: 12 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

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
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
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
            const providerBadge = getProviderBadge(item);
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
                      {item.kycVerified === true || String(item.kycStatus || '').toLowerCase() === 'verified' ? (
                        <View style={{ backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: '#166534', fontSize: 10, fontWeight: '800' }}>✓ VERIFIED</Text>
                        </View>
                      ) : null}
                      {String(item.subscriptionPlan || '').toLowerCase() === 'pro' ? (
                        <View style={{ backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: '#1d4ed8', fontSize: 10, fontWeight: '800' }}>PRO</Text>
                        </View>
                      ) : null}
                      {String(item.subscriptionPlan || '').toLowerCase() === 'premium' ? (
                        <View style={{ backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: '#92400e', fontSize: 10, fontWeight: '800' }}>PREMIUM</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <View style={{ alignSelf: 'flex-start', backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: '#1d4ed8', fontSize: 11, fontWeight: '700' }}>{item.category || 'General'}</Text>
                      </View>
                      {providerBadge ? (
                        <View style={{ alignSelf: 'flex-start', backgroundColor: providerBadge.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: providerBadge.color, fontSize: 11, fontWeight: '700' }}>{providerBadge.label}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>

                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: '#0f172a', fontWeight: '700' }}>{buildStars(item.avgRating)} ({Number(item.avgRating || 0).toFixed(1)}) — {reviews} reviews</Text>
                  <Text style={{ color: '#64748b', marginTop: 4 }}>📍 {item.location || 'Accra, Ghana'}</Text>
                  {myLocation ? (() => {
                    const providerCoords = getLocationCoords(item.location) || (
                      Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))
                        ? { latitude: Number(item.latitude), longitude: Number(item.longitude) }
                        : null
                    );
                    if (!providerCoords) return null;
                    return (
                    <Text style={{ color: '#1d4ed8', marginTop: 4, fontWeight: '700' }}>
                      📍 {formatDistance(calculateDistance(myLocation.latitude, myLocation.longitude, providerCoords.latitude, providerCoords.longitude))}
                    </Text>
                    );
                  })() : null}
                  <Text style={{ color: '#16a34a', marginTop: 4, fontWeight: '800' }}>From GHS {Number(item.startingPrice || 0).toFixed(2)}</Text>
                  {photoCount > 0 ? <Text style={{ color: '#94a3b8', marginTop: 4 }}>📷 {photoCount} photos</Text> : null}
                </View>

                <AppButton
                  label="View Profile →"
                  onPress={() => router.push({ pathname: '/provider-detail', params: { email: item.email } })}
                  style={{ marginTop: 10, backgroundColor: '#1d4ed8' }}
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

function StatBadge({ label, value, bg, color }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text style={{ color, fontWeight: '700', fontSize: 11 }}>{label}: {value}</Text>
    </View>
  );
}
