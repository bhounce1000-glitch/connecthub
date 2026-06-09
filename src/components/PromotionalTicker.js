import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Platform, StyleSheet, Text, View } from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

const MESSAGES = [
  '🎉 Free promotion!! List your services FREE on ConnectHub featured section',
  '🔥 Top-rated providers in Accra, Kumasi and Tema — book now',
  '🌟 Explore local services near you — plumbers, cleaners, electricians and more',
  '🚀 Get trending on ConnectHub — complete your KYC and start earning today',
  '💸 Safe escrow payments — your money is protected until the job is done',
  '⭐ Verified providers near you — KYC-checked, rated and trusted',
  '🛡️ Live GPS tracking — see your provider coming in real-time like Uber',
];

const FULL_TEXT = MESSAGES.join('     •     ');
const CHAR_WIDTH = 8.2;
const FULL_WIDTH = FULL_TEXT.length * CHAR_WIDTH;

export default function PromotionalTicker() {
  const position = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const run = () => {
      position.setValue(SCREEN_WIDTH);
      Animated.timing(position, {
        toValue: -FULL_WIDTH,
        duration: FULL_TEXT.length * 100,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) run();
      });
    };
    run();
    return () => position.stopAnimation();
  }, [position]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.text} numberOfLines={1}>
          {MESSAGES[0]}{'     •     '}{MESSAGES[1]}{'     •     '}{MESSAGES[2]}
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
    height: 36,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  text: {
    color: '#facc15',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.3,
    paddingHorizontal: Platform.OS === 'web' ? 16 : 0,
  },
});
