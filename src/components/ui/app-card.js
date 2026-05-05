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
          boxShadow: '0px 4px 10px rgba(15, 23, 42, 0.06)',
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}