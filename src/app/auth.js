import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function Auth() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const normalizedEmail = email.trim().toLowerCase();

  const validateForm = () => {
    const nextErrors = {};

    if (!normalizedEmail || !password) {
      if (!normalizedEmail) {
        nextErrors.email = 'Please provide your email address.';
      }

      if (!password) {
        nextErrors.password = 'Please provide your password.';
      }
    }

    if (!normalizedEmail.includes('@')) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (password.length < 6) {
      nextErrors.password = 'Password must be at least 6 characters.';
    }

    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setNotice({
        tone: 'error',
        title: 'Check your details',
        message: 'Fix the highlighted fields and try again.',
      });
      return false;
    }

    setNotice(null);
    return true;
  };

  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
      router.replace('/home');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Login failed',
        message: error.message || 'Unable to log in with those credentials.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      // Seed a user document so profile data is immediately available
      await setDoc(
        doc(db, 'users', normalizedEmail),
        {
          email: normalizedEmail,
          createdAt: new Date(),
        },
        { merge: true }
      );

      router.replace('/home');
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Signup failed',
        message: error.message || 'Unable to create your account right now.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormScreen
      eyebrow="CONNECTHUB"
      title={isLogin ? 'Welcome Back' : 'Create Account'}
      subtitle={isLogin
        ? 'Log in to manage requests, payments, and ratings.'
        : 'Join now and start offering or requesting services.'}
      accentColor="#4338ca"
      accentTextColor="#c7d2fe"
      backgroundColor="#eef2ff"
      cardStyle={{
        borderRadius: AppRadius.xxl,
        padding: AppSpace.xl,
        borderColor: '#dbeafe',
        shadowColor: '#1e3a8a',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 6,
      }}
    >
        <Text style={{ fontSize: AppType.overline, color: '#4338ca', fontWeight: '700', marginBottom: AppSpace.xs, fontFamily: 'serif' }}>
          {isLogin ? 'LOGIN' : 'SIGN UP'}
        </Text>

        <Text style={{ fontSize: AppType.title, marginBottom: AppSpace.xs, color: AppColors.ink900, fontWeight: '700' }}>
          Account Access
        </Text>

        <Text style={{ fontSize: AppType.body, color: '#475569', marginBottom: AppSpace.lg }}>
          Use the same credentials across requests, payments, chat, and ratings.
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
          error={fieldErrors.email}
          inputStyle={{ backgroundColor: AppColors.slate50 }}
        />

        <AppInput
          label="Password"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isSubmitting}
          error={fieldErrors.password}
          inputStyle={{ backgroundColor: AppColors.slate50, marginBottom: 2 }}
        />

        <AppButton
          label={isLogin ? 'Login' : 'Sign Up'}
          variant="neutral"
          onPress={isLogin ? handleLogin : handleSignup}
          disabled={!normalizedEmail || !password}
          loading={isSubmitting}
          style={{ marginBottom: AppSpace.sm, borderRadius: 12 }}
        />

        <TouchableOpacity
          style={{ paddingVertical: AppSpace.sm }}
          onPress={() => {
            setIsLogin(!isLogin);
            setFieldErrors({});
            setNotice(null);
          }}
          disabled={isSubmitting}
        >
          <Text style={{ textAlign: 'center', color: AppColors.blue700, fontWeight: '600' }}>
            {isLogin
              ? "Don't have an account? Sign Up"
              : 'Already have an account? Login'}
          </Text>
        </TouchableOpacity>
    </FormScreen>
  );
}