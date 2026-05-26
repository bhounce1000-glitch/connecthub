import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Platform, StyleSheet, Text, View } from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

const MESSAGES = [
  '🎉 Post your first job FREE — no commission on your first booking',
  '🔥 Top-rated providers in Accra, Kumasi and Tema — book now',
  '🛡️ Safe escrow payments — your money is protected until job is done',
  '🚀 Live GPS tracking — see your provider coming in real-time',
  '💸 Instant MoMo payouts for providers — withdraw in minutes',
  '⭐ Verified providers near you — KYC-checked and rated',
];

const FULL_TEXT = MESSAGES.join('     •     ');
const CHAR_WIDTH = 8.2;
const FULL_WIDTH = FULL_TEXT.length * CHAR_WIDTH;

export default function PromotionalTicker() {
  const position = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    let running = true;
    const run = () => {
      if (!running) return;
      position.setValue(SCREEN_WIDTH);
      Animated.timing(position, {
        toValue: -FULL_WIDTH,
        duration: FULL_TEXT.length * 110,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && running) run();
      });
    };
    run();
    return () => {
      running = false;
      position.stopAnimation();
    };
  }, [position]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.staticText} numberOfLines={1}>
          {MESSAGES[0]}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Animated.Text
        style={[styles.text, { transform: [{ translateX: position }] }]}
        numberOfLines={1}
      >
        {FULL_TEXT}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 34,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  text: {
    color: '#facc15',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  staticText: {
    color: '#facc15',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingHorizontal: 16,
  },
});
