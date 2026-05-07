import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export default function SkeletonCard({ height = 100 }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        height,
        borderRadius: 12,
        backgroundColor: '#e2e8f0',
        marginBottom: 12,
        opacity,
      }}
    />
  );
}