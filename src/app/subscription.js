import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
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

const PLAN_THEME = {
  free: {
    cardBackground: '#f8fafc',
    cardBorder: '#cbd5e1',
    titleColor: '#334155',
    priceColor: '#475569',
    mutedColor: '#64748b',
    featureYes: '#166534',
    featureNo: '#991b1b',
    currentBackground: '#e2e8f0',
    currentText: '#334155',
  },
  pro: {
    cardBackground: '#eff6ff',
    cardBorder: '#60a5fa',
    titleColor: '#1d4ed8',
    priceColor: '#1d4ed8',
    mutedColor: '#475569',
    featureYes: '#1d4ed8',
    featureNo: '#b91c1c',
    currentBackground: '#dbeafe',
    currentText: '#1e3a8a',
  },
  premium: {
    cardBackground: '#fffbeb',
    cardBorder: '#f59e0b',
    titleColor: '#b45309',
    priceColor: '#b45309',
    mutedColor: '#78350f',
    featureYes: '#92400e',
    featureNo: '#b91c1c',
    currentBackground: '#fde68a',
    currentText: '#78350f',
  },
};

export default function Subscription() {
  const router = useRouter();
  const { status, plan } = useLocalSearchParams();
  const { user } = useAuthUser();

  const [profile, setProfile] = useState(null);
  const [pendingPlan, setPendingPlan] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [notice, setNotice] = useState(null);

  const currentEmail = String(user?.email || '').trim().toLowerCase();
  const isAuthenticated = currentEmail.length > 0;
  const resolvedStatus = Array.isArray(status) ? status[0] : status;
  const resolvedPlan = Array.isArray(plan) ? plan[0] : plan;

  const logSubscriptionEvent = useCallback(async ({ event, planKey, statusText = '', message = '', reference = '', sessionType = '' }) => {
    if (!currentEmail) return;
    try {
      await apiPost(
        `${API_BASE_URL}/subscription/client-event`,
        {
          event,
          plan: planKey,
          platform: Platform.OS,
          status: statusText,
          message,
          reference,
          sessionType,
        },
        { requireAuth: true }
      );
    } catch {
      // Diagnostics logging must never break checkout flow.
    }
  }, [currentEmail]);

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
      void logSubscriptionEvent({
        event: 'callback_status_seen',
        planKey: label,
        statusText: 'success',
      });
      Alert.alert('Subscription Activated', `🎉 Your ${label} plan is now active!`);
      setNotice({
        tone: 'success',
        title: 'Subscription activated',
        message: `Your ${label} plan is now active.`,
      });
      return;
    }

    if (resolvedStatus === 'failed') {
      void logSubscriptionEvent({
        event: 'callback_status_seen',
        planKey: String(resolvedPlan || '').trim().toLowerCase() || 'free',
        statusText: 'failed',
      });
      Alert.alert('Payment Failed', 'Payment failed. Please try again.');
      setNotice({
        tone: 'error',
        title: 'Payment failed',
        message: 'Payment failed. Please try again.',
      });
    }
  }, [logSubscriptionEvent, resolvedStatus, resolvedPlan]);

  const handleUpgrade = async (planKey) => {
    if (!currentEmail) {
      setNotice({ tone: 'warning', title: 'Sign in required', message: 'Please sign in again before managing subscriptions.' });
      return;
    }
    if (planKey === 'free') {
      setNotice({ tone: 'info', title: 'Already available', message: 'Basic plan is free and active by default.' });
      return;
    }

    setPendingPlan(planKey);
    setNotice(null);
    void logSubscriptionEvent({ event: 'checkout_start', planKey, statusText: 'started' });

    // Safety timeout: auto-reset pendingPlan after 60 seconds (in case state gets stuck on mobile)
    const timeoutId = setTimeout(() => {
      setPendingPlan('');
      Alert.alert('Checkout timeout', 'Payment session expired. Please try again.');
      void logSubscriptionEvent({
        event: 'checkout_timeout',
        planKey,
        statusText: 'timeout',
        message: 'Session timed out after 60 seconds',
      });
    }, 60000);

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
      const paymentReference = String(data?.reference || data?.data?.reference || '').trim();
      if (!response.ok || !data?.status || !authorizationUrl) {
        clearTimeout(timeoutId);
        throw new Error(data?.message || 'Could not start subscription checkout.');
      }

      void logSubscriptionEvent({
        event: 'checkout_initialized',
        planKey,
        statusText: 'initialized',
        reference: paymentReference,
      });

      if (Platform.OS === 'web') {
        clearTimeout(timeoutId);
        await Linking.openURL(authorizationUrl);
        setPendingPlan('');
        void logSubscriptionEvent({
          event: 'checkout_opened_web',
          planKey,
          statusText: 'opened',
          reference: paymentReference,
        });
      } else {
        const redirectUri = 'connecthub://subscription';
        const sessionResult = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
        clearTimeout(timeoutId);
        const sessionType = String(sessionResult?.type || '').trim().toLowerCase();

        if (sessionResult?.type === 'success' && sessionResult.url) {
          const callbackUrl = new URL(sessionResult.url);
          const callbackStatus = callbackUrl.searchParams.get('status') || '';
          const callbackPlan = callbackUrl.searchParams.get('plan') || '';
          void logSubscriptionEvent({
            event: 'checkout_callback',
            planKey,
            statusText: callbackStatus || 'success',
            reference: paymentReference,
            sessionType,
          });
          if (callbackStatus) {
            router.replace({
              pathname: '/subscription',
              params: {
                status: callbackStatus,
                plan: callbackPlan,
              },
            });
          }
        } else if (sessionResult?.type === 'dismiss' || sessionResult?.type === 'cancel') {
          setPendingPlan('');
          void logSubscriptionEvent({
            event: 'checkout_cancelled',
            planKey,
            statusText: 'cancelled',
            reference: paymentReference,
            sessionType,
          });
          setNotice({
            tone: 'info',
            title: 'Checkout cancelled',
            message: 'You cancelled the checkout. Try again when ready.',
          });
        } else {
          setPendingPlan('');
          void logSubscriptionEvent({
            event: 'checkout_session_ended',
            planKey,
            statusText: 'ended',
            reference: paymentReference,
            sessionType,
          });
          setNotice({
            tone: 'error',
            title: 'Checkout session ended',
            message: 'The payment session ended unexpectedly. Please try again.',
          });
        }
      }
    } catch (error) {
      clearTimeout(timeoutId);
      setPendingPlan('');
      void logSubscriptionEvent({
        event: 'checkout_failed',
        planKey,
        statusText: 'failed',
        message: String(error?.message || 'Could not start checkout.'),
      });
      Alert.alert('Checkout failed', error?.message || 'Could not start checkout.');
      setNotice({ tone: 'error', title: 'Checkout failed', message: error?.message || 'Could not start checkout.' });
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
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleDateString() : 'Recently activated';
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
        <Text style={{ fontWeight: '700', fontSize: 16 }}>Current Plan: {profile?.subscriptionBadge || 'Basic'}</Text>
        <Text style={{ color: '#64748b', marginTop: 4 }}>Status: {profile?.subscriptionStatus || 'free'}</Text>
        <Text style={{ color: '#64748b', marginTop: 2 }}>Expiry: {expiryLabel}</Text>
      </AppCard>

      {PLANS.map((plan) => {
        const active = currentPlan === plan.key;
        const actionDisabled = !isAuthenticated || active || pendingPlan.length > 0;
        const annual = plan.amount > 0 ? `GHS ${(plan.amount * 12).toFixed(0)}/yr` : 'Free forever';
        const theme = PLAN_THEME[plan.key] || PLAN_THEME.free;
        const cardStyle = { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder };
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
                  <View style={{ backgroundColor: theme.currentBackground, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 }}>
                    <Text style={{ color: theme.currentText, fontWeight: '800', fontSize: 11 }}>✅ CURRENT PLAN</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Text style={{ color: theme.titleColor, fontWeight: '800', fontSize: 20 }}>{plan.name}</Text>
              {plan.amount > 0 ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                    <Text style={{ color: theme.priceColor, fontWeight: '900', fontSize: 26 }}>GHS {plan.amount}</Text>
                    <Text style={{ color: theme.mutedColor, fontWeight: '600', fontSize: 13 }}>/mo</Text>
                  </View>
                  <Text style={{ color: theme.mutedColor, fontSize: 11, marginTop: 1 }}>{annual}</Text>
                </View>
              ) : (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: theme.priceColor, fontWeight: '900', fontSize: 22 }}>FREE</Text>
                  <Text style={{ color: theme.mutedColor, fontSize: 11, marginTop: 1 }}>{annual}</Text>
                </View>
              )}
            </View>
            <View style={{ marginTop: 8 }}>
              {plan.features.map((feature) => {
                const includesFeature = feature.includes('✅');
                return (
                  <Text key={feature} style={{ color: includesFeature ? theme.featureYes : theme.featureNo, marginBottom: 3, fontWeight: includesFeature ? '700' : '600' }}>
                    {feature}
                  </Text>
                );
              })}
            </View>
            <AppButton
              label={!isAuthenticated ? 'Sign in to manage plans' : active ? 'Current Plan' : plan.amount > 0 ? `Upgrade to ${plan.name}` : 'Downgrade to Free'}
              variant="primary"
              onPress={() => handleUpgrade(plan.key)}
              disabled={actionDisabled}
              loading={pendingPlan === plan.key}
              style={{
                marginTop: 12,
                backgroundColor: active
                  ? '#cbd5e1'
                  : plan.key === 'premium'
                    ? theme.priceColor
                    : plan.key === 'pro'
                      ? theme.priceColor
                      : '#64748b',
              }}
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
          disabled={!isAuthenticated || isCancelling || pendingPlan.length > 0}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <AppButton label="Back to Home" variant="neutral" onPress={() => router.replace('/home')} />
    </ScreenShell>
  );
}
