import { useEffect, useRef } from 'react'
import { Animated, Dimensions, StyleSheet, View } from 'react-native'

const MESSAGES = [
  '🎉 Post your first job FREE — No commission on your first booking!',
  '🔥 Top-rated providers available now in Accra, Kumasi, and Tema',
  '🌟 Verify your KYC and unlock unlimited job accepts',
  '🚀 New: Live GPS tracking — see your provider coming in real-time',
  '💸 Instant MoMo payouts — withdraw your earnings in minutes',
  '⭐ 5-star rated providers near you — browse and book now',
  '🛡️ Safe escrow payments — your money is protected until job is done',
]

export default function PromotionalTicker() {
  const screenWidth = Dimensions.get('window').width
  const fullText = MESSAGES.join('   •   ')
  const translateX = useRef(new Animated.Value(screenWidth)).current

  useEffect(() => {
    const animate = () => {
      translateX.setValue(screenWidth)
      Animated.timing(translateX, {
        toValue: -fullText.length * 7.5, // approx pixel width of text
        duration: fullText.length * 120,
        useNativeDriver: true,
      }).start(() => animate()) // loop forever
    }
    animate()
  }, [])

  return (
    <View style={styles.container}>
      <Animated.Text
        style={[styles.text, { transform: [{ translateX }] }]}
        numberOfLines={1}
      >
        {fullText}
      </Animated.Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e3a8a',
    paddingVertical: 8,
    overflow: 'hidden',
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    whiteSpace: 'nowrap',
  },
})
