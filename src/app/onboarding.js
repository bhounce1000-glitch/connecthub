import { useRef, useState } from 'react';
import { Dimensions, FlatList, Text, TouchableOpacity, View } from 'react-native';

import { useRouter } from 'expo-router';
import { AppRadius } from '../constants/design-tokens';

const { width: SCREEN_W } = Dimensions.get('window');
const SLIDE_WIDTH = Math.min(SCREEN_W, 480);

const SLIDES = [
  {
    id: '1',
    icon: '📋',
    iconBg: '#dbeafe',
    accent: '#1d4ed8',
    title: 'Post What You Need',
    body: 'Describe the job, set your budget, and publish in minutes. Providers in your area will see it straight away.',
  },
  {
    id: '2',
    icon: '🤝',
    iconBg: '#d1fae5',
    accent: '#059669',
    title: 'Get Matched With Providers',
    body: 'Browse verified service providers, compare profiles, ratings, and prices — then pick the best fit for your job.',
  },
  {
    id: '3',
    icon: '🔒',
    iconBg: '#ede9fe',
    accent: '#7c3aed',
    title: 'Pay Securely',
    body: 'Your payment is held safely until the job is done to your satisfaction. We only release funds when you confirm.',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const goToNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      const nextIndex = activeIndex + 1;
      listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setActiveIndex(nextIndex);
    } else {
      router.replace('/auth');
    }
  };

  const skip = () => router.replace('/auth');

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  });

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
      {/* Skip link */}
      {!isLast && (
        <TouchableOpacity
          onPress={skip}
          style={{ position: 'absolute', top: 52, right: 24, zIndex: 10, paddingVertical: 6, paddingHorizontal: 12 }}
        >
          <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 14 }}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Brand tag */}
      <View style={{ paddingTop: 52, paddingHorizontal: 28, paddingBottom: 0 }}>
        <Text style={{ color: '#6366f1', fontWeight: '800', fontSize: 13, letterSpacing: 1.5 }}>
          CONNECTHUB
        </Text>
      </View>

      {/* Slides */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        getItemLayout={(_, index) => ({ length: SLIDE_WIDTH, offset: SLIDE_WIDTH * index, index })}
        renderItem={({ item }) => (
          <View
            style={{
              width: SLIDE_WIDTH,
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 36,
              paddingBottom: 40,
            }}
          >
            {/* Illustrated icon */}
            <View
              style={{
                width: 140,
                height: 140,
                borderRadius: 70,
                backgroundColor: item.iconBg,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 36,
                shadowColor: item.accent,
                shadowOpacity: 0.25,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }}
            >
              <Text style={{ fontSize: 64 }}>{item.icon}</Text>
            </View>

            <Text
              style={{
                fontSize: 28,
                fontWeight: '800',
                color: '#f8fafc',
                textAlign: 'center',
                marginBottom: 16,
                lineHeight: 36,
              }}
            >
              {item.title}
            </Text>

            <Text
              style={{
                fontSize: 16,
                color: '#94a3b8',
                textAlign: 'center',
                lineHeight: 26,
              }}
            >
              {item.body}
            </Text>
          </View>
        )}
      />

      {/* Pagination dots */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 28 }}>
        {SLIDES.map((_, index) => (
          <View
            key={index}
            style={{
              width: activeIndex === index ? 24 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: activeIndex === index ? '#6366f1' : '#334155',
              marginHorizontal: 4,
            }}
          />
        ))}
      </View>

      {/* CTA buttons */}
      <View style={{ paddingHorizontal: 28, paddingBottom: 44, gap: 12 }}>
        <TouchableOpacity
          onPress={goToNext}
          style={{
            backgroundColor: '#6366f1',
            borderRadius: AppRadius.lg,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
            {isLast ? 'Get Started →' : 'Next'}
          </Text>
        </TouchableOpacity>

        {!isLast && (
          <TouchableOpacity
            onPress={skip}
            style={{
              borderRadius: AppRadius.lg,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#475569', fontWeight: '600', fontSize: 15 }}>
              Already have an account? Log in
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
