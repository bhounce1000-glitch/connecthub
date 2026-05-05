import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppNotice from '../components/ui/app-notice';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';

const PLANS = [
  { key: 'free', name: 'Basic', amount: 0, badge: '#64748b', badgeText: '', features: ['✅ 5 job accepts/month', '✅ Basic listing visibility', '❌ Priority placement'] },
  { key: 'pro', name: 'Pro', amount: 49, badge: '#2563eb', badgeText: 'POPULAR', features: ['✅ Unlimited job accepts', '✅ Pro badge', '❌ Premium placement'] },
  { key: 'premium', name: 'Premium', amount: 99, badge: '#d97706', badgeText: 'BEST VALUE', features: ['✅ Unlimited job accepts', '✅ Premium placement', '✅ Highest visibility'] },
];

export default function Subscription() {
  const router = useRouter();
  const { status, plan } = useLocalSearchParams();
  const { user } = useAuthUser();

  const [profile, setProfile] = useState(null);
  const [pendingPlan, setPendingPlan] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [notice, setNotice] = useState(null);

  const currentEmail = String(user?.email || '').trim().toLowerCase();
  const resolvedStatus = Array.isArray(status) ? status[0] : status;
  const resolvedPlan = Array.isArray(plan) ? plan[0] : plan;

  useEffect(() => {
    if (!currentEmail) {
      setProfile(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, 'users', currentEmail),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() || {}) : {});
      },
      () => {
        setProfile({});
      }
    );
  }, [currentEmail]);

  useEffect(() => {
    if (!resolvedStatus) return;

    if (resolvedStatus === 'success' && resolvedPlan) {
      const label = String(resolvedPlan).trim().toLowerCase();
      Alert.alert('Subscription Activated', `🎉 Your ${label} plan is now active!`);
      setNotice({
        tone: 'success',
        title: 'Subscription activated',
        message: `Your ${label} plan is now active.`,
      });
      return;
    }

    if (resolvedStatus === 'failed') {
      Alert.alert('Payment Failed', 'Payment failed. Please try again.');
      setNotice({
        tone: 'error',
        title: 'Payment failed',
        message: 'Payment failed. Please try again.',
      });
    }
  }, [resolvedStatus, resolvedPlan]);

  const handleUpgrade = async (planKey) => {
    if (!currentEmail) return;
    if (planKey === 'free') {
      setNotice({ tone: 'info', title: 'Already available', message: 'Basic plan is free and active by default.' });
      return;
    }

    setPendingPlan(planKey);
    setNotice(null);
    try {
      const authUser = auth.currentUser;
      const displayName = String(authUser?.displayName || user?.displayName || currentEmail.split('@')[0] || '').trim();
      const { response, data } = await apiPost(
        `${API_BASE_URL}/subscription/initiate`,
        {
          email: currentEmail,
          plan: planKey,
          displayName,
          platform: Platform.OS === 'web' ? 'web' : 'mobile',
        },
        { requireAuth: true }
      );

      const authorizationUrl = data?.authorization_url || data?.data?.authorization_url || '';
      if (!response.ok || !data?.status || !authorizationUrl) {
        throw new Error(data?.message || 'Could not start subscription checkout.');
      }

      if (Platform.OS === 'web') {
        await Linking.openURL(authorizationUrl);
      } else {
        const redirectUri = 'connecthub://subscription';
        const sessionResult = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
        if (sessionResult?.type === 'success' && sessionResult.url) {
          const callbackUrl = new URL(sessionResult.url);
          const callbackStatus = callbackUrl.searchParams.get('status') || '';
          const callbackPlan = callbackUrl.searchParams.get('plan') || '';
          if (callbackStatus) {
            router.replace({
              pathname: '/subscription',
              params: {
                status: callbackStatus,
                plan: callbackPlan,
              },
            });
          }
        }
      }
    } catch (error) {
      Alert.alert('Checkout failed', error?.message || 'Could not start checkout.');
      setNotice({ tone: 'error', title: 'Checkout failed', message: error?.message || 'Could not start checkout.' });
    } finally {
      setPendingPlan('');
    }
  };

  const handleCancelSubscription = async () => {
    if (!currentEmail) return;

    Alert.alert(
      'Cancel Subscription',
      'Are you sure you want to cancel?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            setNotice(null);
            try {
              const { response, data } = await apiPost(
                `${API_BASE_URL}/subscription/cancel`,
                { email: currentEmail },
                { requireAuth: true }
              );

              if (!response.ok || !data?.status) {
                throw new Error(data?.message || 'Could not cancel subscription.');
              }

              setNotice({
                tone: 'success',
                title: 'Subscription cancelled',
                message: 'Your subscription has been cancelled successfully.',
              });
            } catch (error) {
              Alert.alert('Cancellation failed', error?.message || 'Could not cancel subscription.');
              setNotice({
                tone: 'error',
                title: 'Cancellation failed',
                message: error?.message || 'Could not cancel subscription.',
              });
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  };

  const currentPlan = String(profile?.subscriptionPlan || 'free').toLowerCase();
  const expiry = profile?.subscriptionExpiry ? new Date(profile.subscriptionExpiry) : null;
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleDateString() : 'N/A';
  const canManageSubscription = ['pro', 'premium'].includes(currentPlan);

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
        const annual = plan.amount > 0 ? `GHS ${(plan.amount * 12).toFixed(0)}/yr` : 'Free forever';
        const cardStyle = plan.key === 'premium'
          ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }
          : plan.key === 'pro'
            ? { backgroundColor: '#eff6ff', borderColor: '#60a5fa' }
            : { backgroundColor: '#fff', borderColor: '#e2e8f0' };
        return (
          <AppCard key={plan.key} style={{ marginBottom: 12, borderWidth: 1, ...cardStyle }}>
            {(plan.badgeText || active) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                {plan.badgeText ? (
                  <View style={{ backgroundColor: plan.badge, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{plan.badgeText}</Text>
                  </View>
                ) : null}
                {active ? (
                  <View style={{ backgroundColor: '#dcfce7', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 }}>
                    <Text style={{ color: '#166534', fontWeight: '800', fontSize: 11 }}>✅ CURRENT PLAN</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 18 }}>{plan.name}</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${plan.badge}22` }}>
                <Text style={{ color: plan.badge, fontWeight: '800' }}>{plan.amount > 0 ? `GHS ${plan.amount}` : 'FREE'}</Text>
              </View>
            </View>
            <Text style={{ color: '#0f172a', marginTop: 6, fontWeight: '700' }}>{plan.amount > 0 ? '/month' : ''}</Text>
            <Text style={{ color: '#64748b', marginTop: 2, fontSize: 12 }}>{annual}</Text>
            <View style={{ marginTop: 8 }}>
              {plan.features.map((feature) => <Text key={feature} style={{ color: '#334155', marginBottom: 3 }}>{feature}</Text>)}
            </View>
            <AppButton
              label={active ? 'Current Plan' : plan.amount > 0 ? `Upgrade to ${plan.name}` : 'Current Plan'}
              variant={active ? 'neutral' : plan.key === 'premium' ? 'warning' : 'primary'}
              onPress={() => handleUpgrade(plan.key)}
              disabled={active || pendingPlan.length > 0}
              loading={pendingPlan === plan.key}
              style={{ marginTop: 12 }}
            />
          </AppCard>
        );
      })}

      {canManageSubscription ? (
        <AppButton
          label="Manage / Cancel Subscription"
          variant="danger"
          onPress={handleCancelSubscription}
          loading={isCancelling}
          disabled={isCancelling || pendingPlan.length > 0}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} />
    </ScreenShell>
  );
}
