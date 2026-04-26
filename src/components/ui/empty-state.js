import { Text } from 'react-native';

import { AppColors } from '../../constants/design-tokens';
import AppCard from './app-card';

export default function EmptyState({ title, description, style = null }) {
  return (
    <AppCard style={style}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: AppColors.ink900, marginBottom: 6 }}>
        {title}
      </Text>
      <Text style={{ color: AppColors.ink500 }}>
        {description}
      </Text>
    </AppCard>
  );
}