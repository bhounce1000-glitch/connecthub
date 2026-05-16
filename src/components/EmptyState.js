import { Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/design-tokens';

/**
 * Beautiful empty state component for when there's no data
 * @param {object} props
 * @param {string} props.emoji - Emoji to display
 * @param {string} props.title - Empty state title
 * @param {string} props.subtitle - Empty state description
 * @param {object} props.cta - Call-to-action button { label, onPress }
 */
export default function EmptyState({ emoji, title, subtitle, cta }) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing['6xl'],
        paddingHorizontal: Spacing['4xl'],
      }}
      accessible={true}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <Text
        style={{ fontSize: 56, marginBottom: Spacing.lg }}
        accessible={false}
      >
        {emoji}
      </Text>
      <Text
        style={{
          fontSize: Typography.lg,
          fontWeight: Typography.bold,
          color: Colors.ink900,
          textAlign: 'center',
          marginBottom: Spacing.sm,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: Typography.base,
          color: Colors.ink500,
          textAlign: 'center',
          lineHeight: 22,
        }}
      >
        {subtitle}
      </Text>
      {cta && (
        <TouchableOpacity
          onPress={cta.onPress}
          activeOpacity={0.75}
          style={{
            marginTop: Spacing['2xl'],
            backgroundColor: Colors.primary,
            borderRadius: Radius.md,
            paddingVertical: 13,
            paddingHorizontal: Spacing['3xl'],
          }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
        >
          <Text
            style={{
              color: Colors.white,
              fontWeight: Typography.bold,
              fontSize: Typography.base,
            }}
          >
            {cta.label}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
