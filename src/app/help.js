import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import useAuthUser from '../hooks/use-auth-user';

const SUPPORT_EMAIL = 'bhounce1000@gmail.com';

const FAQS = [
  {
    q: 'How does escrow work?',
    a: 'When you pay for a job, your money is held safely by ConnectHub until you confirm the work is done. Only then is the provider paid. This protects both parties.',
  },
  {
    q: 'How do I get my money back if something goes wrong?',
    a: 'You can dispute a job within 24 hours of the provider marking it complete. Our admin team will review evidence from both sides and resolve fairly.',
  },
  {
    q: 'When do I get paid as a provider?',
    a: 'Payment is released to your ConnectHub wallet immediately after the customer confirms your work is done. You can then withdraw to Mobile Money anytime.',
  },
  {
    q: 'Is my payment information secure?',
    a: 'Yes. All payments are processed by Paystack, a trusted payment provider. ConnectHub never stores your card or Mobile Money details.',
  },
  {
    q: 'How does KYC verification work?',
    a: 'KYC (Know Your Customer) is our identity verification process. Submit your national ID and a selfie. Our team reviews within 24 hours. Verified users build more trust.',
  },
  {
    q: 'How do I cancel my subscription?',
    a: 'Go to Profile -> Subscription -> tap Cancel Subscription. You keep your benefits until the end of the billing period.',
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => setOpen((v) => !v)}
      activeOpacity={0.85}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontWeight: '700', color: AppColors.ink900, fontSize: 14, lineHeight: 20, paddingRight: 8 }}>
          {q}
        </Text>
        <Text style={{ fontSize: 18, color: '#64748b' }}>{open ? '−' : '+'}</Text>
      </View>
      {open && (
        <Text style={{ color: '#475569', fontSize: 13, lineHeight: 20, marginTop: 8 }}>
          {a}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function ContactOption({ icon, title, subtitle, onPress, color = '#0f172a' }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: AppRadius.md,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: color + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
      }}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: AppColors.ink900, fontSize: 14 }}>{title}</Text>
        <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: '#94a3b8', fontSize: 18 }}>→</Text>
    </TouchableOpacity>
  );
}

export default function HelpSupport() {
  const router = useRouter();
  const { user } = useAuthUser();
  const userEmail = user?.email || '';

  const openEmailSupport = (subject = 'Support Request') => {
    const body = `Hi ConnectHub Support,\n\nI need help with the following issue:\n\n[Describe your issue here]\n\n---\nAccount: ${userEmail}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (Platform.OS === 'web') {
      window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg, paddingBottom: 40 }}>

      {/* Header */}
      <View style={{ backgroundColor: '#0f172a', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
        <Text style={{ fontSize: 13, color: '#93c5fd', letterSpacing: 1, fontWeight: '700' }}>CONNECTHUB</Text>
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#f8fafc', marginTop: 4 }}>Help & Support</Text>
        <Text style={{ color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18 }}>
          We're here to help. Find answers below or contact us.
        </Text>
      </View>

      <AppCard style={{ marginBottom: 14 }}>
        <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 16, marginBottom: 6 }}>📧 Email Us</Text>
        <Text style={{ color: '#64748b', marginBottom: 12 }}>{SUPPORT_EMAIL}</Text>
        <AppButton label="Send Email" onPress={() => openEmailSupport('Support Request')} style={{ backgroundColor: '#2563eb' }} />
      </AppCard>

      <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 15, marginBottom: 10 }}>Contact Us</Text>
      <ContactOption icon="✉️" title="General Support" subtitle="Questions about your account or jobs" color="#2563eb" onPress={() => openEmailSupport('Support Request')} />
      <ContactOption icon="💳" title="Payment Issue" subtitle="Report payment errors or delays" color="#d97706" onPress={() => openEmailSupport('Payment Issue')} />
      <ContactOption icon="🛡️" title="Report a User" subtitle="Report misconduct or fraud" color="#7c3aed" onPress={() => openEmailSupport('User Report')} />

      <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: AppSpace.lg }} />

      {/* FAQ */}
      <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 15, marginBottom: 4 }}>
        Frequently Asked Questions
      </Text>
      <Text style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
        Tap a question to expand the answer.
      </Text>

      <AppCard style={{ padding: 0, paddingHorizontal: 16 }}>
        {FAQS.map((item, i) => (
          <FaqItem key={i} q={item.q} a={item.a} />
        ))}
      </AppCard>

      <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: AppSpace.lg }} />

      {/* Still need help CTA */}
      <View style={{ backgroundColor: '#eff6ff', borderRadius: AppRadius.lg, padding: AppSpace.lg, alignItems: 'center', marginBottom: AppSpace.lg }}>
        <Text style={{ fontSize: 24, marginBottom: 8 }}>💬</Text>
        <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 15, marginBottom: 4, textAlign: 'center' }}>
          Still have questions?
        </Text>
        <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 14 }}>
          Our team responds within 24 hours
        </Text>
        <AppButton
          label="Contact Support"
          onPress={() => openEmailSupport('Support Request')}
          style={{ backgroundColor: '#2563eb', width: '100%' }}
        />
      </View>

      <AppButton
        label="← Back"
        variant="neutral"
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}
