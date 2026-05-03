import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { collection, getDocs, query, where } from 'firebase/firestore';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';

export default function PublicPortfolio() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const providerParam = Array.isArray(searchParams?.provider) ? searchParams.provider[0] : searchParams?.provider;
  const providerEmail = String(providerParam || '').toLowerCase().trim();

  const [portfolioItems, setPortfolioItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [providerName, setProviderName] = useState('');

  useEffect(() => {
    if (!providerEmail) {
      router.back();
      return;
    }
    loadPortfolio();
  }, [providerEmail]);

  const loadPortfolio = async () => {
    setIsLoading(true);
    try {
      // Load portfolio items
      const snap = await getDocs(
        query(
          collection(db, 'portfolios', providerEmail, 'items'),
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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell title="Portfolio" showBackButton>
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, color: AppColors.ink700 }}>Loading portfolio...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: AppSpace.xl }}>
          {portfolioItems.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: AppSpace.xl }}>
              <Text style={{ fontSize: 48, marginBottom: 12 }}>📭</Text>
              <Text style={{ fontSize: 16, color: AppColors.ink700, fontWeight: '600', marginBottom: 4 }}>No portfolio items</Text>
              <Text style={{ fontSize: 14, color: AppColors.ink600, textAlign: 'center' }}>
                This provider hasn't added any portfolio pieces yet
              </Text>
            </View>
          ) : (
            <View style={{ gap: AppSpace.md }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: AppColors.ink900, marginBottom: AppSpace.md }}>
                Portfolio ({portfolioItems.length} items)
              </Text>

              {portfolioItems.map((item) => (
                <View key={item.id} style={{ borderRadius: AppRadius.lg, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' }}>
                  {item.imageUrl && (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={{ width: '100%', height: 200, backgroundColor: '#f0f0f0' }}
                    />
                  )}
                  <View style={{ padding: AppSpace.md }}>
                    <Text style={{ fontSize: 14, color: AppColors.ink900, lineHeight: 20, marginBottom: AppSpace.sm }}>
                      {item.description}
                    </Text>
                    <Text style={{ fontSize: 12, color: AppColors.ink600 }}>
                      {item.uploadedAt ? new Date(item.uploadedAt.seconds * 1000).toLocaleDateString() : 'Recently added'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </ScreenShell>
  );
}
