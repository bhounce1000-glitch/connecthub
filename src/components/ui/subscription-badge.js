import { Text, View } from 'react-native';

function normalizeSubscriptionPlan(planValue) {
  const normalized = String(planValue || '').trim().toLowerCase();
  if (normalized === 'basic') return 'free';
  return normalized;
}

export default function SubscriptionBadge({ plan, style }) {
  const normalizedPlan = normalizeSubscriptionPlan(plan);

  if (normalizedPlan === 'pro') {
    return (
      <View
        style={[
          {
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: '#2563eb',
          },
          style,
        ]}
      >
        <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800' }}>PRO</Text>
      </View>
    );
  }

  if (normalizedPlan === 'premium') {
    return (
      <View
        style={[
          {
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: '#d97706',
          },
          style,
        ]}
      >
        <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800' }}>⭐ PREMIUM</Text>
      </View>
    );
  }

  return null;
}
