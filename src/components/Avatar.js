import { Text, View } from 'react-native';
import { Colors, getAvatarColor, Typography } from '../constants/design-tokens';

/**
 * Reusable avatar circle component with deterministic color
 * @param {object} props
 * @param {string} props.email - Email address for color determination
 * @param {number} props.size - Avatar circle size in pixels (default: 40)
 * @param {object} props.style - Additional styling
 */
export default function Avatar({ email, size = 40, style }) {
  const initial = (email || '?')[0].toUpperCase();
  const bg = getAvatarColor(email);
  
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      accessible={true}
      accessibilityLabel={`User avatar for ${email || 'unknown'}`}
    >
      <Text
        style={{
          color: Colors.white,
          fontWeight: Typography.bold,
          fontSize: size * 0.4,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
