import { useRouter } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { AppColors, AppSpace, AppType } from '../constants/design-tokens';

const sections = [
  {
    title: '1. Acceptance of Terms',
    body: 'By accessing or using ConnectHub, you agree to these Terms of Service. If you do not agree, do not use the platform.',
  },
  {
    title: '2. Description of Service',
    body: 'ConnectHub is a Ghana-based digital marketplace where customers request services and providers offer professional services. We facilitate matching, communication, and escrow-backed payments.',
  },
  {
    title: '3. User Responsibilities',
    body: 'Users must provide accurate information, complete required KYC verification, keep account credentials secure, and avoid illegal or abusive conduct.',
  },
  {
    title: '4. Provider Responsibilities',
    body: 'Providers must deliver services as agreed, communicate professionally, maintain quality standards, and respect platform dispute outcomes.',
  },
  {
    title: '5. Payment and Escrow Terms',
    body: 'Customer payments are held in escrow until service completion or dispute resolution. ConnectHub applies a 10% commission on provider payouts. Refunds and disputes are handled according to platform policy and admin review.',
  },
  {
    title: '6. Prohibited Activities',
    body: 'Fake accounts, fraud, scams, identity misuse, money laundering, abuse of payment systems, and any unlawful activity are strictly prohibited.',
  },
  {
    title: '7. Account Termination',
    body: 'ConnectHub may suspend or terminate accounts that violate these terms, abuse other users, or pose security or fraud risk.',
  },
  {
    title: '8. Limitation of Liability',
    body: 'ConnectHub provides a marketplace platform and does not guarantee outcomes of third-party services. Liability is limited to the maximum extent permitted by applicable law.',
  },
  {
    title: '9. Governing Law',
    body: 'These terms are governed by the laws of the Republic of Ghana.',
  },
  {
    title: '10. Contact Information',
    body: 'For legal, support, or compliance questions, contact ConnectHub support through the in-app Help section or your official support channels.',
  },
];

export default function Terms() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ padding: AppSpace.lg, paddingBottom: 40 }}>
        <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>
          Terms of Service
        </Text>
        <Text style={{ color: AppColors.ink500, marginBottom: AppSpace.lg }}>
          Effective Date: May 7, 2026
        </Text>

        {sections.map((item) => (
          <View key={item.title} style={{ marginBottom: AppSpace.lg }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: AppColors.ink900, marginBottom: 6 }}>
              {item.title}
            </Text>
            <Text style={{ color: AppColors.ink700, lineHeight: 22 }}>
              {item.body}
            </Text>
          </View>
        ))}

        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#cbd5e1',
            backgroundColor: '#ffffff',
          }}
        >
          <Text style={{ color: '#1d4ed8', fontWeight: '700' }}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
