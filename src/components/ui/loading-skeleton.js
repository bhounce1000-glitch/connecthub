import { View } from 'react-native';

import { AppRadius } from '../../constants/design-tokens';

export default function LoadingSkeleton({ height = 16, width = '100%', style = null }) {
  return (
    <View
      style={[
        {
          height,
          width,
          borderRadius: AppRadius.sm,
          backgroundColor: '#e2e8f0',
        },
        style,
      ]}
    />
  );
}