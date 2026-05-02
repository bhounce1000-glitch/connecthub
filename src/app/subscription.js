import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';

const PLANS = [
  { key: 'free', name: 'Basic', amount: 0, badge: '#64748b', perks: '5 job accepts per month' },
  { key: 'pro', name: 'Pro', amount: 49, badge: '#2563eb', perks: 'Unlimited job accepts + Pro badge' },
  { key: 'premium', name: 'Premium', amount: 99, badge: '#7c3aed', perks: 'Unlimited jobs + premium placement badge' },
];

export default function Subscription() {
  const router = useRouter();
  const { reference } = useLocalSearchParams();
  const { user } = useAuthUser();

  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPlan, setPendingPlan] = useState('');
  const [notice, setNotice] = useState(null);
  const [verifiedReference, setVerifiedReference] = useState('');

  const currentEmail = String(user?.email || '').trim().toLowerCase();
  const resolvedReference = Array.isArray(reference) ? reference[0] : reference;

  const loadProfile = async () => {
    if (!currentEmail) return;
    setIsLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', currentEmail));
      setProfile(snap.exists() ? (snap.data() || {}) : {});
    } catch {
      setProfile({});
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmail]);

  useEffect(() => {
    if (!resolvedReference || !currentEmail || verifiedReference === resolvedReference) return;

    const verify = async () => {
      try {
        const { response, data } = await apiPost(
          `${API_BASE_URL}/subscription/verify`,
          { reference: resolvedReference },
          { requireAuth: true }
        );

        if (!response.ok || !data?.status) {
          throw new Error(data?.message || 'Could not verify subscription payment.');
        }

        setVerifiedReference(resolvedReference);
        setNotice({
          tone: 'success',
          title: 'Subscription activated',
          message: 'Your plan has been updated successfully.',
        });
        await loadProfile();
      } catch (error) {
        setNotice({ tone: 'warning', title: 'Verification pending', message: error?.message || 'Payment verification is still pending.' });
      }
    };

    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedReference, currentEmail, verifiedReference]);

  const startPlanCheckout = async (planKey) => {
    if (!currentEmail) return;
    if (planKey === 'free') {
      setNotice({ tone: 'info', title: 'Already available', message: 'Basic plan is free and active by default.' });
      return;
    }

    setPendingPlan(planKey);
    setNotice(null);
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/subscription/initiate`,
        { plan: planKey },
        { requireAuth: true }
      );

      if (!response.ok || !data?.status || !data?.data?.authorization_url) {
        throw new Error(data?.message || 'Could not start subscription checkout.');
      }

      const checkoutUrl = data.data.authorization_url;
      if (Platform.OS === 'web') {
        window.location.href = checkoutUrl;
      } else {
        await Linking.openURL(checkoutUrl);
      }
    } catch (error) {
      setNotice({ tone: 'error', title: 'Checkout failed', message: error?.message || 'Could not start checkout.' });
    } finally {
      setPendingPlan('');
    }
  };

  const currentPlan = String(profile?.subscriptionPlan || 'free').toLowerCase();
  const expiry = profile?.subscriptionExpiry ? new Date(profile.subscriptionExpiry) : null;
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleDateString() : 'N/A';

  return (
    <ScreenShell
      eyebrow="MONETIZATION"
      title="Subscription"
      subtitle="Upgrade your provider plan for unlimited monthly job accepts."
      accentColor="#0f172a"
      accentTextColor="#cbd5e1"
      scroll
    >
      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 12 }} />

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '800', fontSize: 16 }}>Current Plan: {profile?.subscriptionBadge || 'Basic'}</Text>
        <Text style={{ color: '#64748b', marginTop: 4 }}>Status: {profile?.subscriptionStatus || 'free'}</Text>
        <Text style={{ color: '#64748b', marginTop: 2 }}>Expiry: {expiryLabel}</Text>
      </AppCard>

      {PLANS.map((plan) => {
        const active = currentPlan === plan.key;
        return (
          <AppCard key={plan.key} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 18 }}>{plan.name}</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${plan.badge}22` }}>
                <Text style={{ color: plan.badge, fontWeight: '800' }}>{plan.amount > 0 ? `GHS ${plan.amount}/mo` : 'FREE'}</Text>
              </View>
            </View>
            <Text style={{ color: '#475569', marginTop: 8 }}>{plan.perks}</Text>
            <AppButton
              label={active ? 'Current Plan' : plan.amount > 0 ? `Choose ${plan.name}` : 'Use Basic'}
              variant={active ? 'neutral' : 'primary'}
              onPress={() => startPlanCheckout(plan.key)}
              disabled={active || pendingPlan.length > 0}
              loading={pendingPlan === plan.key}
              style={{ marginTop: 12 }}
            />
          </AppCard>
        );
      })}

      <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} />
    </ScreenShell>
  );
}
