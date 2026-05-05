require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const pino = require('pino');
const { sendPaymentReceiptEmail, sendKycSubmissionEmail, sendKycApprovalEmail, sendKycRejectionEmail, isEmailConfigured, transporter: emailTransporter, EMAIL_FROM: emailFrom } = require('./src/server/email');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// Load service account from env var (production) or local file (development)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  serviceAccount = require('./serviceAccountKey.json');
}

const app = express();
const PORT = process.env.PORT || 3001;
const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://connecthub-1873e.web.app';
const CALLBACK_BASE_URL = process.env.PAYSTACK_CALLBACK_BASE_URL || WEB_BASE_URL;
const PUBLIC_SERVER_BASE_URL = process.env.BACKEND_PUBLIC_URL || 'https://connecthub-yrox.onrender.com';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || `${WEB_BASE_URL},${CALLBACK_BASE_URL}`)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.EXPO_PUBLIC_ADMIN_EMAILS || 'bhounce1000@gmail.com')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || '';
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || '0.10');
const REFERRAL_BONUS_AMOUNT = parseMoney(process.env.REFERRAL_BONUS_AMOUNT || 10);
const FREE_PLAN_JOB_LIMIT = Number(process.env.FREE_PLAN_JOB_LIMIT || 5);
const SUBSCRIPTION_PLAN_CONFIG = {
  free: { amount: 0, durationDays: 0, acceptLimit: FREE_PLAN_JOB_LIMIT, badge: 'Basic' },
  pro: { amount: 49, durationDays: 30, acceptLimit: null, badge: 'Pro' },
  premium: { amount: 99, durationDays: 30, acceptLimit: null, badge: 'Premium' },
};
const MOBILE_SCHEME = process.env.MOBILE_APP_SCHEME || 'connecthub';

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

const NORMALIZED_CALLBACK_BASE_URL = trimTrailingSlash(CALLBACK_BASE_URL);
const allowedOriginSet = new Set(CORS_ALLOWED_ORIGINS.map((origin) => trimTrailingSlash(origin)));

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests and native clients without Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = trimTrailingSlash(origin);
    callback(null, allowedOriginSet.has(normalizedOrigin));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'],
}));
app.use((req, res, next) => {
  const generatedId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  req.requestId = generatedId;
  res.setHeader('x-request-id', generatedId);
  next();
});

app.use(express.json({
  limit: '64kb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  },
}));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
  });
}

const adminDb = admin.firestore();
const adminStorage = admin.storage().bucket();

function sendSuccess(res, req, payload = {}, statusCode = 200) {
  return res.status(statusCode).json({
    status: true,
    requestId: req.requestId,
    ...payload,
  });
}

function sendError(res, req, statusCode, code, message, details = null) {
  const response = {
    status: false,
    requestId: req.requestId,
    error: message,
    code,
    message,
  };

  if (details != null) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
}

function getPaystackSecret() {
  return process.env.PAYSTACK_SECRET || '';
}

function isAdminEmail(email) {
  if (!email) {
    return false;
  }

  return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}

async function writeAuditLog({ actorEmail = null, actorUid = null, eventType, requestId = null, before = null, after = null, metadata = {} }) {
  try {
    await adminDb.collection('request_audit_logs').add({
      actorEmail,
      actorUid,
      eventType,
      requestId,
      before,
      after,
      metadata,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, 'AUDIT_LOG_ERROR');
  }
}

async function writeNotification(userEmail, text) {
  if (!userEmail || !text) return;
  const normalizedEmail = String(userEmail).trim().toLowerCase();
  try {
    await adminDb.collection('notifications').add({
      user: normalizedEmail,
      userLower: normalizedEmail,
      text,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, 'NOTIFICATION_WRITE_ERROR');
  }
}

async function sendPushNotification(pushToken, title, body, data) {
  if (!pushToken || !title || !body) {
    return;
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high',
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.warn({ status: response.status, responseText }, 'PUSH_SEND_NON_OK_RESPONSE');
    }
  } catch (error) {
    logger.error({ err: error }, 'PUSH_SEND_ERROR');
  }
}

async function getPushTokenForUser(userEmail) {
  if (!userEmail) return null;
  try {
    const userDoc = await adminDb.collection('users').doc(String(userEmail).trim().toLowerCase()).get();
    if (!userDoc.exists) return null;
    const pushToken = userDoc.data()?.pushToken;
    return typeof pushToken === 'string' && pushToken.trim() ? pushToken.trim() : null;
  } catch (error) {
    logger.error({ err: error, userEmail }, 'PUSH_TOKEN_LOOKUP_ERROR');
    return null;
  }
}

async function notifyUser(userEmail, text, pushTitle = 'ConnectHub', pushData = null) {
  if (!userEmail || !text) {
    return {
      inAppNotificationStored: false,
      pushAttempted: false,
      pushDelivered: false,
      pushTokenFound: false,
    };
  }

  const normalizedEmail = String(userEmail).trim().toLowerCase();
  let inAppNotificationStored = false;
  let pushAttempted = false;
  let pushDelivered = false;
  let pushTokenFound = false;

  await writeNotification(normalizedEmail, text);
  inAppNotificationStored = true;

  const pushToken = await getPushTokenForUser(normalizedEmail);
  if (pushToken) {
    pushTokenFound = true;
    pushAttempted = true;
    await sendPushNotification(pushToken, pushTitle, text, pushData || {});
    pushDelivered = true;
  }

  return {
    inAppNotificationStored,
    pushAttempted,
    pushDelivered,
    pushTokenFound,
  };
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');

    if (!token) {
      return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    return next();
  } catch (error) {
    return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token');
  }
}

function requireAdmin(req, res, next) {
  const user = req.user || {};
  const email = user.email || '';
  const hasAdminClaim = user.admin === true || user.role === 'admin';

  if (!hasAdminClaim && !isAdminEmail(email)) {
    return sendError(res, req, 403, 'admin_access_required', 'Admin access required');
  }

  return next();
}

async function requireAdminOrBootstrapSecret(req, res, next) {
  const suppliedSecret = req.headers['x-admin-secret'];

  if (ADMIN_BOOTSTRAP_SECRET && suppliedSecret === ADMIN_BOOTSTRAP_SECRET) {
    req.user = {
      uid: 'bootstrap-secret',
      email: 'bootstrap@local',
      admin: true,
      role: 'admin',
    };
    return next();
  }

  return requireAuth(req, res, () => requireAdmin(req, res, next));
}

async function markRequestPaid(requestId, paymentReference, extraFields = {}) {
  if (!requestId) {
    return {
      updated: false,
      reason: 'missing_request_id',
    };
  }

  const requestRef = adminDb.collection('requests').doc(requestId);
  const existingSnapshot = await requestRef.get();

  if (!existingSnapshot.exists) {
    return {
      updated: false,
      reason: 'request_not_found',
    };
  }

  const beforeData = existingSnapshot.exists ? existingSnapshot.data() : null;
  const currentStatus = beforeData?.status || (beforeData?.paid ? 'paid' : 'open');

  if (currentStatus === 'paid') {
    return {
      updated: false,
      reason: 'already_paid',
    };
  }

  if (currentStatus !== 'completed') {
    return {
      updated: false,
      reason: 'invalid_status_transition',
      currentStatus,
    };
  }

  if (!beforeData?.escrowFunded || beforeData?.escrowStatus !== 'held') {
    return {
      updated: false,
      reason: 'escrow_not_held',
      currentStatus,
    };
  }

  if (beforeData?.paymentHold) {
    return {
      updated: false,
      reason: 'payment_on_hold',
      currentStatus,
    };
  }

  if (!beforeData?.acceptedBy) {
    return {
      updated: false,
      reason: 'missing_assigned_provider',
      currentStatus,
    };
  }

  const requestPrice = Number(beforeData?.price || 0);
  const commission = parseFloat((requestPrice * COMMISSION_RATE).toFixed(2));
  const providerNet = parseFloat((requestPrice * (1 - COMMISSION_RATE)).toFixed(2));

  const payload = {
    paid: true,
    status: 'paid',
    paymentReference,
    paymentStatus: 'success',
    paidAt: new Date().toISOString(),
    escrowStatus: 'released',
    escrowReleasedAt: new Date().toISOString(),
    escrowReleasedBy: extraFields?.source || 'customer_confirmation',
    providerPayout: providerNet,
    commission,
    providerNet,
    commissionRate: COMMISSION_RATE,
    ...extraFields,
  };

  await requestRef.set(payload, { merge: true });

  await creditWalletBalance(beforeData.acceptedBy, providerNet);

  // Referral bonus: provider side + customer side (first paid job only).
  try {
    await maybeAwardReferralBonus(requestId, {
      referredUserEmail: beforeData.acceptedBy,
      paidQueryField: 'acceptedBy',
      roleLabel: 'provider',
    });

    await maybeAwardReferralBonus(requestId, {
      referredUserEmail: beforeData.user,
      paidQueryField: 'user',
      roleLabel: 'customer',
    });
  } catch (referralErr) {
    console.error('[referral-bonus] Error processing referral bonus:', referralErr?.message);
  }

  await createTransactionRecordOnServer({
    requestId,
    requestData: { ...beforeData, ...payload },
    transactionId: paymentReference,
    amount: requestPrice,
    commission,
    netAmount: providerNet,
    status: 'SUCCESS',
    paymentMethod: extraFields?.paymentChannel || 'Escrow Release',
  });

  await writeAuditLog({
    actorEmail: 'paystack@system',
    actorUid: 'paystack-system',
    eventType: 'payment_marked_paid',
    requestId,
    before: beforeData,
    after: { ...(beforeData || {}), ...payload },
    metadata: {
      paymentReference,
      source: extraFields?.source || 'paystack',
    },
  });

  const title = beforeData?.title || `Request ${requestId}`;
  // Notify provider that they have been paid
  if (beforeData?.acceptedBy) {
    await writeNotification(
      beforeData.acceptedBy,
      `Payment received for "${title}". Reference: ${paymentReference}.`
    );
  }
  // Notify owner that payment was processed
  if (beforeData?.user) {
    await writeNotification(
      beforeData.user,
      `Your payment for "${title}" has been confirmed successfully.`
    );
  }

  return {
    updated: true,
    reason: 'marked_paid',
    currentStatus,
  };
}

function parseMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, parseFloat(amount.toFixed(2)));
}

function normalizePlan(planValue) {
  const normalized = String(planValue || 'free').trim().toLowerCase();
  if (normalized === 'basic') return 'free';
  if (!SUBSCRIPTION_PLAN_CONFIG[normalized]) return 'free';
  return normalized;
}

function isoPlusDays(days) {
  const now = Date.now();
  const ms = Number(days || 0) * 24 * 60 * 60 * 1000;
  return new Date(now + ms).toISOString();
}

function toIsoDateString(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString();
}

function planLabel(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === 'pro') return 'Pro';
  if (normalizedPlan === 'premium') return 'Premium';
  return 'Basic';
}

function planPriceLabel(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === 'pro') return '49';
  if (normalizedPlan === 'premium') return '99';
  return '0';
}

function resolveSubscriptionRedirectUrl(status, plan, platform) {
  const normalizedStatus = String(status || 'failed').trim().toLowerCase();
  const normalizedPlan = normalizePlan(plan);
  const targetPlatform = String(platform || '').trim().toLowerCase();
  const encodedPlan = encodeURIComponent(normalizedPlan);
  const encodedStatus = encodeURIComponent(normalizedStatus);

  if (targetPlatform === 'mobile') {
    return `${MOBILE_SCHEME}://subscription?status=${encodedStatus}&plan=${encodedPlan}`;
  }

  return `${trimTrailingSlash(WEB_BASE_URL)}/subscription?status=${encodedStatus}&plan=${encodedPlan}`;
}

function startOfMonthIso() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return monthStart.toISOString();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function applySubscriptionForUser(userEmail, plan, reference, source = 'subscription_verify') {
  const normalizedEmail = String(userEmail || '').trim().toLowerCase();
  const normalizedPlan = normalizePlan(plan);
  const planConfig = SUBSCRIPTION_PLAN_CONFIG[normalizedPlan] || SUBSCRIPTION_PLAN_CONFIG.free;

  if (!normalizedEmail || normalizedPlan === 'free') {
    return {
      updated: false,
      reason: 'invalid_subscription_payload',
    };
  }

  const userRef = adminDb.collection('users').doc(normalizedEmail);
  const userSnapshot = await userRef.get();
  const existingUser = userSnapshot.exists ? (userSnapshot.data() || {}) : {};

  const nowIso = new Date().toISOString();
  const expiresAt = isoPlusDays(planConfig.durationDays || 30);
  const displayName = String(
    existingUser.displayName
    || existingUser.name
    || normalizedEmail.split('@')[0]
  ).trim();

  await userRef.set({
    subscriptionPlan: normalizedPlan,
    subscriptionBadge: planConfig.badge,
    subscriptionStatus: 'active',
    subscriptionStartedAt: nowIso,
    subscriptionStarted: nowIso,
    subscriptionExpiry: expiresAt,
    subscriptionRenewalDate: expiresAt,
    subscriptionPaymentReference: reference || null,
    subscriptionReference: reference || null,
    subscriptionUpdatedAt: nowIso,
    updatedAt: nowIso,
  }, { merge: true });

  await adminDb.collection('notifications').add({
    user: normalizedEmail,
    userId: normalizedEmail,
    title: normalizedPlan === 'pro' ? '🎉 Pro Plan Activated!' : '⭐ Premium Plan Activated!',
    body: `Congratulations! Your ${normalizedPlan} plan is now active. You will be billed GHS ${planPriceLabel(normalizedPlan)} at the end of each month to keep your benefits.`,
    type: 'subscription_activated',
    read: false,
    text: `${planLabel(normalizedPlan)} subscription activated`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtIso: nowIso,
  });

  if (isEmailConfigured()) {
    const subject = `ConnectHub - ${planLabel(normalizedPlan)} Plan Activated! 🎉`;
    const html = `
      <p>Dear ${displayName},</p>
      <p>Congratulations! Your ${planLabel(normalizedPlan)} plan on ConnectHub is now active.</p>
      <p><b>Plan Details:</b></p>
      <ul>
        <li>Plan: ${planLabel(normalizedPlan)}</li>
        <li>Monthly cost: GHS ${planPriceLabel(normalizedPlan)}</li>
        <li>Activated: ${toIsoDateString(nowIso)}</li>
        <li>Next renewal: ${toIsoDateString(expiresAt)}</li>
      </ul>
      <p><b>What you get:</b></p>
      <ul>
        <li>Unlimited job applications every month</li>
        <li>${normalizedPlan === 'pro' ? 'Pro badge' : 'Premium placement badge'} on your profile</li>
        ${normalizedPlan === 'premium' ? '<li>Featured placement at the top of search results</li>' : ''}
      </ul>
      <p><b>Important:</b><br/>You will be automatically billed GHS ${planPriceLabel(normalizedPlan)} at the end of each month. If payment fails, your account will be downgraded to the Basic plan.</p>
      <p>To cancel your subscription at any time, open the ConnectHub app and go to Profile -> Subscription -> Cancel.</p>
      <p>Thank you for supporting ConnectHub!<br/>The ConnectHub Team</p>
    `;

    try {
      await emailTransporter.sendMail({
        from: emailFrom,
        to: normalizedEmail,
        subject,
        html,
      });
    } catch (error) {
      logger.warn({ err: error, email: normalizedEmail }, 'SUBSCRIPTION_ACTIVATION_EMAIL_FAILED');
    }
  }

  await notifyUser(
    normalizedEmail,
    `Your ${planConfig.badge} plan is active until ${new Date(expiresAt).toLocaleDateString()}.`,
    'Subscription Active!',
    { screen: 'subscription' }
  );

  return {
    updated: true,
    plan: normalizedPlan,
    expiresAt,
  };
}

async function countProviderMonthlyAccepts(providerEmail) {
  const normalizedEmail = String(providerEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return 0;

  const monthStart = startOfMonthIso();
  const snapshot = await adminDb
    .collection('requests')
    .where('acceptedBy', '==', normalizedEmail)
    .get();

  let count = 0;
  snapshot.docs.forEach((docItem) => {
    const row = docItem.data() || {};
    const acceptedAt = row.acceptedAt || row.createdAt;
    if (!acceptedAt) return;
    if (toMillis(acceptedAt) >= toMillis(monthStart)) {
      count += 1;
    }
  });
  return count;
}

async function verifyPaystackTransaction(reference) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) {
    return { ok: false, error: 'missing_reference', data: null };
  }

  const paystackSecret = getPaystackSecret();
  if (!paystackSecret) {
    return { ok: false, error: 'payment_configuration_missing', data: null };
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${normalizedReference}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  const isSuccessful = response.ok && data?.status && data?.data?.status === 'success';
  return {
    ok: Boolean(isSuccessful),
    data,
    error: isSuccessful ? null : 'subscription_payment_not_successful',
  };
}

async function downgradeUserToBasic(userEmail, status = 'expired') {
  const normalizedEmail = String(userEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  const nowIso = new Date().toISOString();
  await adminDb.collection('users').doc(normalizedEmail).set({
    subscriptionPlan: 'free',
    subscriptionBadge: 'Basic',
    subscriptionStatus: status,
    subscriptionExpiry: null,
    subscriptionRenewalDate: null,
    subscriptionUpdatedAt: nowIso,
    updatedAt: nowIso,
  }, { merge: true });
}

async function tryAutoRenewSubscription(userEmail, userData = {}) {
  const normalizedEmail = String(userEmail || '').trim().toLowerCase();
  const plan = normalizePlan(userData.subscriptionPlan || 'free');
  const planConfig = SUBSCRIPTION_PLAN_CONFIG[plan] || SUBSCRIPTION_PLAN_CONFIG.free;
  const authorizationCode = String(userData.subscriptionAuthorizationCode || '').trim();

  if (!authorizationCode || plan === 'free') {
    return { renewed: false, reason: 'missing_authorization_code' };
  }

  const paystackSecret = getPaystackSecret();
  if (!paystackSecret) {
    return { renewed: false, reason: 'payment_configuration_missing' };
  }

  const response = await fetch('https://api.paystack.co/transaction/charge_authorization', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: normalizedEmail,
      amount: Math.round(planConfig.amount * 100),
      authorization_code: authorizationCode,
      metadata: {
        type: 'subscription_renewal',
        plan,
        email: normalizedEmail,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok || !data?.status || data?.data?.status !== 'success') {
    return { renewed: false, reason: 'charge_failed', details: data };
  }

  await applySubscriptionForUser(normalizedEmail, plan, data?.data?.reference || null, 'subscription_renewal');
  return { renewed: true, reference: data?.data?.reference || null };
}

async function maybeAwardReferralBonus(requestId, requestData) {
  try {
    const referredUserEmail = String(requestData?.referredUserEmail || '').trim().toLowerCase();
    const paidQueryField = String(requestData?.paidQueryField || '').trim();
    const roleLabel = String(requestData?.roleLabel || '').trim().toLowerCase();

    if (!referredUserEmail || !requestId || !paidQueryField || !roleLabel) return;

    const requestMarkerKey = roleLabel === 'provider'
      ? 'referralBonusAwardedProvider'
      : 'referralBonusAwardedCustomer';

    const requestRef = adminDb.collection('requests').doc(requestId);
    const requestSnap = await requestRef.get();
    const latest = requestSnap.exists ? (requestSnap.data() || {}) : {};
    if (latest[requestMarkerKey] === true) return;

    const referredUserRef = adminDb.collection('users').doc(referredUserEmail);
    const referredUserSnap = await referredUserRef.get();
    if (!referredUserSnap.exists) return;

    const referredUser = referredUserSnap.data() || {};
    const referrerEmail = String(referredUser.referredBy || '').trim().toLowerCase();
    if (!referrerEmail || referrerEmail === referredUserEmail) return;

    const paidSnapshot = await adminDb.collection('requests')
      .where(paidQueryField, '==', referredUserEmail)
      .where('status', '==', 'paid')
      .get();
    if (paidSnapshot.size !== 1) return;

    const referrerRef = adminDb.collection('users').doc(referrerEmail);
    const referrerSnap = await referrerRef.get();
    if (!referrerSnap.exists) return;

    const referrerData = referrerSnap.data() || {};
    const existingReferredUsers = Array.isArray(referrerData.referredUsers) ? referrerData.referredUsers : [];
    const updatedReferredUsers = existingReferredUsers.map((entry) => {
      const entryEmail = String(entry?.email || '').trim().toLowerCase();
      if (entryEmail !== referredUserEmail) {
        return entry;
      }
      return {
        ...entry,
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
    });

    const nowIso = new Date().toISOString();
    await Promise.all([
      referredUserRef.set({
        walletBalance: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralRewardEarned: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralEarnings: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralFirstJobCompletedAt: nowIso,
        updatedAt: nowIso,
      }, { merge: true }),
      referrerRef.set({
        walletBalance: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralRewardEarned: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralEarnings: admin.firestore.FieldValue.increment(REFERRAL_BONUS_AMOUNT),
        referralCount: admin.firestore.FieldValue.increment(1),
        referredUsers: updatedReferredUsers,
        updatedAt: nowIso,
      }, { merge: true }),
      requestRef.set({
        [requestMarkerKey]: true,
        [`${requestMarkerKey}At`]: nowIso,
      }, { merge: true }),
      adminDb.collection('transactions').add({
        transactionId: `ref_bonus_referrer_${roleLabel}_${requestId}`,
        requestId,
        type: 'referral_bonus',
        amount: REFERRAL_BONUS_AMOUNT,
        status: 'SUCCESS',
        senderEmail: null,
        receiverEmail: referrerEmail,
        receiverName: referrerEmail,
        senderName: 'ConnectHub Referral Program',
        paymentMethod: 'Internal Wallet Credit',
        participants: [referrerEmail],
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: nowIso,
        notes: `Referral bonus for ${referredUserEmail}'s first paid ${roleLabel} job`,
      }),
      adminDb.collection('transactions').add({
        transactionId: `ref_bonus_referred_${roleLabel}_${requestId}`,
        requestId,
        type: 'referral_bonus',
        amount: REFERRAL_BONUS_AMOUNT,
        status: 'SUCCESS',
        senderEmail: null,
        receiverEmail: referredUserEmail,
        receiverName: referredUserEmail,
        senderName: 'ConnectHub Referral Program',
        paymentMethod: 'Internal Wallet Credit',
        participants: [referredUserEmail],
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: nowIso,
        notes: `First paid ${roleLabel} job referral bonus`,
      }),
      adminDb.collection('notifications').add({
        user: referredUserEmail,
        userId: referredUserEmail,
        title: 'Referral Bonus Earned!',
        body: `You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)} wallet credit for your first paid ${roleLabel} job on ConnectHub!`,
        type: 'referral_bonus',
        read: false,
        text: `You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)} referral bonus for your first paid ${roleLabel} job.`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      }),
      adminDb.collection('notifications').add({
        user: referrerEmail,
        userId: referrerEmail,
        title: 'Referral Reward!',
        body: `Your referral completed their first paid ${roleLabel} job. You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)}!`,
        type: 'referral_bonus',
        read: false,
        text: `You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)} because your referral completed their first paid ${roleLabel} job.`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      }),
    ]);

    const referredPushToken = referredUser.data()?.pushToken;
    const referrerPushToken = referrerData?.pushToken;
    if (referredPushToken) {
      await sendPushNotification(
        referredPushToken,
        'You earned GHS 10!',
        `Referral bonus for your first paid ${roleLabel} job.`
      ).catch(() => {});
    }
    if (referrerPushToken) {
      await sendPushNotification(
        referrerPushToken,
        'Referral reward credited!',
        `Your referral completed their first paid ${roleLabel} job. You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)}.`
      ).catch(() => {});
    }

    await Promise.all([
      notifyUser(
        referredUserEmail,
        `You received GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)} referral bonus for your first paid ${roleLabel} job!`,
        'Referral Bonus Added',
        { screen: 'wallet' }
      ),
      notifyUser(
        referrerEmail,
        `You earned GHS ${REFERRAL_BONUS_AMOUNT.toFixed(2)} because your referral completed their first paid ${roleLabel} job.`,
        'Referral Bonus Added',
        { screen: 'referral' }
      ),
    ]);
  } catch (error) {
    logger.error({ err: error, requestId }, 'REFERRAL_BONUS_AWARD_ERROR');
  }
}

async function expireDueSubscriptions() {
  try {
    const nowIso = new Date().toISOString();
    const snapshot = await adminDb
      .collection('users')
      .where('subscriptionStatus', '==', 'active')
      .where('subscriptionExpiry', '<=', nowIso)
      .get();

    if (snapshot.empty) {
      return;
    }

    await Promise.all(snapshot.docs.map(async (docItem) => {
      const targetEmail = String(docItem.id || '').trim().toLowerCase();
      const userData = docItem.data() || {};
      const userPlan = normalizePlan(userData.subscriptionPlan || 'free');
      if (!['pro', 'premium'].includes(userPlan)) {
        return;
      }

      const autoRenewResult = await tryAutoRenewSubscription(targetEmail, userData);
      if (autoRenewResult.renewed) {
        await notifyUser(
          targetEmail,
          `Your ${planLabel(userData.subscriptionPlan)} plan renewed successfully.`,
          'Subscription Renewed',
          { screen: 'subscription' }
        );
        return;
      }

      await downgradeUserToBasic(targetEmail, 'expired');

      await adminDb.collection('notifications').add({
        user: targetEmail,
        userId: targetEmail,
        title: 'Subscription Expired',
        body: 'Your Pro/Premium subscription has expired. You have been moved to the Basic plan. Renew in the app to restore your benefits.',
        type: 'subscription_expired',
        read: false,
        text: 'Subscription expired. You were moved to Basic.',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      });

      await notifyUser(
        targetEmail,
        'Your Pro/Premium subscription has expired. You have been moved to the Basic plan. Renew in the app to restore your benefits.',
        'Subscription Expired',
        { screen: 'subscription' }
      );

      if (isEmailConfigured()) {
        try {
          await emailTransporter.sendMail({
            from: emailFrom,
            to: targetEmail,
            subject: 'ConnectHub - Subscription Expired',
            html: `
              <p>Your Pro/Premium subscription has expired.</p>
              <p>You have been moved to the Basic plan. Renew in the ConnectHub app to restore your benefits.</p>
            `,
          });
        } catch (error) {
          logger.warn({ err: error, email: targetEmail }, 'SUBSCRIPTION_EXPIRY_EMAIL_FAILED');
        }
      }
    }));
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_EXPIRY_SWEEP_ERROR');
  }
}

async function creditWalletBalance(userEmail, amount) {
  const normalizedEmail = String(userEmail || '').trim().toLowerCase();
  const normalizedAmount = parseMoney(amount);

  if (!normalizedEmail || normalizedAmount <= 0) {
    return;
  }

  const userRef = adminDb.collection('users').doc(normalizedEmail);
  await userRef.set({
    walletBalance: admin.firestore.FieldValue.increment(normalizedAmount),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

async function createTransactionRecordOnServer({
  requestId,
  requestData,
  transactionId,
  amount,
  commission,
  netAmount,
  status,
  paymentMethod,
}) {
  const senderEmail = String(requestData?.user || '').trim().toLowerCase();
  const receiverEmail = String(requestData?.acceptedBy || '').trim().toLowerCase();

  const senderProfilePromise = senderEmail
    ? adminDb.collection('users').doc(senderEmail).get().catch(() => null)
    : Promise.resolve(null);
  const receiverProfilePromise = receiverEmail
    ? adminDb.collection('users').doc(receiverEmail).get().catch(() => null)
    : Promise.resolve(null);

  const [senderSnap, receiverSnap] = await Promise.all([senderProfilePromise, receiverProfilePromise]);
  const senderProfile = senderSnap && senderSnap.exists ? senderSnap.data() : {};
  const receiverProfile = receiverSnap && receiverSnap.exists ? receiverSnap.data() : {};

  const txDoc = {
    requestId,
    transactionId,
    jobTitle: requestData?.title || '',
    senderEmail: senderEmail || null,
    senderName: senderProfile?.displayName || senderProfile?.name || senderProfile?.fullName || senderEmail || '',
    senderNumber: senderProfile?.phoneNumber || senderProfile?.phone || '',
    receiverEmail: receiverEmail || null,
    receiverName: receiverProfile?.displayName || receiverProfile?.name || receiverProfile?.fullName || receiverEmail || '',
    receiverNumber: receiverProfile?.phoneNumber || receiverProfile?.phone || '',
    amount: parseMoney(amount),
    commission: parseMoney(commission),
    netAmount: parseMoney(netAmount),
    paymentMethod: paymentMethod || 'Paystack',
    status: String(status || 'UNKNOWN').toUpperCase(),
    participants: [senderEmail, receiverEmail].filter(Boolean),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: new Date().toISOString(),
  };

  await adminDb.collection('transactions').add(txDoc);
}

async function refreshProviderReputation(providerEmail) {
  const normalizedEmail = String(providerEmail || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return;
  }

  const requestsSnapshot = await adminDb
    .collection('requests')
    .where('acceptedBy', '==', normalizedEmail)
    .get();

  let jobsCompleted = 0;
  let ratingCount = 0;
  let ratingSum = 0;

  requestsSnapshot.docs.forEach((docItem) => {
    const row = docItem.data() || {};

    if (row.paid || row.status === 'paid') {
      jobsCompleted += 1;
    }

    const ratingValue = Number(row.rating);
    if (Number.isFinite(ratingValue) && ratingValue >= 1 && ratingValue <= 5) {
      ratingCount += 1;
      ratingSum += ratingValue;
    }
  });

  const avgRating = ratingCount > 0
    ? parseFloat((ratingSum / ratingCount).toFixed(2))
    : null;

  await adminDb.collection('providers').doc(normalizedEmail).set({
    avgRating,
    jobsCompleted,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

async function markRequestEscrowFunded(requestId, paymentReference, extraFields = {}) {
  if (!requestId) {
    return { updated: false, reason: 'missing_request_id' };
  }

  const requestRef = adminDb.collection('requests').doc(requestId);
  const existingSnapshot = await requestRef.get();

  if (!existingSnapshot.exists) {
    return { updated: false, reason: 'request_not_found' };
  }

  const beforeData = existingSnapshot.data() || {};
  const currentStatus = beforeData?.status || (beforeData?.paid ? 'paid' : 'open');

  if (beforeData?.escrowFunded && beforeData?.escrowStatus === 'held' && currentStatus === 'in_progress') {
    return { updated: false, reason: 'already_escrow_funded', currentStatus };
  }

  if (currentStatus === 'paid') {
    return { updated: false, reason: 'already_paid', currentStatus };
  }

  if (currentStatus !== 'accepted') {
    return { updated: false, reason: 'invalid_status_transition', currentStatus };
  }

  if (!beforeData?.acceptedBy) {
    return { updated: false, reason: 'missing_assigned_provider', currentStatus };
  }

  const requestPrice = parseMoney(beforeData?.price);
  const commission = parseMoney(requestPrice * COMMISSION_RATE);
  const providerNet = parseMoney(requestPrice - commission);
  const now = new Date().toISOString();

  const payload = {
    status: 'in_progress',
    startedAt: beforeData?.startedAt || now,
    escrowFunded: true,
    escrowStatus: 'held',
    escrowAmount: requestPrice,
    escrowFundedAt: now,
    paymentReference,
    paymentStatus: 'success',
    paymentChannel: extraFields?.paymentChannel || null,
    gatewayResponse: extraFields?.gatewayResponse || null,
    commission,
    providerNet,
    commissionRate: COMMISSION_RATE,
    paid: false,
    ...extraFields,
  };

  await requestRef.set(payload, { merge: true });

  const title = beforeData?.title || `Request ${requestId}`;
  if (beforeData?.acceptedBy) {
    await notifyUser(
      beforeData.acceptedBy,
      `Customer has funded escrow for "${title}". You can now begin work.`,
      'Payment Received!',
      { screen: 'job-details', requestId, jobId: requestId }
    );
  }
  if (beforeData?.user) {
    await notifyUser(
      beforeData.user,
      `Escrow payment received for "${title}". Your job is now in progress.`,
      'Escrow Funded',
      { screen: 'job-details', requestId, jobId: requestId }
    );
  }

  await createTransactionRecordOnServer({
    requestId,
    requestData: { ...beforeData, ...payload },
    transactionId: paymentReference,
    amount: requestPrice,
    commission,
    netAmount: providerNet,
    status: 'HELD',
    paymentMethod: extraFields?.paymentChannel || 'Paystack',
  });

  await writeAuditLog({
    actorEmail: 'paystack@system',
    actorUid: 'paystack-system',
    eventType: 'escrow_funded',
    requestId,
    before: beforeData,
    after: { ...(beforeData || {}), ...payload },
    metadata: {
      paymentReference,
      source: extraFields?.source || 'paystack',
    },
  });

  return {
    updated: true,
    reason: 'escrow_funded',
    currentStatus,
  };
}

// ✅ HEALTH CHECK
app.get('/', (req, res) => {
  return sendSuccess(res, req, {
    message: 'Server is working',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: true,
    message: 'Server is working',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Rate limiters
const payInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, error: 'Too many payment requests, please try again later.' },
});

const payVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, error: 'Too many verification requests, please try again later.' },
});

// ✅ PAYSTACK INIT
app.post('/pay', payInitLimiter, requireAuth, async (req, res) => {
  try {
    const { email, amount, requestId } = req.body;
    const paystackSecret = getPaystackSecret();
    const normalizedAmount = Number(amount);

    // Basic email format validation to avoid sending arbitrary strings to Paystack
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailPattern.test(String(email)) || !normalizedAmount || normalizedAmount <= 0 || !requestId) {
      return sendError(res, req, 400, 'invalid_payment_payload', 'Missing or invalid payment fields');
    }

    // Prevent initiating payment on behalf of a different user
    if (String(email).toLowerCase() !== String(req.user.email || '').toLowerCase()) {
      return sendError(res, req, 403, 'email_mismatch', 'Payment email must match authenticated user');
    }

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const requestRef = adminDb.collection('requests').doc(String(requestId));
    const requestSnapshot = await requestRef.get();
    if (!requestSnapshot.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const requestData = requestSnapshot.data() || {};
    const ownerEmail = String(requestData.user || '').trim().toLowerCase();
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const requestStatus = String(requestData.status || (requestData.paid ? 'paid' : 'open')).toLowerCase();
    const requestPrice = parseMoney(requestData.price);

    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the customer who posted the job can fund escrow');
    }

    if (!requestData.acceptedBy) {
      return sendError(res, req, 409, 'provider_not_assigned', 'A provider must accept this job before payment');
    }

    if (requestData.escrowFunded || requestData.paid || ['in_progress', 'pending_confirmation', 'completed', 'paid', 'disputed', 'cancelled'].includes(requestStatus)) {
      return sendError(res, req, 409, 'escrow_already_funded', 'Escrow has already been funded for this request');
    }

    if (requestStatus !== 'accepted') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Escrow can only be funded after provider acceptance');
    }

    if (!requestPrice || requestPrice <= 0) {
      return sendError(res, req, 400, 'invalid_request_amount', 'Request amount is invalid');
    }

    if (Math.abs(parseMoney(normalizedAmount) - requestPrice) > 0.01) {
      return sendError(res, req, 400, 'amount_mismatch', 'Payment amount does not match request amount');
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(requestPrice * 100),
        callback_url: `${NORMALIZED_CALLBACK_BASE_URL}/pay-return?id=${encodeURIComponent(requestId)}`,
        metadata: { requestId, ownerEmail },
      }),
    });

    const data = await response.json();

    logger.info({ paystackStatus: data?.status, ref: data?.data?.reference || null }, 'PAYSTACK_INIT_RESPONSE');

    return res.status(response.status).json({
      requestId: req.requestId,
      ...data,
    });

  } catch (error) {
    logger.error({ err: error }, 'PAYMENT_INIT_ERROR');
    return sendError(res, req, 500, 'payment_init_failed', 'Payment init failed');
  }
});

app.post('/pay/verify', payVerifyLimiter, requireAuth, async (req, res) => {
  try {
    const { reference } = req.body;
    const paystackSecret = getPaystackSecret();

    if (!reference) {
      return sendError(res, req, 400, 'missing_reference', 'Missing reference');
    }

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    logger.info({ paystackStatus: data?.status, txnStatus: data?.data?.status || null, ref: data?.data?.reference || null }, 'PAYSTACK_VERIFY_RESPONSE');

    let paymentUpdate = {
      updated: false,
      reason: 'verification_not_successful',
    };


    if (data?.status && data?.data?.status === 'success') {
      const requestId = data?.data?.metadata?.requestId;
      const requestSnapshot = requestId
        ? await adminDb.collection('requests').doc(String(requestId)).get()
        : null;

      if (!requestSnapshot || !requestSnapshot.exists) {
        return sendError(res, req, 404, 'request_not_found', 'Request not found for this payment reference');
      }

      const requestData = requestSnapshot.data() || {};
      const actorEmail = String(req.user?.email || '').trim().toLowerCase();
      const ownerEmail = String(requestData.user || '').trim().toLowerCase();

      if (!ownerEmail || ownerEmail !== actorEmail) {
        return sendError(res, req, 403, 'owner_access_required', 'Only the customer can verify and apply this payment');
      }

      paymentUpdate = await markRequestEscrowFunded(requestId, data?.data?.reference, {
        paymentChannel: data?.data?.channel || null,
        gatewayResponse: data?.data?.gateway_response || null,
      });

      if (!paymentUpdate.updated) {
        logger.warn({ paymentUpdate }, 'PAYMENT_UPDATE_SKIPPED');
      } else {
        // Fetch transaction and user info for email
        try {
          const adminDb = require('firebase-admin').firestore();
          const requestId = data?.data?.metadata?.requestId;
          const requestSnap = await adminDb.collection('requests').doc(requestId).get();
          const request = requestSnap.exists ? requestSnap.data() : null;
          if (request) {
            const senderEmail = request.user;
            const receiverEmail = request.acceptedBy;
            // Fetch user profiles
            const senderSnap = senderEmail ? await adminDb.collection('users').doc(senderEmail).get() : null;
            const receiverSnap = receiverEmail ? await adminDb.collection('users').doc(receiverEmail).get() : null;
            const sender = senderSnap && senderSnap.exists ? senderSnap.data() : {};
            const receiver = receiverSnap && receiverSnap.exists ? receiverSnap.data() : {};
            const txData = {
              senderEmail,
              senderName: sender.displayName || sender.fullName || senderEmail || '',
              senderNumber: sender.phoneNumber || '',
              receiverEmail,
              receiverName: receiver.displayName || receiver.fullName || receiverEmail || '',
              receiverNumber: receiver.phoneNumber || '',
              jobTitle: request.title || '',
              transactionId: data?.data?.reference,
              amount: request.price,
              commission: request.commission,
              netAmount: request.providerNet,
              paymentMethod: data?.data?.channel || 'Paystack',
              timestamp: request.escrowFundedAt || new Date().toISOString(),
              status: 'HELD',
            };
            await sendPaymentReceiptEmail(txData);
          }
        } catch (err) {
          logger.error({ err }, 'SEND_PAYMENT_RECEIPT_EMAIL_ERROR');
        }
      }
    }

    return res.status(response.status).json({
      requestId: req.requestId,
      ...data,
      paymentUpdate,
    });
  } catch (error) {
    logger.error({ err: error }, 'PAYMENT_VERIFY_ERROR');
    return sendError(res, req, 500, 'payment_verification_failed', 'Payment verification failed');
  }
});

// Award GHS 5 signup bonus to a new user who registered with a referral code
app.post('/referral/signup-bonus', requireAuth, async (req, res) => {
  try {
    const newUserEmail = String(req.user?.email || '').trim().toLowerCase();
    if (!newUserEmail) {
      return sendError(res, req, 400, 'missing_email', 'User email required');
    }

    const userDoc = await adminDb.collection('users').doc(newUserEmail).get();
    const userData = userDoc.data() || {};

    // Only award once (guard against double-claims)
    if (userData.signupBonusAwarded) {
      return res.json({ ok: true, alreadyAwarded: true });
    }

    const referredBy = String(userData.referredBy || '').trim().toLowerCase();
    if (!referredBy) {
      return sendError(res, req, 400, 'no_referrer', 'No referral code was used at signup');
    }

    // Award GHS 5 to the new user
    await adminDb.collection('users').doc(newUserEmail).update({
      walletBalance: admin.firestore.FieldValue.increment(5),
      signupBonusAwarded: true,
    });

    // Write in-app notification for new user
    await adminDb.collection('notifications').add({
      userId: newUserEmail,
      title: 'Welcome Bonus!',
      body: 'You earned GHS 5 wallet credit for joining ConnectHub with a referral code!',
      type: 'signup_bonus',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send push notification if token exists
    const pushToken = userData.pushToken;
    if (pushToken) {
      await sendPushNotification(pushToken, 'Welcome Bonus!', 'You earned GHS 5 for joining with a referral code!').catch(() => {});
    }

    return res.json({ ok: true, bonus: 5 });
  } catch (err) {
    logger.error({ err }, 'REFERRAL_SIGNUP_BONUS_ERROR');
    return sendError(res, req, 500, 'signup_bonus_failed', 'Could not award signup bonus');
  }
});

app.post('/wallet/withdraw', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const amount = parseMoney(req.body?.amount);
    const accountName = String(req.body?.accountName || '').trim();
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const network = String(req.body?.network || '').trim().toUpperCase();

    if (!actorEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Could not determine authenticated user');
    }

    if (amount < 10) {
      return sendError(res, req, 400, 'invalid_withdrawal_amount', 'Minimum withdrawal amount is GHS 10.00');
    }

    if (!accountName || !phoneNumber || !network) {
      return sendError(res, req, 400, 'missing_momo_details', 'accountName, phoneNumber, and network are required');
    }

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const userRef = adminDb.collection('users').doc(actorEmail);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const walletBalance = parseMoney(userData.walletBalance || 0);

    if (String(userData.kycStatus || '').trim().toLowerCase() !== 'verified') {
      return sendError(res, req, 403, 'kyc_required', 'KYC verification is required before withdrawals');
    }

    if (amount > walletBalance) {
      return sendError(res, req, 409, 'insufficient_wallet_balance', 'Insufficient wallet balance');
    }

    const recipientResponse = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'mobile_money',
        name: accountName,
        mobile_number: phoneNumber,
        network,
        currency: 'GHS',
      }),
    });
    const recipientData = await recipientResponse.json();
    const recipientCode = recipientData?.data?.recipient_code;

    if (!recipientResponse.ok || !recipientData?.status || !recipientCode) {
      return sendError(res, req, 400, 'recipient_creation_failed', 'Could not create Mobile Money recipient', recipientData);
    }

    const reference = `wd_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const transferResponse = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(amount * 100),
        recipient: recipientCode,
        reason: `ConnectHub wallet withdrawal (${actorEmail})`,
        reference,
      }),
    });
    const transferData = await transferResponse.json();
    const transferCode = transferData?.data?.transfer_code || null;

    if (!transferResponse.ok || !transferData?.status) {
      return sendError(res, req, 400, 'withdrawal_transfer_failed', 'Withdrawal transfer could not be started', transferData);
    }

    const nowIso = new Date().toISOString();
    await userRef.set({
      walletBalance: admin.firestore.FieldValue.increment(-amount),
      updatedAt: nowIso,
      lastWithdrawalAccountName: accountName,
      lastWithdrawalMomoNumber: `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-3)}`,
      lastWithdrawalNetwork: network,
    }, { merge: true });

    await adminDb.collection('wallet_withdrawals').doc(reference).set({
      reference,
      transferCode,
      userEmail: actorEmail,
      amount,
      currency: 'GHS',
      status: 'PENDING',
      accountName,
      momoNumberMasked: `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-3)}`,
      network,
      recipientCode,
      createdAt: nowIso,
      updatedAt: nowIso,
      walletDebited: true,
      refunded: false,
    }, { merge: true });

    await adminDb.collection('transactions').add({
      transactionId: reference,
      requestId: null,
      type: 'withdrawal',
      jobTitle: 'Wallet Withdrawal',
      senderEmail: actorEmail,
      senderName: actorEmail,
      receiverEmail: null,
      receiverName: accountName,
      amount,
      commission: 0,
      netAmount: amount,
      paymentMethod: 'Paystack Transfer',
      status: 'PENDING',
      participants: [actorEmail],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: nowIso,
      transferCode,
      momoNetwork: network,
    });

    await notifyUser(
      actorEmail,
      `Your withdrawal of GHS ${amount.toFixed(2)} is being processed.`,
      'Withdrawal Initiated',
      { screen: 'wallet' }
    );

    return sendSuccess(res, req, {
      message: 'Withdrawal initiated successfully',
      data: {
        reference,
        transferCode,
        amount,
        status: 'PENDING',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_WITHDRAWAL_ERROR');
    return sendError(res, req, 500, 'wallet_withdrawal_failed', 'Could not initiate withdrawal');
  }
});

app.post('/subscription/initiate', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim();
    const plan = normalizePlan(req.body?.plan);
    const platform = String(req.body?.platform || '').trim().toLowerCase();
    const planConfig = SUBSCRIPTION_PLAN_CONFIG[plan];

    if (!actorEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Could not determine authenticated user');
    }

    if (!email || email !== actorEmail) {
      return sendError(res, req, 403, 'email_mismatch', 'Email must match authenticated user');
    }

    if (!planConfig || plan === 'free') {
      return sendError(res, req, 400, 'invalid_subscription_plan', 'Plan must be pro or premium');
    }

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(planConfig.amount * 100),
        currency: 'GHS',
        callback_url: `${trimTrailingSlash(PUBLIC_SERVER_BASE_URL)}/subscription/verify?plan=${encodeURIComponent(plan)}&email=${encodeURIComponent(email)}&platform=${encodeURIComponent(platform || 'web')}`,
        metadata: {
          type: 'subscription',
          plan,
          email,
          displayName,
          platform: platform || 'web',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok || !data?.status || !data?.data?.authorization_url) {
      return sendError(res, req, response.status || 400, 'subscription_init_failed', data?.message || 'Could not initialize subscription payment', data);
    }

    return sendSuccess(res, req, {
      message: 'Subscription checkout initialized',
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      data: {
        authorization_url: data.data.authorization_url,
        reference: data.data.reference,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_INIT_ERROR');
    return sendError(res, req, 500, 'subscription_init_failed', 'Could not initialize subscription payment');
  }
});

app.get('/subscription/verify', async (req, res) => {
  try {
    const plan = normalizePlan(req.query?.plan);
    const platform = String(req.query?.platform || '').trim().toLowerCase();
    const emailParam = String(req.query?.email || '').trim().toLowerCase();
    const reference = String(req.query?.reference || req.query?.trxref || '').trim();

    if (!reference) {
      return res.redirect(resolveSubscriptionRedirectUrl('failed', plan, platform));
    }

    const verification = await verifyPaystackTransaction(reference);
    if (!verification.ok) {
      return res.redirect(resolveSubscriptionRedirectUrl('failed', plan, platform));
    }

    const paystackData = verification.data?.data || {};
    const metadata = paystackData?.metadata || {};
    const metadataPlan = normalizePlan(metadata?.plan || plan);
    const metadataEmail = String(metadata?.email || emailParam || paystackData?.customer?.email || '').trim().toLowerCase();

    if (!metadataEmail || !['pro', 'premium'].includes(metadataPlan)) {
      return res.redirect(resolveSubscriptionRedirectUrl('failed', metadataPlan, platform));
    }

    await applySubscriptionForUser(metadataEmail, metadataPlan, reference, 'subscription_verify_callback');

    await adminDb.collection('users').doc(metadataEmail).set({
      subscriptionCustomerCode: paystackData?.customer?.customer_code || null,
      subscriptionCustomerEmail: paystackData?.customer?.email || metadataEmail,
      subscriptionAuthorizationCode: paystackData?.authorization?.authorization_code || null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.redirect(resolveSubscriptionRedirectUrl('success', metadataPlan, platform || metadata?.platform));
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_VERIFY_CALLBACK_ERROR');
    return res.redirect(resolveSubscriptionRedirectUrl('failed', req.query?.plan, req.query?.platform));
  }
});

app.post('/subscription/verify', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const reference = String(req.body?.reference || '').trim();

    if (!actorEmail || !reference) {
      return sendError(res, req, 400, 'invalid_subscription_verify_payload', 'reference is required');
    }

    const verification = await verifyPaystackTransaction(reference);
    if (!verification.ok) {
      return sendError(res, req, 400, 'subscription_payment_not_successful', 'Subscription payment was not successful', verification.data);
    }

    const metadata = verification.data?.data?.metadata || {};
    const plan = normalizePlan(metadata?.plan);
    const subscriberEmail = String(metadata?.email || actorEmail).trim().toLowerCase();

    if (subscriberEmail !== actorEmail) {
      return sendError(res, req, 403, 'subscription_owner_access_required', 'Subscription email does not match authenticated user');
    }

    const subscriptionUpdate = await applySubscriptionForUser(actorEmail, plan, reference, 'subscription_verify');

    await adminDb.collection('users').doc(actorEmail).set({
      subscriptionCustomerCode: verification.data?.data?.customer?.customer_code || null,
      subscriptionCustomerEmail: verification.data?.data?.customer?.email || actorEmail,
      subscriptionAuthorizationCode: verification.data?.data?.authorization?.authorization_code || null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return sendSuccess(res, req, {
      message: 'Subscription activated successfully',
      data: verification.data,
      subscriptionUpdate,
    });
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_VERIFY_ERROR');
    return sendError(res, req, 500, 'subscription_verify_failed', 'Could not verify subscription payment');
  }
});

app.post('/subscription/cancel', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!actorEmail || !email || actorEmail !== email) {
      return sendError(res, req, 403, 'email_mismatch', 'Email must match authenticated user');
    }

    const nowIso = new Date().toISOString();
    await adminDb.collection('users').doc(email).set({
      subscriptionPlan: 'basic',
      subscriptionBadge: 'Basic',
      subscriptionStatus: 'cancelled',
      subscriptionExpiry: null,
      subscriptionRenewalDate: null,
      subscriptionUpdatedAt: nowIso,
      updatedAt: nowIso,
    }, { merge: true });

    await adminDb.collection('notifications').add({
      user: email,
      userId: email,
      title: 'Subscription Cancelled',
      body: 'Your subscription has been cancelled. You will keep your current benefits until the end of the billing period.',
      type: 'subscription_cancelled',
      read: false,
      text: 'Subscription cancelled',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    });

    await notifyUser(
      email,
      'Your subscription has been cancelled. You will keep your current benefits until the end of the billing period.',
      'Subscription Cancelled',
      { screen: 'subscription' }
    );

    if (isEmailConfigured()) {
      try {
        await emailTransporter.sendMail({
          from: emailFrom,
          to: email,
          subject: 'ConnectHub - Subscription Cancelled',
          html: `
            <p>Your subscription has been cancelled.</p>
            <p>You will keep your current benefits until the end of the billing period.</p>
            <p>You can reactivate Pro or Premium at any time from the Subscription screen.</p>
          `,
        });
      } catch (error) {
        logger.warn({ err: error, email }, 'SUBSCRIPTION_CANCEL_EMAIL_FAILED');
      }
    }

    return sendSuccess(res, req, {
      message: 'Subscription cancelled successfully',
      data: {
        subscriptionPlan: 'basic',
        subscriptionStatus: 'cancelled',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_CANCEL_ERROR');
    return sendError(res, req, 500, 'subscription_cancel_failed', 'Could not cancel subscription');
  }
});

app.post('/paystack/webhook', async (req, res) => {
  try {
    const paystackSecret = getPaystackSecret();
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    if (!paystackSecret) {
      return sendError(res, req, 500, 'webhook_configuration_missing', 'Server webhook configuration missing');
    }

    const expectedSignature = crypto
      .createHmac('sha512', paystackSecret)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      return sendError(res, req, 401, 'invalid_paystack_signature', 'Invalid signature');
    }

    const event = req.body;
    logger.info({ event: event?.event, ref: event?.data?.reference || null }, 'PAYSTACK_WEBHOOK_RECEIVED');

    if (event?.event === 'charge.success' && event?.data?.status === 'success') {
      const metadata = event?.data?.metadata || {};
      if (metadata?.type === 'subscription') {
        const subscriberEmail = String(metadata?.email || event?.data?.customer?.email || '').trim().toLowerCase();
        const plan = normalizePlan(metadata?.plan);
        const subscriptionUpdate = await applySubscriptionForUser(subscriberEmail, plan, event?.data?.reference, 'paystack_webhook');
        if (!subscriptionUpdate.updated) {
          logger.warn({ subscriptionUpdate }, 'WEBHOOK_SUBSCRIPTION_UPDATE_SKIPPED');
        } else {
          await adminDb.collection('users').doc(subscriberEmail).set({
            subscriptionCustomerCode: event?.data?.customer?.customer_code || null,
            subscriptionCustomerEmail: event?.data?.customer?.email || subscriberEmail,
            subscriptionAuthorizationCode: event?.data?.authorization?.authorization_code || null,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } else {
        const paymentUpdate = await markRequestEscrowFunded(event?.data?.metadata?.requestId, event?.data?.reference, {
          paymentChannel: event?.data?.channel || null,
          gatewayResponse: event?.data?.gateway_response || null,
          source: 'paystack_webhook',
        });

        if (!paymentUpdate.updated) {
          logger.warn({ paymentUpdate }, 'WEBHOOK_PAYMENT_UPDATE_SKIPPED');
        }
      }
    }

    if (event?.event === 'transfer.success' || event?.event === 'transfer.failed' || event?.event === 'transfer.reversed') {
      const reference = String(event?.data?.reference || '').trim();
      if (reference) {
        const withdrawalRef = adminDb.collection('wallet_withdrawals').doc(reference);
        const withdrawalSnap = await withdrawalRef.get();

        if (withdrawalSnap.exists) {
          const withdrawalData = withdrawalSnap.data() || {};
          const status = event?.event === 'transfer.success' ? 'SUCCESS' : 'FAILED';
          const nowIso = new Date().toISOString();

          await withdrawalRef.set({
            status,
            updatedAt: nowIso,
            transferStatusEvent: event?.event,
            transferStatusMessage: event?.data?.status || null,
          }, { merge: true });

          const txSnapshot = await adminDb.collection('transactions').where('transactionId', '==', reference).limit(3).get();
          await Promise.all(txSnapshot.docs.map((txDoc) => txDoc.ref.set({ status, updatedAt: nowIso }, { merge: true })));

          const userEmail = String(withdrawalData.userEmail || '').trim().toLowerCase();
          if (status === 'SUCCESS') {
            await notifyUser(
              userEmail,
              `Your withdrawal of GHS ${parseMoney(withdrawalData.amount).toFixed(2)} was completed successfully.`,
              'Withdrawal Completed',
              { screen: 'wallet' }
            );
          } else {
            const alreadyRefunded = withdrawalData.refunded === true;
            if (!alreadyRefunded && userEmail && parseMoney(withdrawalData.amount) > 0) {
              await adminDb.collection('users').doc(userEmail).set({
                walletBalance: admin.firestore.FieldValue.increment(parseMoney(withdrawalData.amount)),
                updatedAt: nowIso,
              }, { merge: true });

              await withdrawalRef.set({
                refunded: true,
                refundedAt: nowIso,
              }, { merge: true });
            }

            await notifyUser(
              userEmail,
              `Your withdrawal failed and GHS ${parseMoney(withdrawalData.amount).toFixed(2)} has been returned to your wallet.`,
              'Withdrawal Failed',
              { screen: 'wallet' }
            );
          }
        }
      }
    }

    return sendSuccess(res, req, { received: true });
  } catch (error) {
    logger.error({ err: error }, 'WEBHOOK_ERROR');
    return sendError(res, req, 500, 'webhook_processing_failed', 'Webhook processing failed');
  }
});

app.post('/jobs/:id/accept', requireAuth, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const actorEmail = String(req.user?.email || '').toLowerCase();

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = snap.data() || {};
    const actorProfileSnap = await adminDb.collection('users').doc(actorEmail).get().catch(() => null);
    const actorProfile = actorProfileSnap && actorProfileSnap.exists ? (actorProfileSnap.data() || {}) : {};

    if (actorProfile.banned === true) {
      return sendError(res, req, 403, 'account_banned', 'Your account has been suspended. Contact support for assistance.');
    }

    const actorPlan = normalizePlan(actorProfile.subscriptionPlan || 'free');
    const actorPlanConfig = SUBSCRIPTION_PLAN_CONFIG[actorPlan] || SUBSCRIPTION_PLAN_CONFIG.free;
    const actorSubscriptionStatus = String(actorProfile.subscriptionStatus || '').trim().toLowerCase();
    const actorSubscriptionExpiryMs = toMillis(actorProfile.subscriptionExpiry);
    const nowMs = Date.now();

    const monthlyLimitPayload = {
      error: 'monthly_limit_reached',
      message: 'You have reached your 5 job limit for this month. Upgrade to Pro for unlimited job accepts.',
      upgradeUrl: '/subscription',
    };

    if (['pro', 'premium'].includes(actorPlan)) {
      const isActivePlan = actorSubscriptionStatus === 'active' && actorSubscriptionExpiryMs > nowMs;
      if (!isActivePlan) {
        await downgradeUserToBasic(actorEmail, 'expired');
        return res.status(403).json({
          status: false,
          requestId: req.requestId,
          code: 'monthly_limit_reached',
          ...monthlyLimitPayload,
        });
      }
    }

    if (actorPlan === 'free' || Number.isFinite(actorPlanConfig.acceptLimit)) {
      const acceptedCount = await countProviderMonthlyAccepts(actorEmail);
      if (acceptedCount >= actorPlanConfig.acceptLimit) {
        return res.status(403).json({
          status: false,
          requestId: req.requestId,
          code: 'monthly_limit_reached',
          ...monthlyLimitPayload,
        });
      }
    }

    if (beforeData.acceptedBy && String(beforeData.acceptedBy).toLowerCase() !== actorEmail) {
      return sendError(res, req, 409, 'request_already_accepted', 'This request is already accepted by another provider');
    }

    const currentStatus = beforeData.status || 'open';
    if (!['open', 'accepted'].includes(currentStatus)) {
      return sendError(res, req, 409, 'invalid_status_transition', 'Only open requests can be accepted');
    }

    const patch = {
      acceptedBy: actorEmail,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      escrowFunded: false,
      escrowStatus: 'awaiting_payment',
      paymentHold: false,
      paid: false,
    };

    await requestRef.set(patch, { merge: true });

    if (beforeData.user) {
      const providerSnap = await adminDb.collection('users').doc(actorEmail).get().catch(() => null);
      const providerName = providerSnap && providerSnap.exists
        ? (providerSnap.data()?.name || providerSnap.data()?.displayName || actorEmail)
        : actorEmail;
      await notifyUser(
        beforeData.user,
        `${providerName} has accepted your job: ${beforeData.title || requestId}`,
        'Job Accepted!',
        { screen: 'job-details', requestId, jobId: requestId }
      );
    }

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'provider_accepted_job',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
    });

    return sendSuccess(res, req, {
      message: 'Request accepted successfully',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'JOB_ACCEPT_ERROR');
    return sendError(res, req, 500, 'job_accept_failed', 'Could not accept request');
  }
});

app.post('/jobs/:id/mark-complete', requireAuth, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const actorEmail = String(req.user?.email || '').toLowerCase();

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = snap.data() || {};
    const acceptedBy = String(beforeData.acceptedBy || '').toLowerCase();

    if (!acceptedBy || acceptedBy !== actorEmail) {
      return sendError(res, req, 403, 'provider_access_required', 'Only the assigned provider can mark this job complete');
    }

    if (beforeData.status !== 'in_progress') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Job must be in progress to mark complete');
    }

    const patch = {
      status: 'pending_confirmation',
      completedAt: new Date().toISOString(),
    };

    await requestRef.set(patch, { merge: true });

    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `${beforeData.acceptedBy || 'Your provider'} marked your job as complete. Please confirm.`,
        'Work Completed!',
        { screen: 'confirm-completion', requestId, jobId: requestId }
      );
    }

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'provider_marked_complete',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
    });

    return sendSuccess(res, req, {
      message: 'Job marked complete and pending confirmation',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'JOB_MARK_COMPLETE_ERROR');
    return sendError(res, req, 500, 'job_mark_complete_failed', 'Could not mark job complete');
  }
});

app.post('/jobs/:id/remind-customer', requireAuth, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const actorEmail = String(req.user?.email || '').toLowerCase();

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const data = snap.data() || {};
    const acceptedBy = String(data.acceptedBy || '').toLowerCase();
    const customerEmail = String(data.user || '').toLowerCase();

    if (!acceptedBy || acceptedBy !== actorEmail) {
      return sendError(res, req, 403, 'provider_access_required', 'Only the assigned provider can send reminders');
    }

    if (data.paid === true || data.escrowFunded === true) {
      return sendError(res, req, 409, 'escrow_already_funded', 'Escrow has already been funded for this job');
    }

    if (String(data.status || '').toLowerCase() !== 'accepted') {
      return sendError(res, req, 409, 'invalid_status_for_reminder', 'Reminders can only be sent while awaiting escrow funding');
    }

    if (!customerEmail) {
      return sendError(res, req, 400, 'missing_customer', 'Missing customer email');
    }

    await notifyUser(
      customerEmail,
      `Your provider is waiting for escrow funding on "${data.title || requestId}". Please fund escrow to continue.`,
      'Escrow Funding Reminder',
      { screen: 'pay', requestId, jobId: requestId }
    );

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'provider_reminded_customer_to_fund',
      requestId,
      before: data,
      after: data,
    });

    return sendSuccess(res, req, {
      message: 'Reminder sent to customer',
      data: { id: requestId, customerEmail },
    });
  } catch (error) {
    logger.error({ err: error }, 'JOB_REMIND_CUSTOMER_ERROR');
    return sendError(res, req, 500, 'job_remind_customer_failed', 'Could not send reminder');
  }
});

app.post('/jobs/:id/confirm-completion', requireAuth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const actorEmail = String(req.user?.email || '').toLowerCase();
    const numericRating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return sendError(res, req, 400, 'invalid_rating', 'Rating must be an integer between 1 and 5');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();

    if (!snap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = snap.data() || {};
    const ownerEmail = String(beforeData.user || '').toLowerCase();

    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the job owner can confirm completion');
    }

    if (beforeData.status !== 'pending_confirmation') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Job is not pending customer confirmation');
    }

    const completionPatch = {
      status: 'completed',
      completionConfirmedAt: new Date().toISOString(),
      completionConfirmedBy: actorEmail,
      rating: numericRating,
      review: comment,
      ratedAt: new Date().toISOString(),
    };

    await requestRef.set(completionPatch, { merge: true });

    const escrowReference = beforeData.paymentReference || `escrow_release_${requestId}_${Date.now()}`;
    const paymentUpdate = await markRequestPaid(requestId, escrowReference, {
      paymentChannel: 'escrow_release',
      gatewayResponse: 'Escrow released after customer confirmation',
      source: 'customer_confirmation',
    });

    if (!paymentUpdate.updated) {
      return sendError(res, req, 409, 'payment_release_failed', 'Could not release escrow payment', paymentUpdate);
    }

    if (beforeData.acceptedBy) {
      await refreshProviderReputation(beforeData.acceptedBy);
    }

    if (beforeData.acceptedBy) {
      await notifyUser(
        beforeData.acceptedBy,
        `Your payment for ${beforeData.title || requestId} has been released to your wallet.`,
        'Payment Released!',
        { screen: 'wallet', requestId, jobId: requestId }
      );
    }
    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Job "${beforeData.title || requestId}" completed successfully. Payment has been released.`,
        'Payment Released',
        { screen: 'job-details', requestId, jobId: requestId }
      );
    }

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'customer_confirmed_completion',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...completionPatch, status: 'paid' },
      metadata: {
        rating: numericRating,
        paymentReference: escrowReference,
      },
    });

    return sendSuccess(res, req, {
      message: 'Job confirmed and payment released',
      data: {
        id: requestId,
        status: 'paid',
        paymentReference: escrowReference,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'CONFIRM_COMPLETION_ERROR');
    return sendError(res, req, 500, 'confirm_completion_failed', 'Could not confirm completion');
  }
});

app.post('/jobs/:id/dispute', requireAuth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const actorEmail = String(req.user?.email || '').toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    const comment = String(req.body?.comment || '').trim();
    const evidenceUrls = Array.isArray(req.body?.evidenceUrls) ? req.body.evidenceUrls.filter((item) => typeof item === 'string') : [];

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    if (!reason) {
      return sendError(res, req, 400, 'missing_dispute_reason', 'Dispute reason is required');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();

    if (!snap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = snap.data() || {};
    const ownerEmail = String(beforeData.user || '').toLowerCase();

    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the job owner can open a dispute');
    }

    if (beforeData.status !== 'pending_confirmation') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Job is not pending customer confirmation');
    }

    const patch = {
      status: 'disputed',
      disputeOpenedAt: new Date().toISOString(),
      disputeOpenedBy: actorEmail,
      disputeReason: reason,
      disputeComment: comment,
      disputeEvidenceUrls: evidenceUrls,
      paymentHold: true,
    };

    await requestRef.set(patch, { merge: true });

    const disputeDoc = {
      requestId,
      title: beforeData.title || null,
      customerEmail: beforeData.user || null,
      providerEmail: beforeData.acceptedBy || null,
      reason,
      comment,
      evidenceUrls,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await adminDb.collection('disputes').add(disputeDoc);

    if (beforeData.acceptedBy) {
      await notifyUser(
        beforeData.acceptedBy,
        `A dispute was opened for job "${beforeData.title || requestId}". Payment is on hold.`,
        'Dispute Opened',
        { screen: 'job-details', requestId, jobId: requestId }
      );
    }
    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Your dispute for "${beforeData.title || requestId}" has been submitted for admin review.`,
        'Dispute Submitted',
        { screen: 'job-details', requestId, jobId: requestId }
      );
    }
    for (const adminEmail of ADMIN_EMAILS) {
      await notifyUser(
        adminEmail,
        `A dispute was opened for job: ${beforeData.title || requestId}`,
        'New Dispute!',
        { screen: 'admin', requestId, jobId: requestId }
      );
    }

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'customer_opened_dispute',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
      metadata: {
        reason,
        evidenceCount: evidenceUrls.length,
      },
    });

    return sendSuccess(res, req, {
      message: 'Dispute opened successfully',
      data: {
        id: requestId,
        status: 'disputed',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'OPEN_DISPUTE_ERROR');
    return sendError(res, req, 500, 'open_dispute_failed', 'Could not open dispute');
  }
});

// ✅ PORTFOLIO ENDPOINTS ─────────────────────────────────────────────────────────

/**
 * POST /portfolio
 * Upload a new portfolio item for the authenticated provider
 */
app.post('/portfolio', requireAuth, async (req, res) => {
  try {
    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    const image = String(req.body?.image || '').trim();
    const description = String(req.body?.description || '').trim();

    if (!image) {
      return sendError(res, req, 400, 'missing_image', 'image (base64 data URL) is required');
    }

    if (!description) {
      return sendError(res, req, 400, 'missing_description', 'description is required');
    }

    if (description.length > 500) {
      return sendError(res, req, 400, 'description_too_long', 'description must be 500 characters or less');
    }

    // Generate item ID
    const itemId = adminDb.collection('_').doc().id;

    // Parse base64 image and upload to Storage
    const matches = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return sendError(res, req, 400, 'invalid_image_format', 'image must be a valid data URL');
    }

    const mimeType = matches[1];
    const imageBuffer = Buffer.from(matches[2], 'base64');

    const storagePath = `portfolio/${userEmail}/${itemId}/image.jpg`;
    const file = adminStorage.file(storagePath);

    await file.save(imageBuffer, {
      metadata: {
        contentType: mimeType,
      },
    });

    const imageUrl = `https://storage.googleapis.com/${adminStorage.bucket.name}/${storagePath}`;

    // Create Firestore document
    await adminDb
      .collection('portfolios')
      .doc(userEmail)
      .collection('items')
      .doc(itemId)
      .set({
        imageUrl,
        description,
        active: true,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return sendSuccess(res, req, {
      message: 'Portfolio item uploaded successfully',
      data: {
        itemId,
        imageUrl,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'PORTFOLIO_UPLOAD_ERROR');
    return sendError(res, req, 500, 'portfolio_upload_failed', 'Could not upload portfolio item');
  }
});

/**
 * DELETE /portfolio/:itemId
 * Delete a portfolio item for the authenticated provider
 */
app.delete('/portfolio/:itemId', requireAuth, async (req, res) => {
  try {
    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    const itemId = String(req.params?.itemId || '').trim();

    if (!itemId) {
      return sendError(res, req, 400, 'missing_item_id', 'itemId is required');
    }

    const itemRef = adminDb.collection('portfolios').doc(userEmail).collection('items').doc(itemId);
    const itemSnap = await itemRef.get();

    if (!itemSnap.exists) {
      return sendError(res, req, 404, 'item_not_found', 'Portfolio item not found');
    }

    // Soft delete (mark as inactive)
    await itemRef.update({
      active: false,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return sendSuccess(res, req, {
      message: 'Portfolio item deleted',
      data: { itemId },
    });
  } catch (error) {
    logger.error({ err: error }, 'PORTFOLIO_DELETE_ERROR');
    return sendError(res, req, 500, 'portfolio_delete_failed', 'Could not delete portfolio item');
  }
});

/**
 * GET /portfolio/:email
 * Fetch portfolio items for a specific provider (public endpoint)
 */
app.get('/portfolio/:email', async (req, res) => {
  try {
    const email = String(req.params?.email || '').trim().toLowerCase();

    if (!email) {
      return sendError(res, req, 400, 'missing_email', 'email is required');
    }

    const snap = await adminDb
      .collection('portfolios')
      .doc(email)
      .collection('items')
      .where('active', '==', true)
      .orderBy('uploadedAt', 'desc')
      .get();

    const items = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      uploadedAt: doc.data().uploadedAt?.toDate?.(),
    }));

    return sendSuccess(res, req, {
      message: 'Portfolio retrieved',
      data: { items },
    });
  } catch (error) {
    logger.error({ err: error }, 'PORTFOLIO_FETCH_ERROR');
    return sendError(res, req, 500, 'portfolio_fetch_failed', 'Could not fetch portfolio');
  }
});

// ── Admin: Ban / Unban user ────────────────────────────────────────────────
app.post('/admin/users/:email/ban', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = String(req.params.email || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    const actorEmail = String(req.user?.email || '').toLowerCase();

    if (!targetEmail) return sendError(res, req, 400, 'missing_email', 'email is required');
    if (isAdminEmail(targetEmail)) return sendError(res, req, 403, 'cannot_ban_admin', 'Cannot ban an admin account');

    const nowIso = new Date().toISOString();
    await adminDb.collection('users').doc(targetEmail).set({
      banned: true,
      bannedAt: nowIso,
      bannedBy: actorEmail,
      bannedReason: reason || 'Suspended by admin',
      updatedAt: nowIso,
    }, { merge: true });

    await writeAuditLog({ actorEmail, eventType: 'user_banned', metadata: { targetEmail, reason } });
    await writeNotification(targetEmail, 'Your account has been suspended. Contact support for assistance.');

    return sendSuccess(res, req, { message: `${targetEmail} has been banned.` });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_BAN_ERROR');
    return sendError(res, req, 500, 'ban_failed', 'Could not ban user');
  }
});

app.post('/admin/users/:email/unban', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = String(req.params.email || '').trim().toLowerCase();
    const actorEmail = String(req.user?.email || '').toLowerCase();

    if (!targetEmail) return sendError(res, req, 400, 'missing_email', 'email is required');

    const nowIso = new Date().toISOString();
    await adminDb.collection('users').doc(targetEmail).set({
      banned: false,
      unbannedAt: nowIso,
      unbannedBy: actorEmail,
      updatedAt: nowIso,
    }, { merge: true });

    await writeAuditLog({ actorEmail, eventType: 'user_unbanned', metadata: { targetEmail } });
    await writeNotification(targetEmail, 'Your account suspension has been lifted. Welcome back!');

    return sendSuccess(res, req, { message: `${targetEmail} has been unbanned.` });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_UNBAN_ERROR');
    return sendError(res, req, 500, 'unban_failed', 'Could not unban user');
  }
});

// ── Admin: Analytics ──────────────────────────────────────────────────────
app.get('/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [requestsSnap, usersSnap, transactionsSnap] = await Promise.all([
      adminDb.collection('requests').get(),
      adminDb.collection('users').get(),
      adminDb.collection('transactions').get(),
    ]);

    const requests = requestsSnap.docs.map((d) => d.data());
    const users = usersSnap.docs.map((d) => d.data());
    const transactions = transactionsSnap.docs.map((d) => d.data());

    const totalJobs = requests.length;
    const paidJobs = requests.filter((r) => r.paid || r.status === 'paid').length;
    const openJobs = requests.filter((r) => !r.paid && (r.status === 'open' || !r.status)).length;
    const activeJobs = requests.filter((r) => ['accepted', 'in_progress', 'pending_confirmation'].includes(r.status || '')).length;
    const disputedJobs = requests.filter((r) => r.status === 'disputed').length;

    const totalRevenue = requests.reduce((sum, r) => sum + parseMoney(r.commission || 0), 0);
    const totalEscrow = requests.reduce((sum, r) => (r.escrowFunded && r.escrowStatus === 'held' ? sum + parseMoney(r.escrowAmount || 0) : sum), 0);

    const totalUsers = users.length;
    const bannedUsers = users.filter((u) => u.banned === true).length;
    const verifiedUsers = users.filter((u) => u.kycStatus === 'verified').length;
    const proSubs = users.filter((u) => normalizePlan(u.subscriptionPlan) === 'pro' && u.subscriptionStatus === 'active').length;
    const premiumSubs = users.filter((u) => normalizePlan(u.subscriptionPlan) === 'premium' && u.subscriptionStatus === 'active').length;
    const subscriptionRevenue = (proSubs * 49) + (premiumSubs * 99);

    const totalTransactionVolume = transactions.reduce((sum, t) => sum + parseMoney(t.amount || 0), 0);

    return sendSuccess(res, req, {
      data: {
        jobs: { total: totalJobs, paid: paidJobs, open: openJobs, active: activeJobs, disputed: disputedJobs },
        revenue: { commissionEarned: parseFloat(totalRevenue.toFixed(2)), subscriptionMRR: subscriptionRevenue, escrowHeld: parseFloat(totalEscrow.toFixed(2)), transactionVolume: parseFloat(totalTransactionVolume.toFixed(2)) },
        users: { total: totalUsers, verified: verifiedUsers, banned: bannedUsers, proSubscribers: proSubs, premiumSubscribers: premiumSubs },
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_ANALYTICS_ERROR');
    return sendError(res, req, 500, 'analytics_failed', 'Could not compute analytics');
  }
});

// ✅ START SERVER
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ url: PUBLIC_SERVER_BASE_URL, allowedOrigins: Array.from(allowedOriginSet) }, 'SERVER_STARTED');
});

// ── Keep-alive: prevent Render free tier from sleeping ──────────────────────
const KEEP_ALIVE_URL = (process.env.BACKEND_PUBLIC_URL || 'https://connecthub-yrox.onrender.com') + '/health';
setInterval(async () => {
  try {
    const { default: nodeFetch } = await import('node-fetch').catch(() => ({ default: fetch }));
    const fetchFn = typeof nodeFetch === 'function' ? nodeFetch : fetch;
    await fetchFn(KEEP_ALIVE_URL);
    logger.info({ ts: new Date().toISOString() }, '[keep-alive] pinged backend');
  } catch (e) {
    logger.warn({ err: e.message }, '[keep-alive] ping failed');
  }
}, 10 * 60 * 1000); // every 10 minutes

function scheduleDailySubscriptionSweep() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delayMs = Math.max(1000, nextMidnight.getTime() - now.getTime());

  setTimeout(() => {
    expireDueSubscriptions();
    setInterval(() => {
      expireDueSubscriptions();
    }, 24 * 60 * 60 * 1000);
  }, delayMs);
}

scheduleDailySubscriptionSweep();
expireDueSubscriptions();

app.post('/admin/sync-claims', requireAdminOrBootstrapSecret, async (req, res) => {
  try {
    const requestedEmails = Array.isArray(req.body?.emails) ? req.body.emails : ADMIN_EMAILS;
    const targetEmails = requestedEmails.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);

    if (!targetEmails.length) {
      return sendError(res, req, 400, 'no_target_emails', 'No target emails provided');
    }

    const results = [];

    for (const email of targetEmails) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email);
        const existingClaims = userRecord.customClaims || {};
        const mergedClaims = {
          ...existingClaims,
          admin: true,
          role: 'admin',
        };

        await admin.auth().setCustomUserClaims(userRecord.uid, mergedClaims);

        results.push({
          email,
          uid: userRecord.uid,
          status: 'updated',
        });
      } catch (error) {
        results.push({
          email,
          status: 'failed',
          reason: error.message || 'Unknown error',
        });
      }
    }

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_claim_sync',
      metadata: {
        requestedCount: targetEmails.length,
        updatedCount: results.filter((item) => item.status === 'updated').length,
      },
    });

    return sendSuccess(res, req, {
      message: 'Claim sync completed',
      results,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_CLAIM_SYNC_ERROR');
    return sendError(res, req, 500, 'admin_claim_sync_failed', 'Admin claim sync failed');
  }
});

app.get('/admin/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { requestId } = req.query;
    let auditQuery = adminDb.collection('request_audit_logs').orderBy('createdAt', 'desc').limit(100);

    if (requestId) {
      auditQuery = adminDb
        .collection('request_audit_logs')
        .where('requestId', '==', String(requestId))
        .orderBy('createdAt', 'desc')
        .limit(100);
    }

    const snapshot = await auditQuery.get();
    const logs = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

    return sendSuccess(res, req, { data: logs });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_AUDIT_READ_ERROR');
    return sendError(res, req, 500, 'admin_audit_read_failed', 'Could not read audit logs');
  }
});

app.get('/admin/push-token/:email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email || '').trim().toLowerCase();
    if (!targetEmail) {
      return sendError(res, req, 400, 'missing_email', 'Missing email');
    }

    const userDoc = await adminDb.collection('users').doc(targetEmail).get();
    if (!userDoc.exists) {
      return sendError(res, req, 404, 'user_not_found', 'User not found');
    }

    const pushToken = userDoc.data()?.pushToken || null;
    const pushTokenUpdatedAt = userDoc.data()?.pushTokenUpdatedAt || null;

    return sendSuccess(res, req, {
      email: targetEmail,
      hasPushToken: Boolean(pushToken),
      pushToken,
      pushTokenUpdatedAt,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_PUSH_TOKEN_READ_ERROR');
    return sendError(res, req, 500, 'admin_push_token_read_failed', 'Could not read push token');
  }
});

/**
 * POST /admin/email-test — send a test email from the backend SMTP config.
 * Body: { to: string }
 */
app.post('/admin/email-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim().toLowerCase();
    if (!to) return sendError(res, req, 400, 'missing_to', 'Provide a destination email address');

    if (!isEmailConfigured()) {
      return sendError(res, req, 503, 'email_not_configured',
        'EMAIL_USER and EMAIL_PASS environment variables are not set on this server. Add them in your Render dashboard under Environment.');
    }

    await emailTransporter.sendMail({
      from: emailFrom || 'no-reply@connecthub.app',
      to,
      subject: 'ConnectHub Email Health Check',
      html: `<h2>Email delivery confirmed ✅</h2>
             <p>This test email was sent from the ConnectHub backend at <b>${new Date().toUTCString()}</b>.</p>
             <p>SMTP is correctly configured and emails will be delivered.</p>`,
    });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_email_test',
      metadata: { to },
    });

    return sendSuccess(res, req, { message: 'Test email sent', to, configured: true });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_EMAIL_TEST_ERROR');
    return sendError(res, req, 500, 'email_test_failed',
      `Email test failed: ${error?.responseCode ? `SMTP error ${error.responseCode}` : (error?.message || 'unknown error')}`);
  }
});

app.post('/admin/push-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = String(req.body?.email || '').trim().toLowerCase();
    const title = String(req.body?.title || 'ConnectHub Test Notification').trim();
    const body = String(req.body?.body || 'This is a test push notification from ConnectHub admin.').trim();

    if (!targetEmail) {
      return sendError(res, req, 400, 'missing_email', 'email is required');
    }

    const pushToken = await getPushTokenForUser(targetEmail);
    if (!pushToken) {
      return sendError(res, req, 404, 'push_token_not_found', 'No push token found for this user');
    }

    await sendPushNotification(pushToken, title, body);

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_sent_push_test',
      metadata: {
        targetEmail,
        title,
      },
    });

    return sendSuccess(res, req, {
      message: 'Push test sent',
      email: targetEmail,
      title,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_PUSH_TEST_ERROR');
    return sendError(res, req, 500, 'admin_push_test_failed', 'Could not send test push');
  }
});

app.post('/admin/requests/:id/moderate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status, note } = req.body || {};

    const allowedStatuses = ['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'disputed', 'cancelled'];

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    if (!status || !allowedStatuses.includes(status)) {
      return sendError(res, req, 400, 'invalid_status_transition_target', 'Invalid status transition target');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const existingSnapshot = await requestRef.get();

    if (!existingSnapshot.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = existingSnapshot.data();
    const patch = {
      status,
      moderatedBy: req.user?.email || null,
      moderatedAt: new Date().toISOString(),
      moderationNote: note || null,
    };

    if (status === 'open') {
      patch.acceptedBy = null;
      patch.paid = false;
      patch.escrowFunded = false;
      patch.escrowStatus = null;
      patch.paymentHold = false;
      patch.paymentReference = null;
      patch.paymentStatus = null;
      patch.paidAt = null;
    }

    await requestRef.set(patch, { merge: true });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_status_change',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
      metadata: {
        requestedStatus: status,
      },
    });

    return sendSuccess(res, req, {
      message: 'Request moderated successfully',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_MODERATION_ERROR');
    return sendError(res, req, 500, 'admin_moderation_failed', 'Moderation failed');
  }
});

app.delete('/admin/requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const existingSnapshot = await requestRef.get();

    if (!existingSnapshot.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const beforeData = existingSnapshot.data();
    const patch = {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: req.user?.email || null,
      cancellationReason: req.body?.reason || 'Admin cancellation',
    };

    await requestRef.set(patch, { merge: true });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_cancel_request',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
      metadata: {
        reason: req.body?.reason || 'Admin cancellation',
      },
    });

    return sendSuccess(res, req, {
      message: 'Request cancelled successfully',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_DELETE_ERROR');
    return sendError(res, req, 500, 'admin_delete_failed', 'Delete failed');
  }
});

// ── KYC ENDPOINTS ────────────────────────────────────────────────────────────

/**
 * POST /kyc/notify-submitted — send submission confirmation email to the caller.
 * Called by the client immediately after writing to Firestore.
 */
app.post('/kyc/notify-submitted', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').trim().toLowerCase();
    if (!email) return sendError(res, req, 400, 'missing_email', 'Cannot determine user email');

    const userSnap = await adminDb.collection('users').doc(email).get();
    const name = userSnap.exists ? (userSnap.data()?.name || email) : email;

    await sendKycSubmissionEmail({ email, name }).catch((err) => {
      logger.warn({ err, email }, 'KYC_SUBMIT_EMAIL_FAILED');
    });

    return sendSuccess(res, req, { message: 'Confirmation email sent' });
  } catch (error) {
    logger.error({ err: error }, 'KYC_NOTIFY_SUBMITTED_ERROR');
    return sendError(res, req, 500, 'kyc_notify_failed', 'Could not send confirmation email');
  }
});

// ── KYC ADMIN ENDPOINTS ──────────────────────────────────────────────────────

/**
 * GET /admin/kyc — list all KYC submissions
 * Optional ?status=pending_verification|verified|rejected
 */
app.get('/admin/kyc', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let q = adminDb.collection('kyc_submissions').orderBy('submittedAt', 'desc').limit(200);
    if (status) {
      q = adminDb.collection('kyc_submissions').where('kycStatus', '==', String(status)).orderBy('submittedAt', 'desc').limit(200);
    }
    const snap = await q.get();
    const submissions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return sendSuccess(res, req, { submissions });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_LIST_ERROR');
    return sendError(res, req, 500, 'admin_kyc_list_failed', 'Could not load KYC submissions');
  }
});

/**
 * POST /admin/kyc/:email/approve — approve a KYC submission
 */
app.post('/admin/kyc/:email/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
    if (!targetEmail) return sendError(res, req, 400, 'missing_email', 'Missing email');

    const submissionRef = adminDb.collection('kyc_submissions').doc(targetEmail);
    const snap = await submissionRef.get();
    if (!snap.exists) return sendError(res, req, 404, 'submission_not_found', 'KYC submission not found');

    const now = new Date().toISOString();
    const patch = {
      kycStatus: 'verified',
      reviewedBy: req.user?.email || null,
      reviewedAt: now,
      updatedAt: now,
    };

    await submissionRef.set(patch, { merge: true });
    await adminDb.collection('users').doc(targetEmail).set({ kycStatus: 'verified', updatedAt: now }, { merge: true });

    const notificationDelivery = await notifyUser(
      targetEmail,
      'Your identity has been verified. Welcome to ConnectHub!',
      'KYC Approved!',
      { screen: 'kyc' }
    );

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_kyc_approved',
      metadata: { targetEmail },
    });

    return sendSuccess(res, req, {
      message: 'KYC approved',
      email: targetEmail,
      delivery: {
        ...notificationDelivery,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_APPROVE_ERROR');
    return sendError(res, req, 500, 'admin_kyc_approve_failed', 'KYC approval failed');
  }
});

/**
 * POST /admin/kyc/:email/reject — reject a KYC submission
 * Body: { reason: string }
 */
app.post('/admin/kyc/:email/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
    if (!targetEmail) return sendError(res, req, 400, 'missing_email', 'Missing email');

    const reason = String(req.body?.reason || '').trim();
    if (!reason) return sendError(res, req, 400, 'missing_reason', 'A rejection reason is required');

    const submissionRef = adminDb.collection('kyc_submissions').doc(targetEmail);
    const snap = await submissionRef.get();
    if (!snap.exists) return sendError(res, req, 404, 'submission_not_found', 'KYC submission not found');

    const now = new Date().toISOString();
    const patch = {
      kycStatus: 'rejected',
      rejectionReason: reason,
      reviewedBy: req.user?.email || null,
      reviewedAt: now,
      updatedAt: now,
    };

    await submissionRef.set(patch, { merge: true });
    await adminDb.collection('users').doc(targetEmail).set({ kycStatus: 'rejected', updatedAt: now }, { merge: true });

    const notificationDelivery = await notifyUser(
      targetEmail,
      'Your KYC was not approved. Open the app to resubmit.',
      'KYC Action Required',
      { screen: 'kyc' }
    );

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_kyc_rejected',
      metadata: { targetEmail, reason },
    });

    return sendSuccess(res, req, {
      message: 'KYC rejected',
      email: targetEmail,
      delivery: {
        ...notificationDelivery,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_REJECT_ERROR');
    return sendError(res, req, 500, 'admin_kyc_reject_failed', 'KYC rejection failed');
  }
});

/**
 * POST /admin/kyc/notify-approved
 * Body: { email, displayName }
 */
app.post('/admin/kyc/notify-approved', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim() || email;

    if (!email) {
      return sendError(res, req, 400, 'missing_email', 'Email is required');
    }

    await sendKycApprovalEmail({ email, name: displayName });

    return sendSuccess(res, req, {
      message: 'KYC approved email sent',
      email,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_NOTIFY_APPROVED_ERROR');
    return sendError(res, req, 500, 'admin_kyc_notify_approved_failed', 'Could not send approved email');
  }
});

/**
 * POST /admin/kyc/notify-rejected
 * Body: { email, displayName, reason }
 */
app.post('/admin/kyc/notify-rejected', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim() || email;
    const reason = String(req.body?.reason || '').trim();

    if (!email) {
      return sendError(res, req, 400, 'missing_email', 'Email is required');
    }

    if (!reason) {
      return sendError(res, req, 400, 'missing_reason', 'Reason is required');
    }

    await sendKycRejectionEmail({ email, name: displayName, reason });

    return sendSuccess(res, req, {
      message: 'KYC rejected email sent',
      email,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_NOTIFY_REJECTED_ERROR');
    return sendError(res, req, 500, 'admin_kyc_notify_rejected_failed', 'Could not send rejected email');
  }
});

app.post('/admin/disputes/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const disputeId = req.params.id;
    const resolution = String(req.body?.resolution || '').trim();
    const resolutionNote = String(req.body?.note || '').trim();
    const splitPercentToWorkerRaw = Number(req.body?.splitPercentToWorker);

    const allowedResolutions = ['release_to_worker', 'refund_customer', 'split'];
    if (!disputeId) {
      return sendError(res, req, 400, 'missing_dispute_id', 'Missing dispute id');
    }

    if (!allowedResolutions.includes(resolution)) {
      return sendError(res, req, 400, 'invalid_dispute_resolution', 'Resolution must be release_to_worker, refund_customer, or split');
    }

    if (resolution === 'split' && (!Number.isFinite(splitPercentToWorkerRaw) || splitPercentToWorkerRaw <= 0 || splitPercentToWorkerRaw >= 100)) {
      return sendError(res, req, 400, 'invalid_split_percentage', 'splitPercentToWorker must be between 1 and 99');
    }

    const disputeRef = adminDb.collection('disputes').doc(disputeId);
    const disputeSnapshot = await disputeRef.get();

    if (!disputeSnapshot.exists) {
      return sendError(res, req, 404, 'dispute_not_found', 'Dispute not found');
    }

    const disputeData = disputeSnapshot.data() || {};
    if (disputeData.status === 'resolved') {
      return sendError(res, req, 409, 'dispute_already_resolved', 'This dispute has already been resolved');
    }

    const requestId = String(disputeData.requestId || '').trim();
    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_reference', 'Dispute is missing request reference');
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const requestSnapshot = await requestRef.get();
    if (!requestSnapshot.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found for this dispute');
    }

    const beforeRequest = requestSnapshot.data() || {};
    const now = new Date().toISOString();
    const requestPrice = parseMoney(beforeRequest.price);
    const splitPercentToWorker = Number.isFinite(splitPercentToWorkerRaw) ? parseFloat(splitPercentToWorkerRaw.toFixed(2)) : null;

    let grossProviderShare = 0;
    let providerPayout = 0;
    let customerRefund = 0;
    let commission = 0;
    let nextStatus = beforeRequest.status || 'disputed';
    let paid = false;

    if (resolution === 'release_to_worker') {
      grossProviderShare = requestPrice;
      commission = parseMoney(grossProviderShare * COMMISSION_RATE);
      providerPayout = parseMoney(grossProviderShare - commission);
      customerRefund = 0;
      nextStatus = 'paid';
      paid = true;
    } else if (resolution === 'refund_customer') {
      grossProviderShare = 0;
      commission = 0;
      providerPayout = 0;
      customerRefund = requestPrice;
      nextStatus = 'cancelled';
      paid = false;
    } else {
      grossProviderShare = parseMoney(requestPrice * (splitPercentToWorker / 100));
      commission = parseMoney(grossProviderShare * COMMISSION_RATE);
      providerPayout = parseMoney(grossProviderShare - commission);
      customerRefund = parseMoney(requestPrice - grossProviderShare);
      nextStatus = 'paid';
      paid = true;
    }

    const paymentReference = `dispute_${resolution}_${requestId}_${Date.now()}`;
    const requestPatch = {
      status: nextStatus,
      paid,
      paidAt: paid ? now : null,
      paymentHold: false,
      escrowStatus: resolution === 'refund_customer' ? 'refunded' : 'released',
      disputeResolvedAt: now,
      disputeResolvedBy: req.user?.email || null,
      disputeResolution: resolution,
      disputeResolutionNote: resolutionNote || null,
      providerPayout,
      providerNet: providerPayout,
      commission,
      commissionRate: COMMISSION_RATE,
      customerRefund,
      paymentReference,
      paymentStatus: resolution === 'refund_customer' ? 'refunded' : 'resolved',
      paymentChannel: 'dispute_resolution',
      gatewayResponse: resolution === 'release_to_worker'
        ? 'Escrow released to provider by admin after dispute review'
        : resolution === 'refund_customer'
          ? 'Escrow refunded to customer by admin after dispute review'
          : 'Escrow split between customer and provider by admin after dispute review',
      splitPercentToWorker: resolution === 'split' ? splitPercentToWorker : null,
      splitPercentToCustomer: resolution === 'split' ? parseFloat((100 - splitPercentToWorker).toFixed(2)) : null,
      refundAmount: resolution === 'refund_customer' ? customerRefund : null,
      refundedAt: resolution === 'refund_customer' ? now : null,
    };

    await requestRef.set(requestPatch, { merge: true });

    const disputePatch = {
      status: 'resolved',
      resolution,
      resolutionNote: resolutionNote || null,
      splitPercentToWorker: resolution === 'split' ? splitPercentToWorker : null,
      providerPayout,
      customerRefund,
      requestStatusAfterResolution: nextStatus,
      resolvedAt: now,
      resolvedBy: req.user?.email || null,
      updatedAt: now,
    };

    await disputeRef.set(disputePatch, { merge: true });

    const title = beforeRequest.title || requestId;
    if (beforeRequest.acceptedBy) {
      await writeNotification(
        beforeRequest.acceptedBy,
        resolution === 'refund_customer'
          ? `Dispute resolved for "${title}": customer refunded. No payout released.`
          : resolution === 'release_to_worker'
            ? `Dispute resolved for "${title}": full payment released to you.`
            : `Dispute resolved for "${title}": payout split. You receive GHS ${providerPayout.toFixed(2)}.`
      );
    }
    if (beforeRequest.user) {
      await writeNotification(
        beforeRequest.user,
        resolution === 'refund_customer'
          ? `Dispute resolved for "${title}": full refund approved (GHS ${customerRefund.toFixed(2)}).`
          : resolution === 'release_to_worker'
            ? `Dispute resolved for "${title}": payment released to the provider.`
            : `Dispute resolved for "${title}": split settlement approved. Refund: GHS ${customerRefund.toFixed(2)}.`
      );
    }

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_resolved_dispute',
      requestId,
      before: {
        request: beforeRequest,
        dispute: disputeData,
      },
      after: {
        request: { ...beforeRequest, ...requestPatch },
        dispute: { ...disputeData, ...disputePatch },
      },
      metadata: {
        disputeId,
        resolution,
        providerPayout,
        customerRefund,
        commission,
      },
    });

    if (providerPayout > 0 && beforeRequest.acceptedBy) {
      await creditWalletBalance(beforeRequest.acceptedBy, providerPayout);

      await createTransactionRecordOnServer({
        requestId,
        requestData: { ...beforeRequest, ...requestPatch },
        transactionId: paymentReference,
        amount: grossProviderShare,
        commission,
        netAmount: providerPayout,
        status: 'SUCCESS',
        paymentMethod: 'Dispute Resolution',
      });
    }

    return sendSuccess(res, req, {
      message: 'Dispute resolved successfully',
      data: {
        disputeId,
        requestId,
        resolution,
        providerPayout,
        customerRefund,
        status: nextStatus,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_DISPUTE_RESOLUTION_ERROR');
    return sendError(res, req, 500, 'admin_dispute_resolution_failed', 'Could not resolve dispute');
  }
});

// POST /reviews/:requestId/vote
// Body: { side: 'provider'|'customer', vote: 'like'|'dislike' }
// Atomically records or changes the caller's like/dislike on a review and
// keeps aggregate counts (providerReviewLikes etc.) on the request doc in sync.
app.post('/reviews/:requestId/vote', requireAuth, async (req, res) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    const side = String(req.body?.side || '').trim();
    const vote = String(req.body?.vote || '').trim();
    const voterEmail = req.user?.email || '';

    if (!requestId) return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    if (!['provider', 'customer'].includes(side)) return sendError(res, req, 400, 'invalid_side', 'side must be provider or customer');
    if (!['like', 'dislike'].includes(vote)) return sendError(res, req, 400, 'invalid_vote', 'vote must be like or dislike');
    if (!voterEmail) return sendError(res, req, 401, 'missing_voter', 'Could not identify voter');

    const requestRef = adminDb.collection('requests').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return sendError(res, req, 404, 'request_not_found', 'Request not found');

    const requestData = requestSnap.data() || {};

    // Verify a review exists for the given side
    const reviewField = side === 'provider' ? 'rating' : 'customerRating';
    if (!requestData[reviewField]) {
      return sendError(res, req, 404, 'review_not_found', 'No review found for this side');
    }

    // Authors cannot vote on reviews they wrote
    if (side === 'provider' && requestData.user === voterEmail) {
      return sendError(res, req, 403, 'cannot_vote_own_review', 'You cannot vote on a review you wrote');
    }
    if (side === 'customer' && requestData.acceptedBy === voterEmail) {
      return sendError(res, req, 403, 'cannot_vote_own_review', 'You cannot vote on a review you wrote');
    }

    const likesField = side === 'provider' ? 'providerReviewLikes' : 'customerReviewLikes';
    const dislikesField = side === 'provider' ? 'providerReviewDislikes' : 'customerReviewDislikes';

    const sanitizedEmail = voterEmail.replace(/[@.]/g, '_');
    const voteDocId = `${requestId}_${side}_${sanitizedEmail}`;
    const voteRef = adminDb.collection('reviewVotes').doc(voteDocId);

    await adminDb.runTransaction(async (tx) => {
      const voteSnap = await tx.get(voteRef);
      const now = new Date().toISOString();

      let likeDelta = 0;
      let dislikeDelta = 0;

      if (!voteSnap.exists) {
        tx.set(voteRef, { requestId, side, voterEmail, vote, createdAt: now, updatedAt: now });
        if (vote === 'like') likeDelta = 1;
        else dislikeDelta = 1;
      } else {
        const existing = voteSnap.data().vote;
        if (existing !== vote) {
          tx.update(voteRef, { vote, updatedAt: now });
          if (vote === 'like') { likeDelta = 1; dislikeDelta = -1; }
          else { likeDelta = -1; dislikeDelta = 1; }
        }
      }

      if (likeDelta !== 0 || dislikeDelta !== 0) {
        const updates = {};
        if (likeDelta !== 0) updates[likesField] = admin.firestore.FieldValue.increment(likeDelta);
        if (dislikeDelta !== 0) updates[dislikesField] = admin.firestore.FieldValue.increment(dislikeDelta);
        tx.set(requestRef, updates, { merge: true });
      }
    });

    return sendSuccess(res, req, { message: 'Vote recorded' });
  } catch (error) {
    logger.error({ err: error }, 'REVIEW_VOTE_ERROR');
    return sendError(res, req, 500, 'review_vote_failed', 'Could not record vote');
  }
});

app.post('/chat/notify', requireAuth, async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || req.body?.requestId || '').trim();
    const senderEmail = String(req.body?.senderEmail || req.user?.email || '').trim().toLowerCase();
    const messageText = String(req.body?.messageText || '').trim();

    if (!jobId) {
      return sendError(res, req, 400, 'missing_job_id', 'jobId is required');
    }

    if (!senderEmail) {
      return sendError(res, req, 400, 'missing_sender', 'senderEmail is required');
    }

    if (!messageText) {
      return sendError(res, req, 400, 'missing_message_text', 'messageText is required');
    }

    const requestSnap = await adminDb.collection('requests').doc(jobId).get();
    if (!requestSnap.exists) {
      return sendError(res, req, 404, 'request_not_found', 'Request not found');
    }

    const requestData = requestSnap.data() || {};
    const ownerEmail = String(requestData.user || '').trim().toLowerCase();
    const providerEmail = String(requestData.acceptedBy || '').trim().toLowerCase();
    const participants = [ownerEmail, providerEmail].filter(Boolean);

    if (!participants.includes(senderEmail)) {
      return sendError(res, req, 403, 'chat_access_denied', 'Sender is not a participant for this job');
    }

    const recipientEmail = senderEmail === ownerEmail ? providerEmail : ownerEmail;
    if (!recipientEmail) {
      return sendError(res, req, 409, 'recipient_not_available', 'No chat recipient is available for this job');
    }

    const senderProfile = await adminDb.collection('users').doc(senderEmail).get().catch(() => null);
    const senderName = senderProfile && senderProfile.exists
      ? (senderProfile.data()?.name || senderProfile.data()?.displayName || senderEmail)
      : senderEmail;

    await notifyUser(
      recipientEmail,
      messageText,
      `New message from ${senderName}`,
      { screen: 'chat', jobId }
    );

    return sendSuccess(res, req, {
      message: 'Chat notification delivered',
      data: {
        jobId,
        recipientEmail,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'CHAT_NOTIFY_ERROR');
    return sendError(res, req, 500, 'chat_notify_failed', 'Could not send chat notification');
  }
});

app.post('/wallet/topup/init', payInitLimiter, requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const amount = parseMoney(req.body?.amount);
    const paystackSecret = getPaystackSecret();

    if (!actorEmail) {
      return sendError(res, req, 401, 'missing_user_email', 'Authenticated user email is missing');
    }

    if (!amount || amount < 1) {
      return sendError(res, req, 400, 'invalid_amount', 'Top up amount must be at least GHS 1.00');
    }

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const callbackUrl = `${NORMALIZED_CALLBACK_BASE_URL}/wallet-topup-return`;

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: actorEmail,
        amount: Math.round(amount * 100),
        callback_url: callbackUrl,
        metadata: {
          type: 'wallet_topup',
          ownerEmail: actorEmail,
          requestId: null,
        },
      }),
    });

    const data = await response.json();

    logger.info({ paystackStatus: data?.status, ref: data?.data?.reference || null, ownerEmail: actorEmail }, 'WALLET_TOPUP_INIT_RESPONSE');

    if (!response.ok || !data?.status || !data?.data?.authorization_url) {
      return sendError(res, req, response.status || 500, 'wallet_topup_init_failed', data?.message || 'Could not initialize wallet top up');
    }

    return sendSuccess(res, req, {
      message: 'Wallet top up initialized',
      data: {
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_TOPUP_INIT_ERROR');
    return sendError(res, req, 500, 'wallet_topup_init_failed', 'Could not initialize wallet top up');
  }
});

app.post('/wallet/topup/verify', payVerifyLimiter, requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const reference = String(req.body?.reference || '').trim();
    const paystackSecret = getPaystackSecret();

    if (!reference) {
      return sendError(res, req, 400, 'missing_reference', 'Missing payment reference');
    }

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok || !data?.status || data?.data?.status !== 'success') {
      return sendError(res, req, 400, 'wallet_topup_not_successful', data?.message || 'Top up payment not successful');
    }

    const metadata = data?.data?.metadata || {};
    const metadataType = String(metadata?.type || '').trim().toLowerCase();
    const metadataOwner = String(metadata?.ownerEmail || '').trim().toLowerCase();
    const transactionEmail = String(data?.data?.customer?.email || '').trim().toLowerCase();
    const amountGhs = parseMoney(Number(data?.data?.amount || 0) / 100);

    if (metadataType !== 'wallet_topup') {
      return sendError(res, req, 400, 'invalid_topup_type', 'This payment reference is not a wallet top up');
    }

    if (!amountGhs || amountGhs <= 0) {
      return sendError(res, req, 400, 'invalid_topup_amount', 'Top up amount is invalid');
    }

    const ownerEmail = metadataOwner || transactionEmail;
    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the payment owner can apply this wallet top up');
    }

    const topupRef = adminDb.collection('wallet_topups').doc(reference);
    const transactionRef = adminDb.collection('transactions').doc(`wallet_topup_${reference}`);
    const userRef = adminDb.collection('users').doc(ownerEmail);

    let alreadyApplied = false;
    await adminDb.runTransaction(async (txn) => {
      const topupSnap = await txn.get(topupRef);
      if (topupSnap.exists && topupSnap.data()?.applied === true) {
        alreadyApplied = true;
        return;
      }

      const nowIso = new Date().toISOString();
      txn.set(userRef, {
        walletBalance: admin.firestore.FieldValue.increment(amountGhs),
        updatedAt: nowIso,
      }, { merge: true });

      txn.set(topupRef, {
        reference,
        ownerEmail,
        amount: amountGhs,
        status: 'success',
        applied: true,
        appliedAt: nowIso,
      }, { merge: true });

      txn.set(transactionRef, {
        senderEmail: 'paystack@system',
        receiverEmail: ownerEmail,
        amount: amountGhs,
        status: 'success',
        paymentMethod: 'wallet_topup',
        transactionId: reference,
        jobTitle: 'Wallet Top-up',
        type: 'wallet_topup',
        gatewayResponse: data?.data?.gateway_response || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    if (!alreadyApplied) {
      await notifyUser(
        ownerEmail,
        `Your wallet has been funded with GHS ${amountGhs.toFixed(2)}.`,
        'Wallet Funded',
        { screen: 'wallet' }
      );
    }

    return sendSuccess(res, req, {
      message: alreadyApplied ? 'Wallet top up already applied' : 'Wallet top up applied',
      data: {
        reference,
        amount: amountGhs,
        applied: !alreadyApplied,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_TOPUP_VERIFY_ERROR');
    return sendError(res, req, 500, 'wallet_topup_verify_failed', 'Could not verify wallet top up');
  }
});