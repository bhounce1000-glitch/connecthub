import { Text, TouchableOpacity, View } from 'react-native';

import { AppColors } from '../../constants/design-tokens';
import AppCard from './app-card';

export default function EmptyState({ title, description, icon = '📭', actionLabel = null, onAction = null, style = null }) {
  return (
    <AppCard style={[{ alignItems: 'center' }, style]}>
      <Text style={{ fontSize: 42, marginBottom: 8 }}>{icon}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: AppColors.ink900, marginBottom: 6, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ color: AppColors.ink500, textAlign: 'center' }}>
        {description}
      </Text>
      {actionLabel && onAction ? (
        <View style={{ width: '100%', marginTop: 14 }}>
          <TouchableOpacity
            onPress={onAction}
            activeOpacity={0.86}
            style={{
              backgroundColor: AppColors.primary,
              minHeight: 48,
              borderRadius: 10,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{actionLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </AppCard>
  );
}