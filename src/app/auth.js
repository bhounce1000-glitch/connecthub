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
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    if (!normalizedEmail) {
      nextErrors.email = 'Please provide your email address.';
    } else if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Please provide your password.';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    } else if (!isLogin && !/[A-Z]/.test(password)) {
      nextErrors.password = 'Password must contain at least one uppercase letter.';
    } else if (!isLogin && !/[0-9]/.test(password)) {
      nextErrors.password = 'Password must contain at least one number.';
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
      // Map Firebase error codes to generic messages to prevent user enumeration.
      // Never expose whether an email exists or not.
      const code = error?.code || '';
      let loginMessage = 'Incorrect email or password. Please try again.';
      if (code === 'auth/too-many-requests') {
        loginMessage = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (code === 'auth/network-request-failed') {
        loginMessage = 'Network error. Check your connection and try again.';
      }
      setNotice({
        tone: 'error',
        title: 'Login failed',
        message: loginMessage,
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
      const code = error?.code || '';
      let signupMessage = 'Unable to create your account right now. Please try again.';
      if (code === 'auth/email-already-in-use') {
        // Intentionally vague — do not confirm the email is registered
        signupMessage = 'Unable to create an account with those details. Try logging in instead.';
      } else if (code === 'auth/too-many-requests') {
        signupMessage = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (code === 'auth/network-request-failed') {
        signupMessage = 'Network error. Check your connection and try again.';
      }
      setNotice({
        tone: 'error',
        title: 'Signup failed',
        message: signupMessage,
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
        : 'Join now and start offering or requesting services. Password must be 8+ characters with an uppercase letter and a number.'}
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