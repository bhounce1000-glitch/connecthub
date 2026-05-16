import { Text, TouchableOpacity } from 'react-native';

import { AppColors, AppRadius, AppType } from '../../constants/design-tokens';

const VARIANT_COLORS = {
  primary: AppColors.blue700,
  neutral: AppColors.neutral900,
  success: AppColors.green600,
  danger: AppColors.rose700,
  warning: AppColors.amber600,
};

export default function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingLabel = null,
  style = null,
  textStyle = null,
}) {
  const baseColor = VARIANT_COLORS[variant] || VARIANT_COLORS.primary;
  const backgroundColor = disabled || loading
    ? '#cbd5e1'
    : baseColor;

  return (
    <TouchableOpacity
      onPress={!disabled && !loading && onPress ? onPress : undefined}
      disabled={disabled || loading}
      activeOpacity={disabled || loading ? 1 : 0.75}
      style={[
        {
          backgroundColor,
          minHeight: 48,
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: AppRadius.md,
          opacity: disabled || loading ? 0.6 : 1,
        },
        style,
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? 'This button is disabled' : undefined}
    >
      <Text style={[
        {
          color: '#ffffff',
          textAlign: 'center',
          fontWeight: '700',
          fontSize: AppType.body,
          letterSpacing: 0.2,
        },
        textStyle
      ]}>
        {loading ? (loadingLabel || 'Working...') : label}
      </Text>
    </TouchableOpacity>
  );
}