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
          borderColor: '#e2e8f0',
          padding: 16,
          boxShadow: '0px 2px 12px rgba(0,0,0,0.08)',
          elevation: 4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}