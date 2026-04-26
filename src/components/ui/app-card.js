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
          borderColor: '#dbe4ef',
          padding: 16,
          shadowColor: '#0f172a',
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}