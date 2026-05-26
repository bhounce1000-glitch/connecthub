import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
    Dimensions, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    View
} from 'react-native'

const { width } = Dimensions.get('window')

const BANNERS = [
  {
    id: '1',
    emoji: '🛠️',
    title: 'Find Skilled Providers',
    subtitle: 'Plumbers, electricians, cleaners and more — near you',
    cta: 'Browse Providers',
    route: '/providers',
    gradient: ['#1e3a8a', '#1d4ed8'],
    accent: '#bfdbfe',
  },
  {
    id: '2',
    emoji: '📋',
    title: 'Post a Job in 60 Seconds',
    subtitle: 'Tell us what you need — providers will come to you',
    cta: 'Post a Job',
    route: '/request-wizard',
    gradient: ['#065f46', '#059669'],
    accent: '#a7f3d0',
  },
  {
    id: '3',
    emoji: '💰',
    title: 'Safe Escrow Payments',
    subtitle: 'Pay only when the job is done to your satisfaction',
    cta: 'How It Works',
    route: '/help',
    gradient: ['#7c2d12', '#ea580c'],
    accent: '#fed7aa',
  },
  {
    id: '4',
    emoji: '📡',
    title: 'Live GPS Tracking',
    subtitle: 'Track your provider in real-time — just like Uber',
    cta: 'Learn More',
    route: '/help',
    gradient: ['#4c1d95', '#7c3aed'],
    accent: '#ddd6fe',
  },
  {
    id: '5',
    emoji: '⭐',
    title: 'Become a Top Provider',
    subtitle: 'Earn GHS 10,000+ monthly serving clients near you',
    cta: 'Set Up Profile',
    route: '/provider-setup',
    gradient: ['#713f12', '#d97706'],
    accent: '#fde68a',
  },
]

export default function HeroBanner() {
  const router = useRouter()
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef(null)
  const timerRef = useRef(null)

  const goToSlide = (index) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ x: index * width, animated: true })
    }
    setActiveIndex(index)
  }

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setActiveIndex(prev => {
        const next = (prev + 1) % BANNERS.length
        goToSlide(next)
        return next
      })
    }, 4000)
    return () => clearInterval(timerRef.current)
  }, [])

  const handleScroll = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width)
    setActiveIndex(index)
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
      >
        {BANNERS.map((banner) => (
          <View
            key={banner.id}
            style={[styles.slide, { backgroundColor: banner.gradient[1], width }]}
          >
            <Text style={styles.emoji}>{banner.emoji}</Text>
            <Text style={styles.title}>{banner.title}</Text>
            <Text style={[styles.subtitle, { color: banner.accent }]}>{banner.subtitle}</Text>
            <TouchableOpacity
              style={[styles.ctaButton, { backgroundColor: banner.accent }]}
              onPress={() => router.push(banner.route)}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaText, { color: banner.gradient[1] }]}>{banner.cta} →</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Dot indicators */}
      <View style={styles.dots}>
        {BANNERS.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goToSlide(i)} activeOpacity={0.8}>
            <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    height: 200,
    backgroundColor: '#1d4ed8',
  },
  slide: {
    height: 200,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 6,
  },
  emoji: { fontSize: 32 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  ctaButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#ffffff',
    width: 18,
  },
})
