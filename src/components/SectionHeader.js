import { Text, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/design-tokens';

/**
 * Styled section header with optional count and action
 * @param {object} props
 * @param {string} props.title - Section title
 * @param {number} props.count - Optional count badge
 * @param {string} props.icon - Optional emoji icon
 * @param {React.ReactNode} props.action - Optional action element (e.g., button)
 */
export default function SectionHeader({ title, count, icon, action }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: Colors.ink100,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon && (
          <Text
            style={{ fontSize: 16 }}
            accessible={true}
            accessibilityLabel={icon}
          >
            {icon}
          </Text>
        )}
        <Text
          style={{
            fontSize: Typography.md,
            fontWeight: Typography.bold,
            color: Colors.ink900,
          }}
        >
          {title}
        </Text>
        {count !== undefined && (
          <View
            style={{
              backgroundColor: Colors.primary + '18',
              borderRadius: Radius.full,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text
              style={{
                color: Colors.primary,
                fontSize: Typography.xs,
                fontWeight: Typography.bold,
              }}
              accessible={true}
              accessibilityLabel={`${count} items`}
            >
              {count}
            </Text>
          </View>
        )}
      </View>
      {action}
    </View>
  );
}
