import { ActivityIndicator, Text, View } from 'react-native';
import { Colors, Typography } from '../constants/design-tokens';

/**
 * Professional loading screen component
 * @param {object} props
 * @param {string} props.message - Loading message text (default: "Loading...")
 */
export default function LoadingScreen({ message = 'Loading...' }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.ink50,
      }}
      accessible={true}
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text
        style={{
          marginTop: 16,
          color: Colors.ink500,
          fontSize: Typography.base,
          fontWeight: Typography.medium,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
