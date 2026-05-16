import { View } from 'react-native';
import { Colors, Radius, Shadow } from '../constants/design-tokens';

/**
 * Styled card container with multiple variants
 * @param {object} props
 * @param {React.ReactNode} props.children - Card content
 * @param {object} props.style - Additional styling
 * @param {string} props.variant - Card variant: 'default', 'elevated', 'colored', or 'danger'
 */
export default function Card({ children, style, variant = 'default' }) {
  const variants = {
    default: {
      backgroundColor: Colors.white,
      ...Shadow.sm,
    },
    elevated: {
      backgroundColor: Colors.white,
      ...Shadow.md,
    },
    colored: {
      backgroundColor: Colors.primarySurface,
      ...Shadow.sm,
    },
    danger: {
      backgroundColor: Colors.errorLight,
      ...Shadow.sm,
    },
  };
  
  return (
    <View
      style={[
        {
          borderRadius: Radius.lg,
          padding: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: Colors.ink200,
        },
        variants[variant],
        style,
      ]}
    >
      {children}
    </View>
  );
}
