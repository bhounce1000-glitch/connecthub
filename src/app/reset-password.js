import { useLocalSearchParams, useRouter } from 'expo-router';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';
import { auth } from '../firebase';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseParamFromUrl(rawUrl, key) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '';
  }

  const candidates = [rawUrl];
  try {
    candidates.push(decodeURIComponent(rawUrl));
  } catch (_) {
    // Ignore decode failures for already-decoded input.
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const value = url.searchParams.get(key);
      if (value) {
        return value;
      }
    } catch (_) {
      // Ignore parse failures and try regex fallback below.
    }

    const match = candidate.match(new RegExp(`(?:[?&#]|^)${key}=([^&#]+)`));
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch (_) {
        return match[1];
      }
    }
  }

  return '';
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCodeValid, setIsCodeValid] = useState(false);
  const [notice, setNotice] = useState(null);
  const [hashSearch, setHashSearch] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const rawHash = window.location.hash || '';
    const hashWithoutPrefix = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    setHashSearch(hashWithoutPrefix);
  }, []);

  const mode = useMemo(() => {
    const direct = firstParam(params.mode);
    if (direct) {
      return direct;
    }

    const nestedRaw = [
      firstParam(params.link),
      firstParam(params.continueUrl),
      firstParam(params.url),
      firstParam(params.deep_link_id),
      hashSearch,
    ].find(Boolean);

    return parseParamFromUrl(nestedRaw, 'mode');
  }, [hashSearch, params.continueUrl, params.deep_link_id, params.link, params.mode, params.url]);

  const oobCode = useMemo(() => {
    const direct = firstParam(params.oobCode);
    if (direct) {
      return direct;
    }

    const nestedRaw = [
      firstParam(params.link),
      firstParam(params.continueUrl),
      firstParam(params.url),
      firstParam(params.deep_link_id),
      hashSearch,
    ].find(Boolean);

    return parseParamFromUrl(nestedRaw, 'oobCode');
  }, [hashSearch, params.continueUrl, params.deep_link_id, params.link, params.oobCode, params.url]);

  const passwordError = useMemo(() => {
    if (!newPassword) {
      return '';
    }
    if (newPassword.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (!/[A-Z]/.test(newPassword)) {
      return 'Password must contain at least one uppercase letter.';
    }
    if (!/[0-9]/.test(newPassword)) {
      return 'Password must contain at least one number.';
    }
    return '';
  }, [newPassword]);

  const confirmError = useMemo(() => {
    if (!confirmPassword) {
      return '';
    }
    if (confirmPassword !== newPassword) {
      return 'Passwords do not match.';
    }
    return '';
  }, [confirmPassword, newPassword]);

  useEffect(() => {
    let cancelled = false;

    const validateCode = async () => {
      if (mode !== 'resetPassword' || !oobCode) {
        setNotice({
          tone: 'error',
          title: 'Invalid reset link',
          message: 'This reset link is incomplete or expired. Request a new one from Forgot Password.',
        });
        setIsCodeValid(false);
        return;
      }

      try {
        await verifyPasswordResetCode(auth, oobCode);
        if (!cancelled) {
          setIsCodeValid(true);
          setNotice(null);
        }
      } catch (_) {
        if (!cancelled) {
          setIsCodeValid(false);
          setNotice({
            tone: 'error',
            title: 'Reset link expired',
            message: 'This reset link is no longer valid. Request a new password reset email.',
          });
        }
      }
    };

    validateCode();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const handleSubmit = async () => {
    if (!isCodeValid || !oobCode) {
      setNotice({
        tone: 'error',
        title: 'Invalid reset link',
        message: 'Request a new password reset link and try again.',
      });
      return;
    }

    if (passwordError) {
      setNotice({
        tone: 'warning',
        title: 'Weak password',
        message: passwordError,
      });
      return;
    }

    if (confirmError) {
      setNotice({
        tone: 'warning',
        title: 'Password mismatch',
        message: confirmError,
      });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setNotice({
        tone: 'success',
        title: 'Password updated',
        message: 'Your password has been changed successfully. You can now log in.',
      });
      setNewPassword('');
      setConfirmPassword('');
    } catch (_) {
      setNotice({
        tone: 'error',
        title: 'Could not reset password',
        message: 'This reset link may be expired. Request a new one and try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormScreen
      eyebrow="CONNECTHUB"
      title="Set New Password"
      subtitle="Use a strong password with at least 8 characters, one uppercase letter, and one number."
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
        RESET LINK
      </Text>

      <Text style={{ fontSize: AppType.title, marginBottom: AppSpace.xs, color: AppColors.ink900, fontWeight: '700' }}>
        Choose New Password
      </Text>

      <Text style={{ fontSize: AppType.body, color: '#475569', marginBottom: AppSpace.lg }}>
        Enter your new password below to complete the reset.
      </Text>

      <AppNotice
        tone={notice?.tone}
        title={notice?.title}
        message={notice?.message}
      />

      <AppInput
        label="New Password"
        placeholder="New Password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        editable={!isSubmitting && isCodeValid}
        error={passwordError}
        inputStyle={{ backgroundColor: AppColors.slate50 }}
      />

      <AppInput
        label="Confirm New Password"
        placeholder="Confirm New Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!isSubmitting && isCodeValid}
        error={confirmError}
        inputStyle={{ backgroundColor: AppColors.slate50 }}
      />

      <AppButton
        label="Update Password"
        onPress={handleSubmit}
        disabled={!isCodeValid || !newPassword || !confirmPassword || Boolean(passwordError) || Boolean(confirmError)}
        loading={isSubmitting}
        style={{ marginBottom: AppSpace.sm, borderRadius: 12, backgroundColor: '#0f766e' }}
      />

      <TouchableOpacity
        style={{ paddingVertical: AppSpace.xs }}
        onPress={() => router.replace('/forgot-password')}
        disabled={isSubmitting}
      >
        <Text style={{ textAlign: 'center', color: '#0f766e', fontWeight: '600' }}>
          Request a new reset link
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{ paddingVertical: AppSpace.sm }}
        onPress={() => router.replace('/auth')}
        disabled={isSubmitting}
      >
        <Text style={{ textAlign: 'center', color: AppColors.blue700, fontWeight: '600' }}>
          Back to login
        </Text>
      </TouchableOpacity>
    </FormScreen>
  );
}
