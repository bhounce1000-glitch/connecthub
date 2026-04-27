import { useRouter } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';
import { auth } from '../firebase';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const webBaseUrl = (process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://connecthub-1873e.web.app').replace(/\/+$/, '');

  const normalizedEmail = email.trim().toLowerCase();

  const handleResetPassword = async () => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      setNotice({
        tone: 'warning',
        title: 'Enter your email',
        message: 'Use the email address you registered with on ConnectHub.',
      });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      await sendPasswordResetEmail(auth, normalizedEmail, {
        url: `${webBaseUrl}/reset-password`,
        handleCodeInApp: true,
      });
      setNotice({
        tone: 'success',
        title: 'Password reset requested',
        message: 'If this email is registered, a reset link will arrive shortly. Check Inbox, Spam, and Promotions, then open it to set a new password.',
      });
    } catch (error) {
      const code = error?.code || '';
      let message = 'Could not start password reset right now. Please try again.';
      if (code === 'auth/too-many-requests') {
        message = 'Too many reset attempts. Please wait a few minutes and try again.';
      }
      setNotice({
        tone: 'error',
        title: 'Reset failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormScreen
      eyebrow="CONNECTHUB"
      title="Reset Password"
      subtitle="Enter only the email address you used to register. We will send you a password reset link."
      accentColor="#0f766e"
      accentTextColor="#99f6e4"
      backgroundColor="#ecfeff"
      cardStyle={{
        borderRadius: AppRadius.xxl,
        padding: AppSpace.xl,
        borderColor: '#ccfbf1',
        shadowColor: '#134e4a',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 6,
      }}
    >
      <Text style={{ fontSize: AppType.overline, color: '#0f766e', fontWeight: '700', marginBottom: AppSpace.xs, fontFamily: 'serif' }}>
        PASSWORD RESET
      </Text>

      <Text style={{ fontSize: AppType.title, marginBottom: AppSpace.xs, color: AppColors.ink900, fontWeight: '700' }}>
        Find Your Account
      </Text>

      <Text style={{ fontSize: AppType.body, color: '#475569', marginBottom: AppSpace.lg }}>
        Enter your account email below. You do not need your password on this page.
      </Text>

      <AppNotice
        tone={notice?.tone}
        title={notice?.title}
        message={notice?.message}
      />

      <AppInput
        label="Email"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!isSubmitting}
        inputStyle={{ backgroundColor: AppColors.slate50 }}
      />

      <AppButton
        label="Send Reset Link"
        onPress={handleResetPassword}
        disabled={!normalizedEmail}
        loading={isSubmitting}
        style={{ marginBottom: AppSpace.sm, borderRadius: 12, backgroundColor: '#0f766e' }}
      />

      <TouchableOpacity
        style={{ paddingVertical: AppSpace.sm }}
        onPress={() => router.back()}
        disabled={isSubmitting}
      >
        <Text style={{ textAlign: 'center', color: AppColors.blue700, fontWeight: '600' }}>
          Back to login
        </Text>
      </TouchableOpacity>
    </FormScreen>
  );
}