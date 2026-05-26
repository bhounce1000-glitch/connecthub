import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BANNER_HEIGHT = 196;

const BANNERS = [
  {
    id: '1',
    emoji: 'ðŸ› ï¸',
    title: 'Find Skilled Providers',
    subtitle: 'Plumbers, electricians, cleaners â€” near you in Ghana',
    cta: 'Browse Providers',
    route: '/providers',
    bg: '#1e3a8a',
    ctaBg: '#facc15',
    ctaText: '#1e3a8a',
    subColor: '#bfdbfe',
  },
  {
    id: '2',
    emoji: 'ðŸ“‹',
    title: 'Post a Job in 60 Seconds',
    subtitle: 'Tell us what you need â€” providers come to you',
    cta: 'Post a Job Now',
    route: '/request-wizard',
    bg: '#064e3b',
    ctaBg: '#6ee7b7',
    ctaText: '#064e3b',
    subColor: '#a7f3d0',
  },
  {
    id: '3',
    emoji: 'ðŸ’°',
    title: 'Safe Escrow Payments',
    subtitle: 'Pay only after the job is done to your satisfaction',
    cta: 'Learn How It Works',
    route: '/help',
    bg: '#7c2d12',
    ctaBg: '#fed7aa',
    ctaText: '#7c2d12',
    subColor: '#fdba74',
  },
  {
    id: '4',
    emoji: 'ðŸ“¡',
    title: 'Live GPS Tracking',
    subtitle: 'Track your provider in real-time â€” just like Uber',
    cta: 'See Features',
    route: '/help',
    bg: '#3b0764',
    ctaBg: '#e9d5ff',
    ctaText: '#3b0764',
    subColor: '#c4b5fd',
  },
  {
    id: '5',
    emoji: 'â­',
    title: 'Earn as a Provider',
    subtitle: 'Set up your profile and start earning today in Ghana',
    cta: 'Become a Provider',
    route: '/provider-setup',
    bg: '#78350f',
    ctaBg: '#fde68a',
    ctaText: '#78350f',
    subColor: '#fcd34d',
  },
];

export default function HeroBanner() {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef(null);
  const autoTimer = useRef(null);

  const scrollTo = (index) => {
    try {
      scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    } catch (_) {}
    setActiveIndex(index);
  };

  useEffect(() => {
    autoTimer.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % BANNERS.length;
        try {
          scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
        } catch (_) {}
        return next;
      });
    }, 4500);
    return () => clearInterval(autoTimer.current);
  }, []);

  const handleScrollEnd = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (index >= 0 && index < BANNERS.length) setActiveIndex(index);
  };

  return (
    <View style={{ backgroundColor: '#f8fafc' }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={32}
        style={{ height: BANNER_HEIGHT }}
      >
        {BANNERS.map((b) => (
          <View
            key={b.id}
            style={[styles.slide, { width: SCREEN_WIDTH, backgroundColor: b.bg }]}
          >
            <View style={styles.slideInner}>
              <Text style={styles.slideEmoji}>{b.emoji}</Text>
              <Text style={styles.slideTitle}>{b.title}</Text>
              <Text style={[styles.slideSubtitle, { color: b.subColor }]}>{b.subtitle}</Text>
              <TouchableOpacity
                style={[styles.slideCta, { backgroundColor: b.ctaBg }]}
                onPress={() => router.push(b.route)}
                activeOpacity={0.85}
              >
                <Text style={[styles.slideCtaText, { color: b.ctaText }]}>{b.cta} â†’</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Dot indicators â€” BELOW the slides, not overlapping */}
      <View style={styles.dotsRow}>
        {BANNERS.map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => scrollTo(i)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          >
            <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    justifyContent: 'center',
  },
  slideInner: {
    paddingHorizontal: 22,
    paddingVertical: 20,
    gap: 6,
  },
  slideEmoji: {
    fontSize: 30,
    marginBottom: 2,
  },
  slideTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  slideSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  slideCta: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  slideCtaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
    backgroundColor: '#f8fafc',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
  },
  dotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1d4ed8',
  },
});
