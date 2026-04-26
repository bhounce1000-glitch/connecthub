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
  style = null,
  textStyle = null,
}) {
  const backgroundColor = disabled || loading
    ? AppColors.disabled
    : (VARIANT_COLORS[variant] || VARIANT_COLORS.primary);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.86}
      style={[
        {
          backgroundColor,
          minHeight: 46,
          justifyContent: 'center',
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: AppRadius.md,
        },
        style,
      ]}
    >
      <Text style={[{ color: AppColors.white, textAlign: 'center', fontWeight: '700', fontSize: AppType.body, letterSpacing: 0.2 }, textStyle]}>
        {loading ? 'Working...' : label}
      </Text>
    </TouchableOpacity>
  );
}