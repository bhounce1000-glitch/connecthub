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
    q: 'How do I post a job request?',
    a: 'Tap "Post a Request" on the Home screen, fill in the job details (title, category, location, budget), and submit. Nearby providers will see it and can accept.',
  },
  {
    q: 'Why can\'t I accept more jobs this month?',
    a: 'Free/Basic plan providers are limited to 5 job accepts per month. Upgrade to Pro (GHS 49/mo) or Premium (GHS 99/mo) for unlimited accepts.',
  },
  {
    q: 'My payment is stuck or failed — what do I do?',
    a: 'Payments are processed via Paystack. If a payment is stuck, wait 10 minutes and refresh. If the issue persists, tap "Contact Support" below and include your job ID and the amount.',
  },
  {
    q: 'How do I dispute a completed job?',
    a: 'On the job details screen, tap "Dispute" before marking it paid. Our admin team reviews disputes within 24 hours. You can also email support with the job details.',
  },
  {
    q: 'My account has been suspended — what can I do?',
    a: 'Account suspensions are issued for violations of our terms. Email support with your registered email address and we will review your case.',
  },
  {
    q: 'How do I verify my identity (KYC)?',
    a: 'Go to your profile and complete the KYC steps: personal details, ID upload, selfie, and agreement. Verification usually takes 1–2 business days.',
  },
  {
    q: 'How does the referral program work?',
    a: 'Go to Profile → Invite Friends to get your referral link. When a new user signs up and completes their first paid job using your link, you earn a bonus.',
  },
  {
    q: 'How do I cancel or modify a subscription?',
    a: 'Subscriptions auto-renew monthly. To cancel, email support before your next renewal date with your registered email. We\'ll cancel and confirm within 24 hours.',
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
          Find answers to common questions or reach out to our team directly.
        </Text>
      </View>

      {/* Contact options */}
      <Text style={{ fontWeight: '800', color: AppColors.ink900, fontSize: 15, marginBottom: 10 }}>
        Contact Us
      </Text>

      <ContactOption
        icon="✉️"
        title="Email Support"
        subtitle="We typically respond within 24 hours"
        color="#2563eb"
        onPress={() => openEmailSupport('Support Request')}
      />
      <ContactOption
        icon="💳"
        title="Payment Issue"
        subtitle="Report a payment problem or dispute"
        color="#d97706"
        onPress={() => openEmailSupport('Payment Issue')}
      />
      <ContactOption
        icon="🔒"
        title="Account Suspended"
        subtitle="Appeal a suspension or ban"
        color="#dc2626"
        onPress={() => openEmailSupport('Account Suspension Appeal')}
      />
      <ContactOption
        icon="🛡️"
        title="Report a User"
        subtitle="Report misconduct or fraud"
        color="#7c3aed"
        onPress={() => openEmailSupport('User Report')}
      />

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
          Still need help?
        </Text>
        <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 14 }}>
          Our support team is here to help. Send us an email and we'll get back to you as soon as possible.
        </Text>
        <AppButton
          label="📧  Send Email to Support"
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
