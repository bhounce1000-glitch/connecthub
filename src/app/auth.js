import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
const SIGNUP_ATTEMPTS_KEY = 'connecthub_signup_attempts';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUsername(value) {
  const v = String(value || '').trim();
  if (!v) return 'Username is required.';
  if (v.length < 3) return 'Username must be at least 3 characters.';
  if (v.length > 40) return 'Username must be 40 characters or fewer.';
  if (!/^[a-zA-Z0-9 _.-]+$/.test(v)) return 'Only letters, numbers, spaces, underscores, hyphens, and dots allowed.';
  return null;
}

function getPasswordStrength(passwordValue) {
  const value = String(passwordValue || '');
  if (!value) return { score: 0, label: '', color: '#e2e8f0', width: '0%' };

  let score = 0;
  const checks = {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
    longEnough: value.length >= 12,
  };

  score += checks.length ? 1 : 0;
  score += checks.uppercase ? 1 : 0;
  score += checks.lowercase ? 1 : 0;
  score += checks.number ? 1 : 0;
  score += checks.special ? 1 : 0;
  score += checks.longEnough ? 1 : 0;

  if (score <= 2) return { score, label: 'Weak', color: '#dc2626', width: '25%' };
  if (score <= 3) return { score, label: 'Fair', color: '#d97706', width: '50%' };
  if (score <= 4) return { score, label: 'Good', color: '#2563eb', width: '75%' };
  return { score, label: 'Strong', color: '#16a34a', width: '100%' };
}

function normalizeGhanaPhone(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  if (!compact) return '';
  if (compact.startsWith('+233')) return compact;
  if (compact.startsWith('233')) return `+${compact}`;
  if (compact.startsWith('0')) return `+233${compact.slice(1)}`;
  return `+233${compact}`;
}

async function canAttemptSignup() {
  const raw = await AsyncStorage.getItem(SIGNUP_ATTEMPTS_KEY);
  const now = Date.now();
  const attempts = raw ? JSON.parse(raw) : [];
  const recentAttempts = attempts.filter((value) => now - Number(value || 0) < 5 * 60 * 1000);
  await AsyncStorage.setItem(SIGNUP_ATTEMPTS_KEY, JSON.stringify(recentAttempts));
  return recentAttempts.length < 3;
}

async function recordSignupAttempt() {
  const raw = await AsyncStorage.getItem(SIGNUP_ATTEMPTS_KEY);
  const attempts = raw ? JSON.parse(raw) : [];
  attempts.push(Date.now());
  await AsyncStorage.setItem(SIGNUP_ATTEMPTS_KEY, JSON.stringify(attempts.slice(-10)));
}

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
  const searchParams = useLocalSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState(USER_ROLES.CUSTOMER);
  const [referralInput, setReferralInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [signupStep, setSignupStep] = useState(1);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpExpiry, setOtpExpiry] = useState(600);
  const passwordStrength = getPasswordStrength(password);

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['profile', 'email'],
  });

  // Capture referral code from URL params (e.g., ?ref=BHUN8F2X or ?referral=BHUN8F2X)
  useEffect(() => {
    const refValue = searchParams?.ref;
    const referralValue = searchParams?.referral;
    const rawRef = Array.isArray(refValue) ? refValue[0] : refValue;
    const rawReferral = Array.isArray(referralValue) ? referralValue[0] : referralValue;
    const refCode = String(rawRef || rawReferral || '').trim();
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
              referralCount: 0,
              referralEarnings: 0,
              referredUsers: [],
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
          void logSignupFailure('google_signin_failed', String(err?.message || 'Unable to sign in with Google.'), { stage: 'credential_signin' });
          Alert.alert('Google Sign-In Error', err?.message || 'Unable to sign in with Google.');
        })
        .finally(() => setIsSubmitting(false));
    }
  }, [response, role, router, referralInput]);

  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (otpCooldown <= 0) return undefined;
    const timeout = setTimeout(() => setOtpCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timeout);
  }, [otpCooldown]);

  useEffect(() => {
    if (!otpSent) return undefined;

    setOtpExpiry(600);
    const interval = setInterval(() => {
      setOtpExpiry((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setOtpSent(false);
          setSignupStep(1);
          setNotice({ tone: 'warning', title: 'Code expired', message: 'Your verification code expired. Please request a new one.' });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [otpSent]);

  const formatExpiry = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? `0${s}` : s}`;
  };

  const makeReferralCode = (emailValue) => {
    const local = String(emailValue || '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${local || 'CHUB'}${random}`;
  };

  // Links a new user to their referrer: saves referredBy + adds to referrer's referredUsers list
  // Also triggers a GHS 5 signup bonus for the new user
  const linkReferral = async (newUserEmail, codeValue) => {
    const normalizedCode = String(codeValue || '').trim().toUpperCase();
    const normalizedNewUserEmail = String(newUserEmail || '').trim().toLowerCase();
    if (!normalizedCode || !normalizedNewUserEmail) return;

    const snap = await getDocs(query(collection(db, 'users'), where('referralCode', '==', normalizedCode)));
    if (snap.empty) return;

    const referrerDoc = snap.docs[0];
    const referrerEmail = String(referrerDoc.data()?.email || referrerDoc.id || '').trim().toLowerCase();
    if (!referrerEmail || referrerEmail === normalizedNewUserEmail) return;

    // Save referredBy on the new user. The backend owns referrer aggregation,
    // so the client only writes its own document to stay within Firestore rules.
    await setDoc(doc(db, 'users', normalizedNewUserEmail), { referredBy: referrerEmail }, { merge: true });

    // Claim GHS 5 signup bonus via backend (fire-and-forget — don't block signup)
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://connecthub-yrox.onrender.com';
        await fetch(`${apiBase}/referral/signup-bonus`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        });
      }
    } catch (_) {
      // Non-fatal — bonus can be claimed on next app open if needed
    }
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
        referralCount: Number(existingData.referralCount || 0),
        referralEarnings: Number(existingData.referralEarnings || 0),
        referredUsers: Array.isArray(existingData.referredUsers) ? existingData.referredUsers : [],
        ...extraFields,
      },
      { merge: true }
    );
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = 'Please provide your email address.';
    } else if (!EMAIL_REGEX.test(normalizedEmail)) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (!isLogin) {
      const usernameError = validateUsername(username);
      if (usernameError) nextErrors.username = usernameError;
    }

    if (!password) {
      nextErrors.password = 'Please provide your password.';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    } else if (!isLogin) {
      const strength = getPasswordStrength(password);
      if (strength.score < 3) {
        nextErrors.password = 'Password is too weak. Use uppercase, lowercase, numbers, and symbols.';
      }
    }

    if (!isLogin) {
      const normalizedPhone = normalizeGhanaPhone(phoneNumber);
      if (!phoneNumber.trim()) {
        nextErrors.phoneNumber = 'Phone number is required for verification.';
      } else if (!/^\+233[0-9]{9}$/.test(normalizedPhone)) {
        nextErrors.phoneNumber = 'Enter a valid Ghana phone number (e.g. 0241234567).';
      }
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

  const getApiBase = () => process.env.EXPO_PUBLIC_API_BASE_URL || 'https://connecthub-yrox.onrender.com';

  async function logSignupFailure(errorType, errorMessage, metadata = {}) {
    try {
      await fetch(`${getApiBase()}/auth/signup-error-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          errorType,
          errorMessage,
          source: 'client_signup',
          metadata,
        }),
      });
    } catch {
      // Never block signup UX on diagnostics logging.
    }
  }

  const mapOtpSendError = (payload = {}, fallbackMessage = '') => {
    const code = String(payload?.code || '').trim().toLowerCase();
    if (code === 'email_service_unavailable' || code === 'otp_email_send_failed') {
      return 'Could not connect to email service. Please try again in a moment.';
    }
    if (code === 'email_already_registered') {
      return 'This email address is already registered. Please log in instead.';
    }
    if (code === 'otp_cooldown_active') {
      return 'Too many attempts. Please wait 60 seconds before requesting a new code.';
    }
    return payload?.message || payload?.error || fallbackMessage || 'Could not send verification code.';
  };

  const handleSendOTP = async () => {
    const normalizedPhone = normalizeGhanaPhone(phoneNumber);
    if (!/^\+233[0-9]{9}$/.test(normalizedPhone)) {
      setNotice({
        tone: 'warning',
        title: 'Invalid phone number',
        message: 'Enter a valid Ghana phone number (e.g. 0241234567).',
      });
      return false;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(`${getApiBase()}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, phone: normalizedPhone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.status) {
        const friendlyMessage = mapOtpSendError(data, 'Could not send verification code.');
        await logSignupFailure(data?.code || 'otp_send_failed', friendlyMessage, { endpointCode: data?.code || null });
        throw new Error(friendlyMessage);
      }

      setOtpSent(true);
      setSignupStep(2);
      setOtpCooldown(60);
      setOtpCode('');
      setNotice({ tone: 'success', title: 'Code sent', message: `A 6-digit verification code was sent to ${normalizedEmail}.` });
      return true;
    } catch (error) {
      await logSignupFailure('otp_send_failed', String(error?.message || 'Could not send verification code.'));
      setNotice({ tone: 'error', title: 'OTP send failed', message: error?.message || 'Could not send verification code.' });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || String(otpCode).trim().length !== 6) {
      setNotice({ tone: 'warning', title: 'Enter code', message: 'Enter the 6-digit verification code.' });
      return false;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(`${getApiBase()}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, otp: String(otpCode).trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.status) {
        const message = data?.message || data?.error || 'OTP verification failed.';
        await logSignupFailure(data?.code || 'otp_verify_failed', message, { endpointCode: data?.code || null });
        throw new Error(message);
      }
      return true;
    } catch (error) {
      await logSignupFailure('otp_verify_failed', String(error?.message || 'OTP verification failed.'));
      setNotice({ tone: 'error', title: 'Verification failed', message: error?.message || 'OTP verification failed.' });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAccount = async () => {
    setIsSubmitting(true);
    setNotice(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        throw new Error('Please enter a valid email address.');
      }

      const strength = getPasswordStrength(password);
      if (strength.score < 3) {
        throw new Error('Password is too weak. Use at least 8 characters with uppercase, lowercase, and numbers.');
      }

      const allowed = await canAttemptSignup();
      if (!allowed) {
        throw new Error('Too many signup attempts. Please wait 5 minutes.');
      }

      const trimmedUsername = username.trim();
      const usernameLower = trimmedUsername.toLowerCase();

      // Create the Firebase Auth account first so the user is signed in before
      // any Firestore reads — Firestore rules require isSignedIn() on the users
      // collection, so username uniqueness check must run after auth creation.
      await recordSignupAttempt();
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      // Now authenticated: check username uniqueness; roll back auth user if taken.
      const usernameSnap = await getDocs(
        query(collection(db, 'users'), where('usernameLower', '==', usernameLower))
      );
      if (!usernameSnap.empty) {
        await credential.user.delete().catch(() => {});
        await signOut(auth).catch(() => {});
        throw new Error('That username is already taken. Please choose a different one.');
      }

      await ensureUserDocument(credential.user, {
        role,
        username: trimmedUsername,
        usernameLower,
        phoneNumber: normalizeGhanaPhone(phoneNumber),
        onboardingDone: false,
      });

      if (referralInput && referralInput.trim()) {
        await linkReferral(normalizedEmail, referralInput.trim()).catch(() => {});
      }

      // Fire-and-forget verification email; do not block account usage.
      sendEmailVerification(credential.user).catch(() => {});

      setNotice({
        tone: 'success',
        title: 'Account created',
        message: 'Your account is ready. You can continue to the app now.',
      });
      router.replace('/');
    } catch (error) {
      const code = error?.code || '';
      let signupMessage = 'Unable to create your account right now. Please try again.';
      if (code === 'auth/email-already-in-use') {
        signupMessage = 'This email address is already registered. Please log in instead.';
      } else if (code === 'auth/too-many-requests') {
        signupMessage = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (code === 'auth/network-request-failed') {
        signupMessage = 'Network error. Check your connection and try again.';
      } else if (code === 'missing_user_email') {
        signupMessage = 'Google account did not return an email. Please try another sign-in method.';
      }
      await logSignupFailure(code || 'signup_failed', String(error?.message || signupMessage), { code: code || null });
      setNotice({
        tone: 'error',
        title: 'Signup failed',
        message: signupMessage,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      const loginCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      await reload(loginCredential.user);

      // Check Firestore first — existing users are always allowed in regardless of emailVerified.
      // Only new accounts with no Firestore document are gated behind email verification.
      const userRef = doc(db, 'users', normalizedEmail);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data() || {};
        if (userData.banned === true) {
          await signOut(auth);
          setNotice({ tone: 'error', title: 'Account suspended', message: 'Your account has been suspended. Contact support.' });
          setIsSubmitting(false);
          return;
        }
        // Existing user — skip emailVerified gate entirely
        router.replace('/');
        return;
      }

      // No Firestore document — treat as brand-new account.
      // Only enforce email verification for accounts that have never completed signup.
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

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setNotice({ tone: 'error', title: 'Invalid email', message: 'Please enter a valid email address.' });
      return;
    }

    if (signupStep === 1) {
      await handleSendOTP();
      return;
    }

    if (!otpSent) {
      setNotice({ tone: 'warning', title: 'Verification required', message: 'Send a verification code first.' });
      return;
    }

    const verified = await handleVerifyOTP();
    if (!verified) return;

    await handleCreateAccount();
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
      const normalizedUserEmail = String(credential.user?.email || '').trim().toLowerCase();
      if (!normalizedUserEmail) {
        throw new Error('missing_user_email');
      }
      const userRef = doc(db, 'users', normalizedUserEmail);
      const existingUserSnap = await getDoc(userRef);

      await ensureUserDocument(credential.user);

      if (!existingUserSnap.exists() && referralInput && referralInput.trim()) {
        await linkReferral(normalizedUserEmail, referralInput.trim()).catch(() => {});
      }
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
          void logSignupFailure('google_signin_not_ready', 'Google sign-in request is not initialized yet', { stage: 'init' });
          Alert.alert('Error', 'Google sign-in is not ready yet. Please try again.');
          return;
        }
        await promptAsync();
      }
    } catch (e) {
      void logSignupFailure('google_signin_failed', String(e?.message || 'Unable to start Google sign-in.'), { stage: 'prompt' });
      Alert.alert('Error', e?.message || 'Unable to start Google sign-in.');
    }
  };

  const handleResendVerification = async () => {
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
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
        boxShadow: '0px 6px 18px rgba(30, 58, 138, 0.12)',
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

        {!isLogin ? (
          <View style={{ marginBottom: AppSpace.sm }}>
            <Text style={{ color: '#1e293b', fontWeight: '800', fontSize: 13 }}>
              {signupStep === 1 ? 'Step 1 of 2: Account Details' : 'Step 2 of 2: Verify Your Phone'}
            </Text>
          </View>
        ) : null}

        {/* Username — shown only during sign-up */}
        {!isLogin && signupStep === 1 && (
          <AppInput
            label="Username / Display Name"
            placeholder="e.g. John Mensah or Mensah Plumbing Co."
            value={username}
            onChangeText={setUsername}
            autoCapitalize="words"
            editable={!isSubmitting}
            error={fieldErrors.username}
            inputStyle={{ backgroundColor: AppColors.slate50 }}
          />
        )}

        {/* Role picker — shown only during sign-up */}
        {!isLogin && signupStep === 1 && (
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

        {(!isLogin || isLogin) && signupStep !== 2 ? (
          <>
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
          </>
        ) : null}

        {!isLogin && signupStep === 1 ? (
          <>
            <AppInput
              label="Phone Number"
              placeholder="0241234567"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              editable={!isSubmitting}
              error={fieldErrors.phoneNumber}
              inputStyle={{ backgroundColor: AppColors.slate50 }}
            />
            <Text style={{ color: '#64748b', fontSize: 12, marginTop: -6, marginBottom: 8 }}>
              We'll send a 6-digit code to verify your phone number.
            </Text>
            <Text style={{ color: '#334155', fontSize: 12, marginBottom: AppSpace.sm }}>
              We verify your phone to protect your account and prevent spam.
            </Text>
          </>
        ) : null}

        {!isLogin && signupStep === 2 ? (
          <View style={{ marginBottom: AppSpace.md }}>
            <Text style={{ color: AppColors.ink900, fontWeight: '700', fontSize: 20, marginBottom: 4 }}>Step 2 of 2: Verify Your Phone</Text>
            <Text style={{ color: AppColors.ink500, marginBottom: 4 }}>Code sent to {normalizeGhanaPhone(phoneNumber) || phoneNumber}.</Text>
            <Text style={{ color: otpExpiry < 60 ? '#dc2626' : '#64748b', textAlign: 'center', marginBottom: 12, fontWeight: '700' }}>
              Code expires in {formatExpiry(otpExpiry)}
            </Text>
            <AppInput
              label="Verification Code"
              placeholder="000000"
              value={otpCode}
              onChangeText={setOtpCode}
              keyboardType="number-pad"
              editable={!isSubmitting}
              inputStyle={{ backgroundColor: AppColors.slate50, textAlign: 'center', letterSpacing: 8, fontSize: 26, fontWeight: '700' }}
            />
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 8 }}
              disabled={isSubmitting || otpCooldown > 0}
              onPress={handleSendOTP}
            >
              <Text style={{ color: otpCooldown > 0 ? '#94a3b8' : '#2563eb', fontWeight: '700' }}>
                {otpCooldown > 0 ? `Resend Code in ${otpCooldown}s` : 'Resend Code'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 8 }}
              onPress={() => setSignupStep(1)}
              disabled={isSubmitting}
            >
              <Text style={{ color: '#475569', fontWeight: '600' }}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!isLogin && signupStep !== 2 ? (
          <View style={{ marginBottom: AppSpace.md }}>
            <View style={{ height: 8, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
              <View style={{ width: password ? passwordStrength.width : '0%', height: '100%', backgroundColor: passwordStrength.color }} />
            </View>
            <Text style={{ marginTop: 6, color: password ? passwordStrength.color : '#94a3b8', fontSize: 12, fontWeight: '700' }}>
              Password strength: {password ? passwordStrength.label : 'Enter a password'}
              {password && passwordStrength.score <= 2 ? ' - Add uppercase, numbers, and symbols' : ''}
            </Text>
          </View>
        ) : null}

        {!isLogin && signupStep === 1 && (
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
          label={isLogin ? 'Login' : (signupStep === 1 ? 'Send Code' : 'Verify & Create Account')}
          variant="neutral"
          onPress={isLogin ? handleLogin : handleSignup}
          disabled={!normalizedEmail || !password}
          loading={isSubmitting}
          loadingLabel={isLogin ? 'Signing in...' : (signupStep === 1 ? 'Sending code...' : 'Creating account...')}
          style={{ marginBottom: AppSpace.sm, borderRadius: 12 }}
        />

        {!isLogin ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16, marginBottom: AppSpace.sm }}>
            <Text style={{ color: '#64748b', fontSize: 12 }}>By signing up you agree to our </Text>
            <TouchableOpacity onPress={() => router.push('/terms')}>
              <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '600' }}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={{ color: '#64748b', fontSize: 12 }}> and </Text>
            <TouchableOpacity onPress={() => router.push('/privacy-policy')}>
              <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '600' }}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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

        {isLogin && notice?.title === 'Email not verified' ? (
          <TouchableOpacity
            style={{ paddingVertical: AppSpace.xs }}
            onPress={() => setNotice(null)}
            disabled={isSubmitting}
          >
            <Text style={{ textAlign: 'center', color: '#2563eb', fontWeight: '600' }}>
              ✓ Already verified? Tap here to try again
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
            setSignupStep(1);
            setOtpCode('');
            setOtpSent(false);
            setOtpCooldown(0);
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

        <TouchableOpacity
          style={{ paddingVertical: AppSpace.xs }}
          onPress={() => router.push('/terms')}
          disabled={isSubmitting}
        >
          <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 12 }}>Terms of Service</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ paddingVertical: AppSpace.xs }}
          onPress={() => router.push('/privacy-policy')}
          disabled={isSubmitting}
        >
          <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 12 }}>Privacy Policy</Text>
        </TouchableOpacity>
    </FormScreen>
  );
}