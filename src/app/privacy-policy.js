import { useRouter } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

const LAST_UPDATED = '2026-05-07';

function Section({ title, children }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 8 }}>{title}</Text>
      <Text style={{ fontSize: 14, color: '#475569', lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
          <Text style={{ color: '#2563eb', fontWeight: '800' }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ fontSize: 28, fontWeight: '900', color: '#0f172a', marginBottom: 6 }}>Privacy Policy</Text>
        <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Last updated: {LAST_UPDATED}</Text>

        <Section title="1. What data we collect">
          We collect your name, email address, phone number, profile details, service history, transaction records, device push token, and KYC identity documents where required for trust and payment compliance.
        </Section>

        <Section title="2. How we use your data">
          We use your information to create your account, verify identity, process wallet payments and withdrawals, match customers with providers, send job and payment notifications, and protect the platform from fraud and abuse.
        </Section>

        <Section title="3. Who we share it with">
          We share payment-related information with Paystack to process payments. We do not sell your personal data. We only disclose information to service providers or authorities when required for lawful operations, fraud prevention, or regulatory compliance.
        </Section>

        <Section title="4. How we protect your data">
          ConnectHub stores data on Firebase with access controls, server-side validation, and encrypted transport. Sensitive workflows such as KYC review, wallet actions, and admin actions are restricted and logged.
        </Section>

        <Section title="5. Your rights">
          You may request account deletion, data export, correction of inaccurate information, or support with privacy concerns. Some payment and compliance records may need to be retained for legal or audit reasons.
        </Section>

        <Section title="6. Notifications and communications">
          We may send email, in-app, and push notifications for account security, payments, withdrawals, subscription changes, and service updates. You can manage some notifications within the app settings when available.
        </Section>

        <Section title="7. Contact">
          For privacy questions, deletion requests, or data export requests, contact connecthub1000@gmail.com.
        </Section>
      </ScrollView>
    </View>
  );
}