import { View } from 'react-native';

import { AppColors, AppRadius } from '../../constants/design-tokens';

export default function AppCard({ children, style = null }) {
  return (
    <View
      style={[
        {
          backgroundColor: AppColors.white,
          borderRadius: AppRadius.lg,
          borderWidth: 1,
          borderColor: AppColors.slate200,
          padding: 16,
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.07,
          shadowRadius: 14,
          boxShadow: '0px 8px 24px rgba(15,23,42,0.08)',
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
