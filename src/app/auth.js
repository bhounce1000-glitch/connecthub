import { useRouter, useSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import FormScreen from '../components/ui/form-screen';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
    FacebookAuthProvider,
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    reload,
    sendEmailVerification,
    signInWithCredential,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { USER_ROLES } from '../constants/access';
import { auth, db } from '../firebase';

// Required for expo-auth-session to close the browser tab after redirect on Android/web
WebBrowser.maybeCompleteAuthSession();

const SOCIAL_AUTH_ENABLED = {
  google: (process.env.EXPO_PUBLIC_AUTH_GOOGLE || 'true').toLowerCase() === 'true',
  facebook: (process.env.EXPO_PUBLIC_AUTH_FACEBOOK || 'false').toLowerCase() === 'true',
};

function getSocialProvider(providerKey) {
  if (providerKey === 'google') {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  }

  if (providerKey === 'facebook') {
    return new FacebookAuthProvider();
  }

  return null;
}

export default function Auth() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState(USER_ROLES.CUSTOMER);
  const [referralInput, setReferralInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['profile', 'email'],
  });

  // Capture referral code from URL params (e.g., ?ref=BHUN8F2X or ?referral=BHUN8F2X)
  useEffect(() => {
    const refCode = searchParams.get('ref') || searchParams.get('referral') || '';
    if (refCode) {
      setReferralInput(refCode);
    }
  }, [searchParams]);

  useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (!authentication?.idToken) {
        return;
      }

      const credential = GoogleAuthProvider.credential(
        authentication.idToken,
        authentication.accessToken
      );

      setIsSubmitting(true);
      setNotice(null);

      signInWithCredential(auth, credential)
        .then(async (result) => {
          const user = result.user;
          const normalizedUserEmail = String(user?.email || '').trim().toLowerCase();
          if (!normalizedUserEmail) {
            throw new Error('missing_user_email');
          }
          const userRef = doc(db, 'users', normalizedUserEmail);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              email: normalizedUserEmail,
              displayName: user.displayName || '',
              photoURL: user.photoURL || '',
              role: role || USER_ROLES.CUSTOMER,
              referralCode: makeReferralCode(normalizedUserEmail),
              referredBy: null,
              referralRewardEarned: 0,
              createdAt: new Date().toISOString(),
              onboardingDone: false,
            });
            // Link referral if a code was entered
            if (referralInput && referralInput.trim()) {
              await linkReferral(normalizedUserEmail, referralInput.trim()).catch(() => {});
            }
          }
          router.replace('/');
        })
        .catch((err) => {
          Alert.alert('Google Sign-In Error', err?.message || 'Unable to sign in with Google.');
        })
        .finally(() => setIsSubmitting(false));
    }
  }, [response, role, router]);

  const normalizedEmail = email.trim().toLowerCase();

  const makeReferralCode = (emailValue) => {
    const local = String(emailValue || '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${local || 'CHUB'}${random}`;
  };

  const resolveReferrerByCode = async (codeValue) => {
    const normalizedCode = String(codeValue || '').trim().toUpperCase();
    if (!normalizedCode) return '';

    const snap = await getDocs(query(collection(db, 'users'), where('referralCode', '==', normalizedCode)));
    if (snap.empty) return '';
    return String(snap.docs[0]?.id || '').trim().toLowerCase();
  };

  // Links a new user to their referrer: saves referredBy + adds to referrer's referredUsers list
  const linkReferral = async (newUserEmail, codeValue) => {
    const normalizedCode = String(codeValue || '').trim().toUpperCase();
    if (!normalizedCode || !newUserEmail) return;

    const snap = await getDocs(query(collection(db, 'users'), where('referralCode', '==', normalizedCode)));
    if (snap.empty) return;

    const referrerDoc = snap.docs[0];
    const referrerEmail = String(referrerDoc.id || '').trim().toLowerCase();
    if (!referrerEmail || referrerEmail === newUserEmail) return;

    // Save referredBy on the new user
    await setDoc(doc(db, 'users', newUserEmail), { referredBy: referrerEmail }, { merge: true });

    // Add new user to referrer's referredUsers array
    const currentReferredUsers = referrerDoc.data().referredUsers || [];
    await setDoc(doc(db, 'users', referrerEmail), {
      referredUsers: [
        ...currentReferredUsers,
        { email: newUserEmail, status: 'pending', joinedAt: new Date().toISOString() },
      ],
    }, { merge: true });
  };

  const ensureUserDocument = async (authUser, extraFields = {}) => {
    const normalizedUserEmail = String(authUser?.email || '').trim().toLowerCase();
    if (!normalizedUserEmail) {
      throw new Error('missing_user_email');
    }

    const userRef = doc(db, 'users', normalizedUserEmail);
    const existing = await getDoc(userRef);
    const existingData = existing.exists() ? (existing.data() || {}) : {};

    await setDoc(
      userRef,
      {
        email: normalizedUserEmail,
        referralCode: existingData.referralCode || makeReferralCode(normalizedUserEmail),
        referredBy: existingData.referredBy || extraFields?.referredBy || null,
        referralRewardEarned: Number(existingData.referralRewardEarned || 0),
        createdAt: existingData.createdAt || new Date(),
        updatedAt: new Date(),
        ...extraFields,
      },
      { merge: true }
    );
  };

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
      const loginCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      await reload(loginCredential.user);

      if (!loginCredential.user.emailVerified) {
        await signOut(auth);
        setNotice({
          tone: 'warning',
          title: 'Email not verified',
          message: 'Please open the verification email and click the link first. Check Inbox, Spam, and Promotions. If needed, use resend below.',
        });
        setIsSubmitting(false);
        return;
      }
      // Route through index so KYC gate is evaluated for providers
      router.replace('/');
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
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      const referrerEmail = referralInput.trim() ? await resolveReferrerByCode(referralInput) : '';

      // Seed a user document so profile data is immediately available (role stored here)
      await ensureUserDocument(credential.user, {
        role,
        onboardingDone: false,
        referredBy: referrerEmail || null,
      });

      // Link referral: save referredBy + update referrer's referredUsers list
      if (referralInput && referralInput.trim()) {
        await linkReferral(normalizedEmail, referralInput.trim()).catch(() => {});
      }

      // Send email verification — free Firebase feature, no upgrade needed
      await sendEmailVerification(credential.user);

      setNotice({
        tone: 'success',
        title: 'Account created — check your email',
        message: `A verification link was sent to ${normalizedEmail}. Check Inbox, Spam, and Promotions, then verify and log in.`,
      });
      setIsLogin(true);
      setPassword('');
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

  const handleSocialAuth = async (providerKey) => {
    if (Platform.OS !== 'web') {
      setNotice({
        tone: 'warning',
        title: 'Facebook sign-in on web only',
        message: 'Facebook sign-in is currently available on web. Use Google or email/password on mobile.',
      });
      return;
    }

    const provider = getSocialProvider(providerKey);
    if (!provider) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const credential = await signInWithPopup(auth, provider);
      await ensureUserDocument(credential.user);
      router.replace('/');
    } catch (error) {
      const code = error?.code || '';
      let message = 'Unable to continue with this provider right now. Please try again.';
      if (code === 'auth/popup-closed-by-user') {
        message = 'Sign-in popup was closed before completion.';
      } else if (code === 'auth/account-exists-with-different-credential') {
        message = 'This email is already linked to a different sign-in method.';
      } else if (code === 'auth/operation-not-allowed') {
        message = 'This provider is not enabled yet in Firebase Authentication settings.';
      }
      setNotice({
        tone: 'error',
        title: 'Social sign-in failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      if (Platform.OS === 'web') {
        await handleSocialAuth('google');
      } else {
        if (!request) {
          Alert.alert('Error', 'Google sign-in is not ready yet. Please try again.');
          return;
        }
        await promptAsync();
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Unable to start Google sign-in.');
    }
  };

  const handleResendVerification = async () => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      setNotice({ tone: 'warning', title: 'Enter your email first', message: 'Type your email address above, then tap resend.' });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      // Sign in silently just to get the user object so we can resend
      const tempCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password).catch(() => null);
      if (tempCredential && !tempCredential.user.emailVerified) {
        await sendEmailVerification(tempCredential.user);
      }
      setNotice({ tone: 'success', title: 'Verification email sent', message: `A new verification link was sent to ${normalizedEmail}. Check Inbox, Spam, and Promotions.` });
    } catch (_) {
      setNotice({ tone: 'error', title: 'Could not resend', message: 'Please check your email and password are correct, then try again.' });
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

        {/* Role picker — shown only during sign-up */}
        {!isLogin && (
          <View style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 8, fontSize: 14 }}>
              I want to…
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: '🙋 Hire a provider', value: USER_ROLES.CUSTOMER },
                { label: '🛠 Offer my services', value: USER_ROLES.PROVIDER },
              ].map((opt) => {
                const active = role === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setRole(opt.value)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      borderRadius: AppRadius.md,
                      borderWidth: 2,
                      borderColor: active ? '#4338ca' : '#e2e8f0',
                      backgroundColor: active ? '#eef2ff' : '#f8fafc',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontWeight: '700', fontSize: 13, color: active ? '#4338ca' : AppColors.ink700, textAlign: 'center' }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

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

        {!isLogin && (
          <AppInput
            label="Referral Code (Optional)"
            placeholder="Enter referral code from a friend"
            value={referralInput}
            onChangeText={setReferralInput}
            autoCapitalize="characters"
            editable={!isSubmitting}
            inputStyle={{ backgroundColor: AppColors.slate50 }}
          />
        )}

        <AppButton
          label={isLogin ? 'Login' : 'Sign Up'}
          variant="neutral"
          onPress={isLogin ? handleLogin : handleSignup}
          disabled={!normalizedEmail || !password}
          loading={isSubmitting}
          loadingLabel={isLogin ? 'Signing in...' : 'Creating account...'}
          style={{ marginBottom: AppSpace.sm, borderRadius: 12 }}
        />

        {isLogin ? (
          <TouchableOpacity
            style={{ paddingVertical: AppSpace.xs }}
            onPress={() => router.push('/forgot-password')}
            disabled={isSubmitting}
          >
            <Text style={{ textAlign: 'center', color: AppColors.blue700, fontWeight: '600' }}>
              Forgot password? Reset it
            </Text>
          </TouchableOpacity>
        ) : null}

        {isLogin && notice?.title === 'Email not verified' ? (
          <TouchableOpacity
            style={{ paddingVertical: AppSpace.xs }}
            onPress={handleResendVerification}
            disabled={isSubmitting}
          >
            <Text style={{ textAlign: 'center', color: '#0f766e', fontWeight: '600' }}>
              Resend verification email
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: AppSpace.md }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#cbd5e1' }} />
          <Text style={{ marginHorizontal: 10, color: '#64748b', fontSize: 12, fontWeight: '700' }}>OR CONTINUE WITH</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: '#cbd5e1' }} />
        </View>

        {SOCIAL_AUTH_ENABLED.google ? (
          <AppButton
            label="Continue with Google"
            onPress={handleGoogleSignIn}
            disabled={isSubmitting}
            style={{ marginBottom: AppSpace.sm, borderRadius: 12, backgroundColor: '#1d4ed8' }}
          />
        ) : null}

        {SOCIAL_AUTH_ENABLED.facebook ? (
          <AppButton
            label="Continue with Facebook"
            onPress={() => handleSocialAuth('facebook')}
            disabled={isSubmitting}
            style={{ marginBottom: AppSpace.sm, borderRadius: 12, backgroundColor: '#1877f2' }}
          />
        ) : null}

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