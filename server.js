require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const pino = require('pino');
const { sendPaymentReceiptEmail, sendKycSubmissionEmail, sendKycApprovalEmail, sendKycRejectionEmail, isEmailConfigured, transporter: emailTransporter, EMAIL_FROM: emailFrom } = require('./src/server/email');
const { canTransition: canWorkflowTransition, normalizeStatus: normalizeWorkflowStatus } = require('./src/utils/jobStateMachine');

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
const CORS_ALLOWED_ORIGINS = Array.from(new Set([
  // Always allow both Firebase Hosting domains regardless of env var
  'https://connecthub-1873e.web.app',
  'https://connecthub-1873e.firebaseapp.com',
  ...(process.env.CORS_ALLOWED_ORIGINS || `${WEB_BASE_URL},${CALLBACK_BASE_URL},http://localhost:8081,http://localhost:19006,exp://localhost:8081`)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
]));
// ADMIN LOGIN ACCOUNT — do not change this to support email
const ADMIN_LOGIN_EMAIL = 'bhounce1000@gmail.com';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.EXPO_PUBLIC_ADMIN_EMAILS || ADMIN_LOGIN_EMAIL)
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || ADMIN_LOGIN_EMAIL).trim().toLowerCase();
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
const RECENT_AUTH_MAX_AGE_SECONDS = Number(process.env.RECENT_AUTH_MAX_AGE_SECONDS || 10 * 60);
const USERNAME_CHANGE_COOLDOWN_SECONDS = Number(process.env.USERNAME_CHANGE_COOLDOWN_SECONDS || 24 * 60 * 60);
const USERNAME_CHANGE_LOCK_THRESHOLD = Number(process.env.USERNAME_CHANGE_LOCK_THRESHOLD || 3);
const USERNAME_CHANGE_LOCK_SECONDS = Number(process.env.USERNAME_CHANGE_LOCK_SECONDS || 60 * 60);
const USERNAME_CHANGE_AUDIT_LIMIT = Number(process.env.USERNAME_CHANGE_AUDIT_LIMIT || 20);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.error('CRITICAL: ENCRYPTION_KEY environment variable is not set!');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\').slice(0,32))"');
  console.error('Add it to your Render dashboard environment variables.');
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Using temporary key for development only');
  }
}

const REQUIRED_ENV_VARS = [
  'PAYSTACK_SECRET',
  'ENCRYPTION_KEY',
  'ADMIN_EMAIL',
];

function checkEnvVars() {
  const missing = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('=== MISSING ENVIRONMENT VARIABLES ===');
    console.error('These must be set in Render dashboard:');
    missing.forEach((v) => console.error('  - ' + v));
    console.error('=====================================');
  } else {
    console.log('✅ All required environment variables are set');
  }

  return missing.length === 0;
}

checkEnvVars();

const IV_LENGTH = 16;
const OTP_COLLECTION = 'otp_verifications';
const SIGNUP_ERROR_LOG_COLLECTION = 'signup_error_logs';
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
const OTP_LOCK_MINUTES = Number(process.env.OTP_LOCK_MINUTES || 15);
const REQUEST_PAYOUT_COLLECTION = 'request_payouts';
const REQUEST_STATUS_SEQUENCE = ['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'paid'];
const ACCEPTED_PAYMENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function normalizeRequestStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'working') return 'in_progress';
  if (raw === 'done' || raw === 'confirmed') return 'pending_confirmation';
  return raw || 'open';
}

function statusIndex(status) {
  return REQUEST_STATUS_SEQUENCE.indexOf(normalizeRequestStatus(status));
}

function canAdvanceStatus(oldStatus, nextStatus) {
  const oldIndex = statusIndex(oldStatus);
  const nextIndex = statusIndex(nextStatus);
  if (oldIndex < 0 || nextIndex < 0) return false;
  return nextIndex >= oldIndex;
}

function statusTimestampField(status) {
  const normalized = normalizeRequestStatus(status);
  if (normalized === 'open') return 'openedAt';
  if (normalized === 'accepted') return 'acceptedAt';
  if (normalized === 'in_progress') return 'startedAt';
  if (normalized === 'pending_confirmation') return 'completedAt';
  if (normalized === 'completed') return 'completionConfirmedAt';
  if (normalized === 'paid') return 'paidAt';
  return null;
}

function hasEscrowPaymentProof(requestData = {}) {
  const paymentStatus = String(requestData?.paymentStatus || '').trim().toLowerCase();
  const paymentReference = String(requestData?.paymentReference || '').trim();
  const escrowFunded = requestData?.escrowFunded === true;
  const paymentReceived = requestData?.payment_received === true || requestData?.paymentReceived === true;
  return Boolean(paymentReference) && paymentStatus === 'success' && escrowFunded && paymentReceived;
}

function lifecycleChecks(requestData = {}) {
  const status = normalizeRequestStatus(requestData?.status || (requestData?.paid ? 'paid' : 'open'));
  const accepted = Boolean(String(requestData?.acceptedBy || '').trim()) && Boolean(requestData?.acceptedAt);
  const paymentReceived = hasEscrowPaymentProof(requestData);
  const workStarted = requestData?.work_started === true || (paymentReceived && statusIndex(status) >= statusIndex('in_progress'));
  const workCompleted = requestData?.work_completed === true || Boolean(requestData?.completedAt);
  const customerConfirmed = requestData?.customer_confirmed === true || Boolean(requestData?.completionConfirmedAt);
  const paymentReleased = requestData?.payment_released === true || requestData?.payoutCredited === true || requestData?.paid === true;

  return {
    accepted,
    paymentReceived,
    workStarted,
    workCompleted,
    customerConfirmed,
    paymentReleased,
  };
}

function validateStatusTransitionGate({ fromStatus, toStatus, requestData = {}, allowAutoConfirm = false }) {
  const from = normalizeRequestStatus(fromStatus);
  const to = normalizeRequestStatus(toStatus);
  const checks = lifecycleChecks(requestData);

  if (from === to) {
    return { ok: true, reason: 'no_state_change' };
  }

  if (from === 'open' && to === 'accepted') {
    return { ok: true, reason: 'provider_accept_required' };
  }

  if (from === 'accepted' && to === 'in_progress') {
    return checks.paymentReceived
      ? { ok: true, reason: 'payment_verified' }
      : { ok: false, reason: 'payment_not_verified_or_escrow_missing' };
  }

  if (from === 'in_progress' && to === 'pending_confirmation') {
    return checks.workStarted
      ? { ok: true, reason: 'provider_marked_done' }
      : { ok: false, reason: 'work_not_started' };
  }

  if (from === 'pending_confirmation' && to === 'completed') {
    if (checks.workCompleted) return { ok: true, reason: 'customer_or_auto_confirmation' };
    if (allowAutoConfirm) return { ok: true, reason: 'auto_confirmation_timeout' };
    return { ok: false, reason: 'work_not_marked_completed' };
  }

  if (from === 'completed' && to === 'paid') {
    return checks.paymentReceived
      ? { ok: true, reason: 'escrow_release' }
      : { ok: false, reason: 'cannot_release_without_verified_payment' };
  }

  return { ok: false, reason: `transition_not_allowed:${from}->${to}` };
}

function requestStatusToWorkflowStatus(value) {
  const normalized = normalizeRequestStatus(value);
  if (normalized === 'in_progress') return 'working';
  if (normalized === 'pending_confirmation') return 'done';
  if (normalized === 'completed') return 'confirmed';
  return normalized;
}

function workflowStatusToRequestStatus(value) {
  const normalized = normalizeWorkflowStatus(value);
  if (normalized === 'working') return 'in_progress';
  if (normalized === 'done') return 'pending_confirmation';
  if (normalized === 'confirmed') return 'completed';
  return normalized;
}

function enforceStatusTransition({
  requestData,
  fromStatus,
  toStatus,
  actorRole,
  actorEmail,
  actorUid,
  allowAutoConfirm = false,
}) {
  const fromWorkflowStatus = requestStatusToWorkflowStatus(fromStatus || requestData?.status || 'open');
  const toWorkflowStatus = requestStatusToWorkflowStatus(toStatus);

  canWorkflowTransition(fromWorkflowStatus, toWorkflowStatus, actorRole, {
    jobId: requestData?.id || requestData?.requestId || null,
    userId: actorUid || actorEmail || null,
  });

  if (fromWorkflowStatus === 'open' && toWorkflowStatus === 'accepted') {
    if (requestData?.acceptedBy) {
      throw new Error('Invalid transition: provider already assigned for this job');
    }
  }

  if (fromWorkflowStatus === 'working' && toWorkflowStatus === 'done') {
    const assignedProvider = String(requestData?.acceptedBy || '').trim().toLowerCase();
    const normalizedActor = String(actorEmail || '').trim().toLowerCase();
    if (!assignedProvider || assignedProvider !== normalizedActor) {
      throw new Error('Invalid transition: only the assigned provider can mark work as done');
    }
  }

  if (fromWorkflowStatus === 'done' && toWorkflowStatus === 'confirmed') {
    const ownerEmail = String(requestData?.user || '').trim().toLowerCase();
    const normalizedActor = String(actorEmail || '').trim().toLowerCase();
    if (!allowAutoConfirm && (!ownerEmail || ownerEmail !== normalizedActor)) {
      throw new Error('Invalid transition: only the customer can confirm completion');
    }
  }

  return true;
}

// NOTE FOR SCALING: The SimpleCache below is in-memory.
// It works fine for single-instance deployment (Render free/starter tier).
// When you scale to multiple instances (Pro tier), replace with:
// - Redis (Upstash has a free tier: https://upstash.com)
// - OR keep Firestore for cached data with short TTLs
// For now the cache is safe for your current traffic level.
class SimpleCache {
  constructor() {
    this.store = new Map();
  }

  set(key, value, ttlMs = 60 * 1000) {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  get(key) {
    const row = this.store.get(key);
    if (!row) return null;
    if (Date.now() > row.expires) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  delete(key) {
    this.store.delete(key);
  }

  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.store.entries()) {
        if (now > v.expires) this.store.delete(k);
      }
    }, 5 * 60 * 1000);
  }
}

const cache = new SimpleCache();
cache.startCleanup();

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

const NORMALIZED_CALLBACK_BASE_URL = trimTrailingSlash(CALLBACK_BASE_URL);
const allowedOriginSet = new Set(CORS_ALLOWED_ORIGINS.map((origin) => trimTrailingSlash(origin)));

app.set('trust proxy', 1);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests and native clients without Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = trimTrailingSlash(origin);
    if (allowedOriginSet.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    logger.warn({ origin: normalizedOrigin }, 'CORS_BLOCKED');
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'],
  credentials: true,
}));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.paystack.co'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        'https://api.paystack.co',
        'https://exp.host',
        'https://firestore.googleapis.com',
        'https://fcm.googleapis.com',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
        'https://connecthub-yrox.onrender.com',
      ],
      frameSrc: ['https://js.paystack.co'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(compression());
app.use((req, res, next) => {
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][0];
      }
    }
  }
  next();
});
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

function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 2000);
}

function sanitizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item));
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeInput(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeObject(item)])
  );
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
});

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

function isValidEmailFormat(email) {
  return EMAIL_REGEX.test(String(email || '').trim().toLowerCase());
}

async function logSignupFailure({ email, errorType, errorMessage, source = 'server', metadata = {} }) {
  try {
    await adminDb.collection(SIGNUP_ERROR_LOG_COLLECTION).add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      timestampIso: new Date().toISOString(),
      email: String(email || '').trim().toLowerCase(),
      errorType: String(errorType || 'unknown_error').trim().toLowerCase(),
      errorMessage: String(errorMessage || 'Unknown signup error').trim().slice(0, 1000),
      source: String(source || 'server').trim().toLowerCase(),
      metadata: sanitizeObject(metadata || {}),
    });
  } catch (error) {
    logger.error({ err: error, email, errorType }, 'SIGNUP_FAILURE_LOG_WRITE_ERROR');
  }
}

async function storeOTP(email, otp, phone) {
  const now = Date.now();
  const expires = now + 10 * 60 * 1000;
  const resendAllowedAt = now + OTP_RESEND_COOLDOWN_SECONDS * 1000;
  await adminDb.collection(OTP_COLLECTION).doc(email).set({
    otp,
    phone: phone || '',
    expires,
    resendAllowedAt,
    failedAttempts: 0,
    lockedUntil: 0,
    verified: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getOTP(email) {
  const otpDoc = await adminDb.collection(OTP_COLLECTION).doc(email).get();
  if (!otpDoc.exists) return null;
  const data = otpDoc.data() || {};
  if (Date.now() > Number(data.expires || 0)) {
    await adminDb.collection(OTP_COLLECTION).doc(email).delete().catch(() => {});
    return null;
  }
  return data;
}

async function markOTPVerified(email) {
  await adminDb.collection(OTP_COLLECTION).doc(email).set({
    verified: true,
    failedAttempts: 0,
    lockedUntil: 0,
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  setTimeout(async () => {
    try {
      await adminDb.collection(OTP_COLLECTION).doc(email).delete();
    } catch (_) {
      // ignore cleanup failure
    }
  }, 5 * 60 * 1000);
}

async function incrementOTPFailure(email, currentFailures = 0) {
  const nextFailures = Number(currentFailures || 0) + 1;
  const lockUntil = nextFailures >= OTP_MAX_VERIFY_ATTEMPTS
    ? Date.now() + OTP_LOCK_MINUTES * 60 * 1000
    : 0;
  await adminDb.collection(OTP_COLLECTION).doc(email).set({
    failedAttempts: nextFailures,
    lockedUntil: lockUntil,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { nextFailures, lockUntil };
}

async function deleteOTP(email) {
  try {
    await adminDb.collection(OTP_COLLECTION).doc(email).delete();
  } catch (_) {
    // ignore cleanup failure
  }
}

async function cleanupExpiredOTPs() {
  try {
    const expired = await adminDb.collection(OTP_COLLECTION)
      .where('expires', '<', Date.now())
      .limit(200)
      .get();

    if (expired.empty) {
      return;
    }

    const batch = adminDb.batch();
    expired.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    logger.info({ removed: expired.size }, 'OTP_CLEANUP_COMPLETE');
  } catch (error) {
    logger.error({ err: error }, 'OTP_CLEANUP_ERROR');
  }
}

function normalizeEncryptionKeyBuffer() {
  const devFallback = 'connecthub-dev-fallback-only-key';
  const secret = ENCRYPTION_KEY || (process.env.NODE_ENV !== 'production' ? devFallback : '');
  if (!secret) {
    return null;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptField(text) {
  if (!text) return text;
  try {
    const keyBuffer = normalizeEncryptionKeyBuffer();
    if (!keyBuffer) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    let encrypted = cipher.update(String(text));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    logger.error({ err: error }, 'FIELD_ENCRYPT_ERROR');
    return text;
  }
}

function decryptField(text) {
  if (!text || !String(text).includes(':')) return text;
  try {
    const keyBuffer = normalizeEncryptionKeyBuffer();
    if (!keyBuffer) return text;
    const [ivHex, encryptedHex] = String(text).split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (_error) {
    return text;
  }
}

const USERNAME_PATTERN = /^[a-zA-Z0-9 _.-]{3,40}$/;

function normalizeLooseText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDob(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{8}$/.test(raw)) {
    return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return raw;
}

function normalizeIdNumberForMatch(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isLikelyStorageUrl(value) {
  const raw = String(value || '').trim();
  return raw.startsWith('https://firebasestorage.googleapis.com/') || raw.startsWith('https://storage.googleapis.com/');
}

function maskIdentifier(value) {
  const raw = String(value || '');
  if (raw.length <= 4) return raw;
  return raw.slice(0, 2) + '*'.repeat(Math.max(0, raw.length - 4)) + raw.slice(-2);
}

function hasRecentAuth(decodedToken, maxAgeSeconds = RECENT_AUTH_MAX_AGE_SECONDS) {
  const authTimeSeconds = Number(decodedToken?.auth_time || 0);
  if (!Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return (nowSeconds - authTimeSeconds) <= maxAgeSeconds;
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

async function logStatusTransition({
  userId = null,
  jobId,
  oldStatus,
  newStatus,
  triggeredBy = 'manual',
  actorEmail = null,
  reason = null,
}) {
  try {
    if (!jobId) return;
    await adminDb.collection('request_status_logs').add({
      user_id: userId || null,
      job_id: String(jobId),
      old_status: normalizeRequestStatus(oldStatus),
      new_status: normalizeRequestStatus(newStatus),
      timestamp: new Date().toISOString(),
      triggered_by: triggeredBy,
      actor_email: actorEmail || null,
      reason: reason || null,
    });
  } catch (error) {
    logger.error({ err: error, jobId, oldStatus, newStatus }, 'STATUS_TRANSITION_LOG_ERROR');
  }
}

async function logStatusAttempt({
  jobId,
  attemptedBy = null,
  fromStatus,
  toStatus,
  success,
  reason = null,
  source = 'api',
}) {
  try {
    if (!jobId) return;
    await adminDb.collection('request_status_attempts').add({
      job_id: String(jobId),
      attempted_by: attemptedBy || null,
      from_status: normalizeRequestStatus(fromStatus),
      to_status: normalizeRequestStatus(toStatus),
      timestamp: new Date().toISOString(),
      success: Boolean(success),
      reason: reason || null,
      source,
    });
  } catch (error) {
    logger.error({ err: error, jobId, fromStatus, toStatus }, 'STATUS_ATTEMPT_LOG_ERROR');
  }
}

async function writeNotification(userEmail, text, options = {}) {
  if (!userEmail || !text) return;
  const normalizedEmail = String(userEmail).trim().toLowerCase();
  const type = String(options.type || 'system').trim() || 'system';
  const title = String(options.title || 'ConnectHub').trim() || 'ConnectHub';
  const body = String(options.body || text).trim() || String(text || '').trim();
  const jobId = options.jobId ? String(options.jobId) : null;

  try {
    await adminDb.collection('notifications').add({
      recipientId: normalizedEmail,
      type,
      title,
      body,
      jobId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      user: normalizedEmail,
      userId: normalizedEmail,
      userLower: normalizedEmail,
      text: body,
      createdAtIso: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, 'NOTIFICATION_WRITE_ERROR');
  }
}

async function sendNotification(recipientId, type, data = {}) {
  if (!recipientId) return;
  const normalizedRecipient = String(recipientId).trim().toLowerCase();
  const title = String(data.title || 'ConnectHub').trim() || 'ConnectHub';
  const body = String(data.body || '').trim();
  if (!body) return;

  await writeNotification(normalizedRecipient, body, {
    type,
    title,
    body,
    jobId: data.jobId || data.requestId || null,
  });
}

async function logAdminAction(adminEmail, action, details = {}) {
  try {
    await adminDb.collection('adminLogs').add({
      adminEmail: String(adminEmail || '').trim().toLowerCase() || ADMIN_EMAIL,
      action,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: details.userAgent || 'unknown',
      ip: details.ip || 'unknown',
    });
  } catch (error) {
    logger.error({ err: error, adminEmail, action }, 'ADMIN_LOG_WRITE_ERROR');
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

  await sendNotification(normalizedEmail, String(pushData?.type || 'system'), {
    title: pushTitle,
    body: text,
    jobId: pushData?.jobId || pushData?.requestId || null,
    requestId: pushData?.requestId || null,
  });
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
    const authHeader = String(req.headers.authorization || '');

    if (!authHeader.startsWith('Bearer ')) {
      return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length).trim();

    if (!token || token.length < 10) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token format');
    }

    const decodedToken = await admin.auth().verifyIdToken(token, true);
    const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Authenticated account is missing an email');
    }

    const userDoc = await adminDb.collection('users').doc(normalizedEmail).get();
    if (userDoc.exists && userDoc.data()?.banned === true) {
      return sendError(res, req, 403, 'account_banned', 'Your account has been suspended');
    }

    req.user = decodedToken;
    req.userEmail = normalizedEmail;
    return next();
  } catch (error) {
    if (error?.code === 'auth/id-token-revoked') {
      return sendError(res, req, 401, 'token_revoked', 'Session expired. Please log in again.');
    }
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

async function verifyAdminToken(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');

    if (!authHeader.startsWith('Bearer ')) {
      return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length).trim();

    if (!token || token.length < 10) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token format');
    }

    const decodedToken = await admin.auth().verifyIdToken(token, true);
    const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Authenticated account is missing an email');
    }

    const userDoc = await adminDb.collection('users').doc(normalizedEmail).get();
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const hasFirestoreAdmin = String(userData.role || '').trim().toLowerCase() === 'admin' || userData.admin === true || userData.isAdmin === true;
    const hasClaimAdmin = decodedToken.admin === true || String(decodedToken.role || '').trim().toLowerCase() === 'admin';

    if (!hasFirestoreAdmin && !hasClaimAdmin && !isAdminEmail(normalizedEmail)) {
      return sendError(res, req, 403, 'admin_access_required', 'Admin access required');
    }

    req.user = decodedToken;
    req.userEmail = normalizedEmail;
    req.adminProfile = userData;
    return next();
  } catch (error) {
    if (error?.code === 'auth/id-token-revoked') {
      return sendError(res, req, 401, 'token_revoked', 'Session expired. Please log in again.');
    }
    return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token');
  }
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
  const payoutRef = adminDb.collection(REQUEST_PAYOUT_COLLECTION).doc(String(requestId));
  let beforeData = null;
  let oldStatus = 'open';
  let payoutAmount = 0;
  let payoutCommission = 0;
  let payoutProvider = '';
  let payoutApplied = false;
  let currentStatus = 'open';

  await adminDb.runTransaction(async (tx) => {
    const [existingSnapshot, payoutSnapshot] = await Promise.all([
      tx.get(requestRef),
      tx.get(payoutRef),
    ]);

    if (!existingSnapshot.exists) {
      currentStatus = 'unknown';
      return;
    }

    beforeData = existingSnapshot.data() || {};
    currentStatus = normalizeRequestStatus(beforeData?.status || (beforeData?.paid ? 'paid' : 'open'));
    oldStatus = currentStatus;

    if (payoutSnapshot.exists && payoutSnapshot.data()?.credited === true) {
      currentStatus = 'paid';
      return;
    }

    if (!beforeData?.acceptedBy) {
      currentStatus = 'missing_provider';
      return;
    }

    if (beforeData?.paymentHold) {
      currentStatus = 'payment_hold';
      return;
    }

    if (!hasEscrowPaymentProof(beforeData) && !extraFields?.forceReconcile) {
      currentStatus = 'escrow_not_held';
      return;
    }

    if (!['completed', 'paid'].includes(currentStatus) && !extraFields?.forceReconcile) {
      currentStatus = 'invalid_status_transition';
      return;
    }

    const payoutGate = validateStatusTransitionGate({
      fromStatus: currentStatus,
      toStatus: 'paid',
      requestData: beforeData,
    });
    if (!payoutGate.ok && !extraFields?.forceReconcile) {
      currentStatus = payoutGate.reason || 'invalid_status_transition';
      return;
    }

    if (!extraFields?.forceReconcile) {
      try {
        enforceStatusTransition({
          requestData: { ...beforeData, id: requestId },
          fromStatus: currentStatus,
          toStatus: 'paid',
          actorRole: 'system',
          actorEmail: String(extraFields?.source || 'escrow-system').toLowerCase(),
          actorUid: String(extraFields?.source || 'escrow-system').toLowerCase(),
        });
      } catch (error) {
        currentStatus = error.message || 'invalid_status_transition';
        return;
      }
    }

    const requestPrice = parseMoney(beforeData?.price);
    payoutCommission = parseMoney(beforeData?.commission || (requestPrice * COMMISSION_RATE));
    payoutAmount = parseMoney(beforeData?.providerNet || beforeData?.providerPayout || (requestPrice - payoutCommission));
    payoutProvider = String(beforeData.acceptedBy || '').trim().toLowerCase();

    if (!payoutProvider || payoutAmount <= 0) {
      currentStatus = 'invalid_payout_amount';
      return;
    }

    const nowIso = new Date().toISOString();
    const userRef = adminDb.collection('users').doc(payoutProvider);

    tx.set(userRef, {
      walletBalance: admin.firestore.FieldValue.increment(payoutAmount),
      updatedAt: nowIso,
    }, { merge: true });

    const payload = {
      paid: true,
      status: 'paid',
      paymentReference,
      paymentStatus: 'success',
      paidAt: nowIso,
      escrowStatus: 'released',
      escrowReleasedAt: nowIso,
      escrowReleasedBy: extraFields?.source || 'customer_confirmation',
      providerPayout: payoutAmount,
      commission: payoutCommission,
      providerNet: payoutAmount,
      commissionRate: COMMISSION_RATE,
      payoutCredited: true,
      payoutCreditedAt: nowIso,
      payoutCreditReason: extraFields?.source || 'customer_confirmation',
      payment_released: true,
      ...extraFields,
    };

    tx.set(requestRef, payload, { merge: true });
    tx.set(payoutRef, {
      requestId,
      providerEmail: payoutProvider,
      amount: payoutAmount,
      commission: payoutCommission,
      paymentReference,
      credited: true,
      creditedAt: nowIso,
      source: extraFields?.source || 'customer_confirmation',
      updatedAt: nowIso,
    }, { merge: true });

    payoutApplied = true;
    currentStatus = 'paid';
  });

  if (!beforeData) {
    return {
      updated: false,
      reason: 'request_not_found',
    };
  }

  if (!payoutApplied) {
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: extraFields?.source || 'system',
      fromStatus: oldStatus,
      toStatus: 'paid',
      success: false,
      reason: currentStatus,
      source: 'markRequestPaid',
    });
    if (currentStatus === 'paid') {
      return {
        updated: false,
        reason: 'already_paid',
      };
    }
    if (currentStatus === 'missing_provider') {
      return {
        updated: false,
        reason: 'missing_assigned_provider',
      };
    }
    if (currentStatus === 'payment_hold') {
      return {
        updated: false,
        reason: 'payment_on_hold',
      };
    }
    if (currentStatus === 'escrow_not_held') {
      return {
        updated: false,
        reason: 'escrow_not_held',
      };
    }
    if (currentStatus === 'invalid_payout_amount') {
      return {
        updated: false,
        reason: 'invalid_payout_amount',
      };
    }
    return {
      updated: false,
      reason: 'invalid_status_transition',
      currentStatus: oldStatus,
    };
  }

  const requestPrice = parseMoney(beforeData?.price);

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
    requestData: {
      ...beforeData,
      status: 'paid',
      paid: true,
      providerNet: payoutAmount,
      providerPayout: payoutAmount,
      commission: payoutCommission,
      paymentReference,
    },
    transactionId: paymentReference,
    amount: requestPrice,
    commission: payoutCommission,
    netAmount: payoutAmount,
    status: 'SUCCESS',
    paymentMethod: extraFields?.paymentChannel || 'Escrow Release',
  });

  const paidStatePatch = {
    status: 'paid',
    paid: true,
    paymentReference,
    paymentStatus: 'success',
    paidAt: beforeData?.paidAt || new Date().toISOString(),
    escrowStatus: 'released',
    providerPayout: payoutAmount,
    commission: payoutCommission,
    providerNet: payoutAmount,
    commissionRate: COMMISSION_RATE,
    payoutCredited: true,
    payment_released: true,
  };

  await writeAuditLog({
    actorEmail: 'paystack@system',
    actorUid: 'paystack-system',
    eventType: 'payment_marked_paid',
    requestId,
    before: beforeData,
    after: { ...(beforeData || {}), ...paidStatePatch, ...extraFields },
    metadata: {
      paymentReference,
      source: extraFields?.source || 'paystack',
    },
  });

  await logStatusTransition({
    userId: beforeData?.user || null,
    jobId: requestId,
    oldStatus,
    newStatus: 'paid',
    triggeredBy: extraFields?.source === 'auto_confirmation' ? 'auto' : 'manual',
    actorEmail: extraFields?.source || 'system',
    reason: extraFields?.gatewayResponse || 'escrow_released',
  });
  await logStatusAttempt({
    jobId: requestId,
    attemptedBy: extraFields?.source || 'system',
    fromStatus: oldStatus,
    toStatus: 'paid',
    success: true,
    reason: 'payout_applied',
    source: 'markRequestPaid',
  });

  const title = beforeData?.title || `Request ${requestId}`;
  // Notify provider that they have been paid
  if (beforeData?.acceptedBy) {
    await writeNotification(
      beforeData.acceptedBy,
      `GHS ${payoutAmount.toFixed(2)} has been added to your wallet for "${title}". Reference: ${paymentReference}.`
    );
    await notifyUser(
      beforeData.acceptedBy,
      `GHS ${payoutAmount.toFixed(2)} has been added to your wallet for "${title}".`,
      'Wallet Credited',
      { screen: 'wallet', requestId, jobId: requestId }
    );

    if (isEmailConfigured()) {
      await emailTransporter.sendMail({
        from: emailFrom,
        to: beforeData.acceptedBy,
        subject: 'ConnectHub - Wallet Credited',
        html: `
          <p>Your payout has been released for <b>${title}</b>.</p>
          <p><b>Amount credited:</b> GHS ${payoutAmount.toFixed(2)}</p>
          <p><b>Reference:</b> ${paymentReference}</p>
        `,
      }).catch((error) => logger.warn({ err: error, email: beforeData.acceptedBy }, 'PAYMENT_CREDIT_EMAIL_FAILED'));
    }
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
    currentStatus: oldStatus,
  };
}

function parseMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, parseFloat(amount.toFixed(2)));
}

function isWalletTopupReference(reference) {
  return String(reference || '').trim().toLowerCase().startsWith('topup-');
}

function isWalletTopupSettled(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'success' || normalized === 'completed';
}

function resolveWalletTopupCallbackUrl(candidateUrl) {
  const rawValue = String(candidateUrl || '').trim();
  if (!rawValue) {
    return `${NORMALIZED_CALLBACK_BASE_URL}/wallet-topup-return`;
  }

  if (rawValue.startsWith(`${MOBILE_SCHEME}://wallet-topup-return`)) {
    return rawValue;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.pathname === '/wallet-topup-return' && allowedOriginSet.has(trimTrailingSlash(parsed.origin))) {
      return rawValue;
    }
  } catch {
    // Fall back to the default callback below.
  }

  return `${NORMALIZED_CALLBACK_BASE_URL}/wallet-topup-return`;
}

async function resolveWalletTopupMatch({ reference, ownerEmail, amountPesewas, allowLegacyMatch = true }) {
  const normalizedReference = String(reference || '').trim();
  const normalizedOwnerEmail = String(ownerEmail || '').trim().toLowerCase();
  const topupRef = adminDb.collection('wallet_topups').doc(normalizedReference);
  const topupSnap = await topupRef.get();

  if (topupSnap.exists) {
    const topupData = topupSnap.data() || {};
    const topupOwnerEmail = String(topupData.ownerEmail || topupData.email || '').trim().toLowerCase();
    if (topupOwnerEmail && normalizedOwnerEmail && topupOwnerEmail !== normalizedOwnerEmail) {
      return { ok: false, code: 'owner_access_required', message: 'Only the payment owner can apply this wallet top up' };
    }

    return {
      ok: true,
      topupRef,
      topupData,
      legacyTopupRef: null,
      legacyTopupData: null,
      matchType: 'direct',
    };
  }

  if (!allowLegacyMatch || !normalizedOwnerEmail) {
    return {
      ok: true,
      topupRef,
      topupData: null,
      legacyTopupRef: null,
      legacyTopupData: null,
      matchType: 'new',
    };
  }

  const [byEmailSnap, byOwnerSnap] = await Promise.all([
    adminDb.collection('wallet_topups').where('email', '==', normalizedOwnerEmail).limit(20).get(),
    adminDb.collection('wallet_topups').where('ownerEmail', '==', normalizedOwnerEmail).limit(20).get(),
  ]);

  const candidatesByPath = new Map();
  [...byEmailSnap.docs, ...byOwnerSnap.docs].forEach((docSnap) => {
    candidatesByPath.set(docSnap.ref.path, docSnap);
  });

  const candidates = Array.from(candidatesByPath.values()).filter((candidateDoc) => {
    const candidate = candidateDoc.data() || {};
    const candidateAmountPesewas = Number(candidate.amountPesewas || Math.round(Number(candidate.amountGHS || candidate.amount || 0) * 100));
    return candidateDoc.id !== normalizedReference
      && !isWalletTopupSettled(candidate.status)
      && candidate.applied !== true
      && candidateAmountPesewas === Number(amountPesewas || 0);
  });

  if (candidates.length > 1) {
    return {
      ok: false,
      code: 'ambiguous_topup_reference',
      message: 'Multiple pending wallet top ups match this payment. Contact support for manual review.',
    };
  }

  const legacyTopup = candidates[0] || null;

  return {
    ok: true,
    topupRef,
    topupData: null,
    legacyTopupRef: legacyTopup?.ref || null,
    legacyTopupData: legacyTopup?.data() || null,
    matchType: legacyTopup ? 'legacy' : 'new',
  };
}

async function applyWalletTopupCredit({
  reference,
  ownerEmail,
  amountPesewas,
  gatewayResponse = null,
  paymentChannel = null,
  source = 'wallet_topup_verify',
  allowLegacyMatch = true,
}) {
  const normalizedReference = String(reference || '').trim();
  const normalizedOwnerEmail = String(ownerEmail || '').trim().toLowerCase();
  const normalizedAmountPesewas = Number(amountPesewas || 0);
  const amountGhs = parseMoney(normalizedAmountPesewas / 100);

  if (!normalizedReference) {
    return { ok: false, code: 'missing_reference', message: 'Missing payment reference' };
  }
  if (!normalizedOwnerEmail) {
    return { ok: false, code: 'missing_user_email', message: 'Payment owner email is missing' };
  }
  if (!amountGhs || amountGhs <= 0) {
    return { ok: false, code: 'invalid_topup_amount', message: 'Top up amount is invalid' };
  }

  const matchResult = await resolveWalletTopupMatch({
    reference: normalizedReference,
    ownerEmail: normalizedOwnerEmail,
    amountPesewas: normalizedAmountPesewas,
    allowLegacyMatch,
  });

  if (!matchResult.ok) {
    return matchResult;
  }

  const {
    topupRef,
    topupData,
    legacyTopupRef,
    legacyTopupData,
    matchType,
  } = matchResult;

  const transactionRef = adminDb.collection('transactions').doc(`wallet_topup_${normalizedReference}`);
  const userRef = adminDb.collection('users').doc(normalizedOwnerEmail);
  let alreadyApplied = false;

  await adminDb.runTransaction(async (txn) => {
    const userSnap = await txn.get(userRef);
    if (!userSnap.exists) {
      throw new Error('wallet_topup_user_not_found');
    }

    const currentTopupSnap = topupData ? { exists: true, data: () => topupData } : await txn.get(topupRef);
    const currentLegacyTopupSnap = legacyTopupRef
      ? (legacyTopupData ? { exists: true, data: () => legacyTopupData, id: legacyTopupRef.id } : await txn.get(legacyTopupRef))
      : null;
    const currentTransactionSnap = await txn.get(transactionRef);

    const topupAlreadyApplied = currentTopupSnap.exists && currentTopupSnap.data()?.applied === true;
    const legacyAlreadyApplied = currentLegacyTopupSnap?.exists && currentLegacyTopupSnap.data()?.applied === true;

    if (currentTransactionSnap.exists || topupAlreadyApplied || legacyAlreadyApplied) {
      alreadyApplied = true;
      txn.set(topupRef, {
        reference: normalizedReference,
        ownerEmail: normalizedOwnerEmail,
        email: normalizedOwnerEmail,
        amount: amountGhs,
        amountGHS: amountGhs,
        amountPesewas: normalizedAmountPesewas,
        status: 'success',
        applied: true,
        appliedAt: currentTopupSnap.data()?.appliedAt || currentLegacyTopupSnap?.data()?.appliedAt || new Date().toISOString(),
        source,
        paymentChannel,
        gatewayResponse,
        verifiedReference: normalizedReference,
        linkedPendingReference: legacyTopupRef?.id || null,
      }, { merge: true });
      return;
    }

    const nowIso = new Date().toISOString();

    txn.set(userRef, {
      walletBalance: admin.firestore.FieldValue.increment(amountGhs),
      updatedAt: nowIso,
    }, { merge: true });

    txn.set(topupRef, {
      reference: normalizedReference,
      ownerEmail: normalizedOwnerEmail,
      email: normalizedOwnerEmail,
      amount: amountGhs,
      amountGHS: amountGhs,
      amountPesewas: normalizedAmountPesewas,
      status: 'success',
      applied: true,
      appliedAt: nowIso,
      creditedAt: nowIso,
      source,
      paymentChannel,
      gatewayResponse,
      verifiedReference: normalizedReference,
      linkedPendingReference: legacyTopupRef?.id || null,
      matchType,
    }, { merge: true });

    if (legacyTopupRef) {
      txn.set(legacyTopupRef, {
        ownerEmail: normalizedOwnerEmail,
        email: normalizedOwnerEmail,
        amount: amountGhs,
        amountGHS: amountGhs,
        amountPesewas: normalizedAmountPesewas,
        status: 'success',
        applied: true,
        appliedAt: nowIso,
        creditedAt: nowIso,
        verifiedReference: normalizedReference,
      }, { merge: true });
    }

    txn.set(transactionRef, {
      type: 'wallet_topup',
      reference: normalizedReference,
      transactionId: normalizedReference,
      email: normalizedOwnerEmail,
      userId: normalizedOwnerEmail,
      senderEmail: 'paystack@system',
      receiverEmail: normalizedOwnerEmail,
      amount: amountGhs,
      status: 'success',
      paymentMethod: paymentChannel || 'paystack',
      description: `Wallet top-up — GHS ${amountGhs.toFixed(2)}`,
      jobTitle: 'Wallet Top-up',
      gatewayResponse,
      source,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: nowIso,
    }, { merge: true });
  });

  if (!alreadyApplied) {
    await notifyUser(
      normalizedOwnerEmail,
      `Your wallet has been funded with GHS ${amountGhs.toFixed(2)}.`,
      'Wallet Funded',
      { screen: 'wallet', type: 'wallet_topup' }
    );
  }

  return {
    ok: true,
    alreadyApplied,
    amount: amountGhs,
    reference: normalizedReference,
  };
}

async function createWalletTopupCheckout({ actorEmail, amount, callbackUrl }) {
  const paystackSecret = getPaystackSecret();
  const normalizedEmail = String(actorEmail || '').trim().toLowerCase();
  const parsedAmount = parseMoney(amount);

  if (!normalizedEmail) {
    return { ok: false, statusCode: 401, code: 'missing_user_email', message: 'Authenticated user email is missing' };
  }
  if (!parsedAmount || parsedAmount < 1) {
    return { ok: false, statusCode: 400, code: 'invalid_amount', message: 'Top up amount must be at least GHS 1.00' };
  }
  if (!paystackSecret) {
    return { ok: false, statusCode: 500, code: 'payment_configuration_missing', message: 'Server payment configuration missing' };
  }

  const reference = `topup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amountPesewas = Math.round(parsedAmount * 100);
  const resolvedCallbackUrl = resolveWalletTopupCallbackUrl(callbackUrl);

  const paystackController = new AbortController();
  const paystackTimeout = setTimeout(() => paystackController.abort(), 10000);
  let response;
  try {
    response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: normalizedEmail,
        amount: amountPesewas,
        currency: 'GHS',
        reference,
        callback_url: resolvedCallbackUrl,
        metadata: {
          type: 'wallet_topup',
          ownerEmail: normalizedEmail,
          userEmail: normalizedEmail,
          cancel_action: `${NORMALIZED_CALLBACK_BASE_URL}/wallet`,
        },
      }),
      signal: paystackController.signal,
    });
  } finally {
    clearTimeout(paystackTimeout);
  }

  const data = await response.json();
  logger.info({ paystackStatus: data?.status, ref: data?.data?.reference || reference, ownerEmail: normalizedEmail }, 'WALLET_TOPUP_INIT_RESPONSE');

  if (!response.ok || !data?.status || !data?.data?.authorization_url) {
    return {
      ok: false,
      statusCode: response.status || 500,
      code: 'wallet_topup_init_failed',
      message: data?.message || 'Could not initialize wallet top up',
    };
  }

  await adminDb.collection('wallet_topups').doc(reference).set({
    reference,
    ownerEmail: normalizedEmail,
    email: normalizedEmail,
    amount: parsedAmount,
    amountGHS: parsedAmount,
    amountPesewas,
    status: 'pending',
    source: 'server_initiated',
    authorizationUrl: data.data.authorization_url,
    callbackUrl: resolvedCallbackUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference,
    amount: parsedAmount,
  };
}

function normalizeGhanaPhone(phone) {
  let cleaned = String(phone || '').replace(/[\s\-\(\)\+]/g, '').trim();

  // Strip country code prefix
  if (cleaned.startsWith('00233')) cleaned = `0${cleaned.slice(5)}`;
  else if (cleaned.startsWith('233') && cleaned.length >= 12) cleaned = `0${cleaned.slice(3)}`;

  // Must be 10-digit starting with 0, second digit 2-5 covers all Ghana prefixes:
  // MTN: 024,025,054,055,059  Telecel: 020,050  AirtelTigo: 026,027,056,057  others: 028,059
  if (!/^0[2-9][0-9]{8}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
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
    const activeSnapshot = await adminDb
      .collection('users')
      .where('subscriptionStatus', '==', 'active')
      .get();

    const snapshotDocs = activeSnapshot.docs.filter((docItem) => {
      const userData = docItem.data() || {};
      const expiryIso = String(userData.subscriptionExpiry || '');
      return Boolean(expiryIso) && expiryIso <= nowIso;
    });

    if (snapshotDocs.length === 0) {
      return;
    }

    await Promise.all(snapshotDocs.map(async (docItem) => {
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

  try {
    enforceStatusTransition({
      requestData: { ...beforeData, id: requestId },
      fromStatus: currentStatus,
      toStatus: 'in_progress',
      actorRole: 'system',
      actorEmail: String(extraFields?.source || 'payment-system').toLowerCase(),
      actorUid: String(extraFields?.source || 'payment-system').toLowerCase(),
    });
  } catch (error) {
    return { updated: false, reason: error.message || 'invalid_status_transition', currentStatus };
  }

  if (!beforeData?.acceptedBy) {
    return { updated: false, reason: 'missing_assigned_provider', currentStatus };
  }

  const fundingGate = validateStatusTransitionGate({
    fromStatus: currentStatus,
    toStatus: 'in_progress',
    requestData: {
      ...beforeData,
      paymentStatus: 'success',
      paymentReference,
      escrowFunded: true,
      payment_received: true,
    },
  });
  if (!fundingGate.ok) {
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: extraFields?.source || 'paystack',
      fromStatus: currentStatus,
      toStatus: 'in_progress',
      success: false,
      reason: fundingGate.reason,
      source: 'markRequestEscrowFunded',
    });
    return { updated: false, reason: fundingGate.reason, currentStatus };
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
    payment_received: true,
    paymentReceivedAt: now,
    work_started: true,
    workStartedAt: beforeData?.workStartedAt || now,
    work_completed: false,
    customer_confirmed: false,
    payment_released: false,
    commission,
    providerNet,
    commissionRate: COMMISSION_RATE,
    paid: false,
    ...extraFields,
  };

  await requestRef.set(payload, { merge: true });

  await logStatusTransition({
    userId: beforeData?.user || null,
    jobId: requestId,
    oldStatus: currentStatus,
    newStatus: 'in_progress',
    triggeredBy: 'auto',
    actorEmail: extraFields?.source || 'paystack-system',
    reason: `escrow_funded:${paymentReference}`,
  });
  await logStatusAttempt({
    jobId: requestId,
    attemptedBy: extraFields?.source || 'paystack',
    fromStatus: currentStatus,
    toStatus: 'in_progress',
    success: true,
    reason: 'escrow_payment_verified',
    source: 'markRequestEscrowFunded',
  });

  const title = beforeData?.title || `Request ${requestId}`;
  if (beforeData?.acceptedBy) {
    await notifyUser(
      beforeData.acceptedBy,
      `Customer has funded escrow for "${title}". You can now begin work.`,
      'Payment Received!',
      { type: 'payment_received', screen: 'job-details', requestId, jobId: requestId }
    );
  }
  if (beforeData?.user) {
    await notifyUser(
      beforeData.user,
      `Escrow payment received for "${title}". Your job is now in progress.`,
      'Escrow Funded',
      { type: 'payment_received', screen: 'job-details', requestId, jobId: requestId }
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
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0',
    service: 'ConnectHub API',
  });
});

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many requests. Please slow down.' },
  skip: (req) => req.path === '/health',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_auth_attempts', message: 'Too many auth attempts. Please wait 15 minutes.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_otp_attempts', message: 'Too many verification attempts. Please wait and try again.' },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_payment_requests', message: 'Too many payment requests. Please wait a moment.' },
});

const usernameChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, error: 'rate_limited', message: 'Too many username change attempts. Please wait before trying again.' },
});

const usernameAuditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, error: 'rate_limited', message: 'Too many requests. Please wait a moment.' },
});

app.use(generalLimiter);
app.use('/auth', authLimiter);
app.use('/auth/send-otp', otpLimiter);
app.use('/auth/verify-otp', otpLimiter);
app.use('/subscription', paymentLimiter);
app.use('/wallet/withdraw', paymentLimiter);
app.use('/profile/username/change', usernameChangeLimiter);
app.use('/profile/username/audit', usernameAuditLimiter);

app.post('/auth/send-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const rawPhone = String(req.body?.phone || '').trim();

    if (!email || !rawPhone) {
      await logSignupFailure({
        email,
        errorType: 'missing_otp_fields',
        errorMessage: 'Phone and email are required',
        source: 'otp_send',
      });
      return sendError(res, req, 400, 'missing_otp_fields', 'Phone and email are required');
    }

    if (!isValidEmailFormat(email)) {
      await logSignupFailure({
        email,
        errorType: 'invalid_email_format',
        errorMessage: 'Email does not match standard format',
        source: 'otp_send',
      });
      return sendError(res, req, 400, 'invalid_email', 'Please enter a valid email address.');
    }

    const normalizedPhone = normalizeGhanaPhone(rawPhone);
    if (!normalizedPhone) {
      await logSignupFailure({
        email,
        errorType: 'invalid_phone',
        errorMessage: 'Invalid Ghana phone format',
        source: 'otp_send',
      });
      return sendError(res, req, 400, 'invalid_phone', 'Enter a valid Ghana phone number (e.g. 0241234567)');
    }

    const existingUser = await admin.auth().getUserByEmail(email).catch((error) => {
      if (error?.code === 'auth/user-not-found') return null;
      throw error;
    });
    if (existingUser) {
      await logSignupFailure({
        email,
        errorType: 'email_already_registered',
        errorMessage: 'Email is already registered',
        source: 'otp_send',
      });
      return sendError(res, req, 409, 'email_already_registered', 'This email address is already registered. Please log in instead.');
    }

    const existingOtp = await getOTP(email);
    if (existingOtp?.lockedUntil && Date.now() < Number(existingOtp.lockedUntil || 0)) {
      const remainingMs = Number(existingOtp.lockedUntil || 0) - Date.now();
      const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
      await logSignupFailure({
        email,
        errorType: 'otp_locked',
        errorMessage: `OTP verification locked for ${remainingMinutes} minute(s)`,
        source: 'otp_send',
      });
      return sendError(res, req, 429, 'otp_locked', `Too many failed attempts. Please wait ${remainingMinutes} minute(s) before requesting a new code.`);
    }

    if (existingOtp?.resendAllowedAt && Date.now() < Number(existingOtp.resendAllowedAt || 0)) {
      const remainingSeconds = Math.max(1, Math.ceil((Number(existingOtp.resendAllowedAt || 0) - Date.now()) / 1000));
      await logSignupFailure({
        email,
        errorType: 'otp_cooldown_active',
        errorMessage: `Resend cooldown active (${remainingSeconds}s remaining)`,
        source: 'otp_send',
      });
      return sendError(res, req, 429, 'otp_cooldown_active', 'Too many attempts. Please wait 60 seconds before requesting a new code.', { retryAfterSeconds: remainingSeconds });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    try {
      await storeOTP(email, otp, normalizedPhone);
    } catch (storeError) {
      logger.error({ err: storeError, email }, 'STORE_OTP_ERROR');
      await logSignupFailure({
        email,
        errorType: 'otp_store_failed',
        errorMessage: storeError?.message || 'Could not persist OTP',
        source: 'otp_send',
      });
      return sendError(res, req, 500, 'otp_store_failed', 'Could not create verification code. Please try again.');
    }

    if (!isEmailConfigured()) {
      await logSignupFailure({
        email,
        errorType: 'email_service_not_configured',
        errorMessage: 'Verification email service is not configured',
        source: 'otp_send',
      });
      return sendError(res, req, 503, 'email_service_unavailable', 'Could not connect to email service. Please try again in a moment.');
    }

    try {
      logger.info({ domain: String(email).split('@')[1] || 'unknown' }, 'OTP_EMAIL_DISPATCHED');
      await sendPaymentReceiptEmail(
        email,
        'ConnectHub User',
        'Your ConnectHub Verification Code',
        `<div style="font-family:sans-serif;text-align:center;padding:28px;">
          <h2>ConnectHub Verification</h2>
          <p>Your verification code is:</p>
          <div style="font-size:42px;font-weight:700;letter-spacing:10px;background:#f0f9ff;padding:16px;border-radius:12px;margin:16px 0;">${otp}</div>
          <p style="color:#64748b;">This code expires in 10 minutes.</p>
        </div>`
      );
    } catch (emailError) {
      logger.error({ err: emailError, email }, 'SEND_OTP_EMAIL_ERROR');
      await logSignupFailure({
        email,
        errorType: 'otp_email_send_failed',
        errorMessage: emailError?.message || 'Could not send OTP email',
        source: 'otp_send',
      });
      return sendError(res, req, 503, 'otp_email_send_failed', 'Could not connect to email service. Please try again in a moment.');
    }

    return sendSuccess(res, req, { message: 'Verification code sent to your email' });
  } catch (error) {
    logger.error({ err: error }, 'SEND_OTP_ERROR');
    await logSignupFailure({
      email: req.body?.email,
      errorType: 'otp_send_failed',
      errorMessage: error?.message || 'Could not send verification code',
      source: 'otp_send',
    });
    return sendError(res, req, 500, 'otp_send_failed', 'Could not send verification code');
  }
});

app.post('/auth/verify-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();

    if (!email || !otp) {
      return sendError(res, req, 400, 'missing_verify_fields', 'Email and OTP are required');
    }

    if (!isValidEmailFormat(email)) {
      return sendError(res, req, 400, 'invalid_email', 'Please enter a valid email address.');
    }

    if (!/^\d{6}$/.test(otp)) {
      return sendError(res, req, 400, 'invalid_otp_format', 'Enter the 6-digit verification code.');
    }

    const stored = await getOTP(email);
    if (!stored) {
      return sendError(res, req, 400, 'otp_not_found', 'No verification code found. Request a new one.');
    }

    if (stored.lockedUntil && Date.now() < Number(stored.lockedUntil || 0)) {
      const remainingMinutes = Math.max(1, Math.ceil((Number(stored.lockedUntil || 0) - Date.now()) / (60 * 1000)));
      return sendError(res, req, 429, 'otp_locked', `Too many failed attempts. Please wait ${remainingMinutes} minute(s) before trying again.`);
    }

    // Existing registered users should never be blocked by signup OTP gate.
    const authUser = await admin.auth().getUserByEmail(email).catch((error) => {
      if (error?.code === 'auth/user-not-found') return null;
      throw error;
    });
    if (authUser) {
      await adminDb.collection('users').doc(email).set({
        phoneVerified: true,
        verifiedPhone: String(stored.phone || ''),
        phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await deleteOTP(email);
      return sendSuccess(res, req, { message: 'Account already registered; OTP verification skipped.' });
    }

    if (stored.otp !== otp) {
      const { nextFailures, lockUntil } = await incrementOTPFailure(email, stored.failedAttempts || 0);
      if (lockUntil > Date.now()) {
        await logSignupFailure({
          email,
          errorType: 'otp_locked_after_failures',
          errorMessage: `Exceeded ${OTP_MAX_VERIFY_ATTEMPTS} failed attempts`,
          source: 'otp_verify',
        });
        return sendError(res, req, 429, 'otp_locked', `Too many failed attempts. Please wait ${OTP_LOCK_MINUTES} minutes before trying again.`);
      }
      return sendError(res, req, 400, 'otp_mismatch', 'Incorrect code. Please check and try again.');
    }

    await markOTPVerified(email);
    await adminDb.collection('users').doc(email).set({
      phoneVerified: true,
      verifiedPhone: String(stored.phone || ''),
      phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return sendSuccess(res, req, { message: 'Phone verified successfully' });
  } catch (error) {
    logger.error({ err: error }, 'VERIFY_OTP_ERROR');
    await logSignupFailure({
      email: req.body?.email,
      errorType: 'otp_verify_failed',
      errorMessage: error?.message || 'Verification failed',
      source: 'otp_verify',
    });
    return sendError(res, req, 500, 'otp_verify_failed', 'Verification failed');
  }
});

app.post('/auth/signup-error-log', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const errorType = String(req.body?.errorType || 'client_signup_error').trim().toLowerCase();
    const errorMessage = String(req.body?.errorMessage || 'Signup failed on client').trim();
    const source = String(req.body?.source || 'client').trim().toLowerCase();
    const metadata = req.body?.metadata || {};

    if (email && !isValidEmailFormat(email)) {
      return sendError(res, req, 400, 'invalid_email', 'Please enter a valid email address.');
    }

    await logSignupFailure({ email, errorType, errorMessage, source, metadata });
    return sendSuccess(res, req, { message: 'Signup error logged' });
  } catch (error) {
    logger.error({ err: error }, 'SIGNUP_ERROR_LOG_ENDPOINT_ERROR');
    return sendError(res, req, 500, 'signup_error_log_failed', 'Could not log signup error');
  }
});

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
    if (!email || !isValidEmailFormat(String(email)) || !normalizedAmount || normalizedAmount <= 0 || !requestId) {
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
      const referenceRequestId = String(requestId || '').trim();
      const eventReference = String(data?.data?.reference || '').trim();
      const chargedAmount = parseMoney(Number(data?.data?.amount || 0) / 100);
      const requestPrice = parseMoney(requestData?.price);

      if (!referenceRequestId || !eventReference) {
        return sendError(res, req, 409, 'invalid_payment_reference', 'Payment verification payload is missing request metadata');
      }

      if (!ownerEmail || ownerEmail !== actorEmail) {
        return sendError(res, req, 403, 'owner_access_required', 'Only the customer can verify and apply this payment');
      }

      if (Math.abs(chargedAmount - requestPrice) > 0.01) {
        return sendError(res, req, 409, 'amount_mismatch', 'Verified payment amount does not match request amount');
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

async function checkWithdrawalFraud(email, amount) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentWithdrawals = await adminDb
    .collection('withdrawals')
    .where('email', '==', email)
    .where('status', 'in', ['pending_admin_approval', 'completed'])
    .limit(50)
    .get();

  const recentCount = recentWithdrawals.docs.filter((docSnap) => {
    const row = docSnap.data() || {};
    const ts = toMillis(row.requestedAt || row.createdAt);
    return ts > 0 && ts > oneDayAgo;
  }).length;

  if (recentCount >= 3) {
    await adminDb.collection('fraudAlerts').add({
      type: 'excessive_withdrawals',
      email,
      count: recentCount,
      amount,
      resolved: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await adminDb.collection('notifications').add({
      userId: ADMIN_EMAIL,
      title: 'Fraud Alert: Multiple Withdrawals',
      body: `${email} has made ${recentCount} withdrawal requests in 24 hours.`,
      type: 'fraud_alert',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { flagged: true, reason: 'Too many withdrawals in 24 hours' };
  }

  const userDoc = await adminDb.collection('users').doc(email).get();
  const balance = parseMoney(userDoc.data()?.walletBalance || 0);
  if (amount > 500 && amount > balance * 0.9) {
    await adminDb.collection('fraudAlerts').add({
      type: 'large_withdrawal',
      email,
      amount,
      balance,
      resolved: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { flagged: false };
}

async function checkJobSpam(email) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentJobs = await adminDb.collection('requests').where('user', '==', email).limit(50).get();
  const recentCount = recentJobs.docs.filter((docSnap) => {
    const ts = toMillis(docSnap.data()?.createdAt);
    return ts > 0 && ts > oneHourAgo;
  }).length;

  if (recentCount >= 10) {
    await adminDb.collection('fraudAlerts').add({
      type: 'job_spam',
      email,
      count: recentCount,
      resolved: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { blocked: true, message: 'Too many job posts in a short time. Please wait before posting again.' };
  }

  return { blocked: false };
}

// ── MoMo network code mapper ──────────────────────────────────────────────────
// ── Manual-queue fallback (called when Paystack instant transfer is unavailable) ─
async function queueWithdrawalManually({
  res, req, userRef, userData, actorEmail, amount, provider,
  bankCodeUsed, phoneUsed, accountName, withdrawalRef, nowIso, fraudCheck,
  fallbackReason, paystackError, recipientCode,
}) {
  const withdrawalDocRef = adminDb.collection('wallet_withdrawals').doc(withdrawalRef);
  const legacyWithdrawalDocRef = adminDb.collection('withdrawals').doc();
  const transactionDocRef = adminDb.collection('transactions').doc();

  await adminDb.runTransaction(async (tx) => {
    const freshUserSnap = await tx.get(userRef);
    const freshBalance = parseMoney(freshUserSnap.data()?.walletBalance || 0);
    if (amount > freshBalance) {
      const err = new Error(`Insufficient balance. Current balance is GHS ${freshBalance.toFixed(2)}`);
      err.statusCode = 400; err.errorCode = 'insufficient_balance';
      throw err;
    }
    tx.set(userRef, { walletBalance: admin.firestore.FieldValue.increment(-amount), updatedAt: nowIso }, { merge: true });
    tx.set(withdrawalDocRef, {
      reference: withdrawalRef, userEmail: actorEmail,
      displayName: userData.displayName || actorEmail,
      amount, provider, bankCode: bankCodeUsed, phoneNumber: phoneUsed,
      accountName, recipientCode: recipientCode || null,
      transferCode: null, status: 'PENDING', manualQueue: true,
      paystackFallbackReason: fallbackReason || null,
      paystackError: paystackError || null,
      fraudFlagged: Boolean(fraudCheck?.flagged),
      fraudReason: fraudCheck?.flagged ? String(fraudCheck.reason || 'risk_signal') : null,
      refunded: false,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedAtIso: nowIso, completedAt: null, failedAt: null,
      failureReason: null, transferStatusEvent: null, updatedAt: nowIso,
    });
    tx.set(legacyWithdrawalDocRef, {
      type: 'withdrawal', status: 'pending_admin_approval',
      email: actorEmail, displayName: userData.displayName || actorEmail,
      amount, provider, bankCode: bankCodeUsed, phoneNumber: phoneUsed,
      accountName, reference: withdrawalRef, walletWithdrawalId: withdrawalRef,
      transferCode: null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: null, processedBy: null,
      notes: `Auto-queue fallback: ${fallbackReason || 'paystack_unavailable'}. Needs manual payout.`,
      fraudFlagged: Boolean(fraudCheck?.flagged),
      fraudReason: fraudCheck?.flagged ? String(fraudCheck.reason || 'risk_signal') : null,
    });
    tx.set(transactionDocRef, {
      transactionId: withdrawalRef, type: 'withdrawal',
      senderEmail: actorEmail, receiverEmail: actorEmail, userId: actorEmail,
      amount, provider, bankCode: bankCodeUsed, phoneNumber: phoneUsed,
      accountName, reference: withdrawalRef, walletWithdrawalId: withdrawalRef,
      transferCode: null, status: 'pending',
      paymentMethod: `MoMo (${provider})`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(), createdAt: nowIso,
    });
  });

  await notifyUser(
    actorEmail,
    `Your withdrawal of GHS ${amount.toFixed(2)} to ${provider} (${phoneUsed}) has been received and is queued for processing. You'll be notified once it's complete. Reference: ${withdrawalRef}`,
    'Withdrawal Received',
    { screen: 'withdrawal-history', reference: withdrawalRef }
  );

  // Alert admin
  await adminDb.collection('notifications').add({
    userId: ADMIN_EMAIL,
    title: 'Manual Withdrawal Required',
    body: `${actorEmail} needs GHS ${amount.toFixed(2)} to ${provider} ${phoneUsed}. Instant Paystack failed: ${paystackError || 'unknown'}. Ref: ${withdrawalRef}`,
    type: 'withdrawal_manual', read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});

  if (isEmailConfigured()) {
    const adminWithdrawalsUrl = `${trimTrailingSlash(WEB_BASE_URL)}/admin`;
    sendPaymentReceiptEmail(
      actorEmail, userData.displayName || actorEmail,
      'Withdrawal Request Received — ConnectHub',
      `<p>Dear ${userData.displayName || actorEmail},</p>
       <p>Your withdrawal request has been received and is being reviewed by our team.</p>
       <table style="width:100%;border-collapse:collapse;">
         <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Amount</b></td><td style="padding:8px;border:1px solid #e2e8f0;">GHS ${amount.toFixed(2)}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Network</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${provider}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>MoMo Number</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${phoneUsed}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Reference</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${withdrawalRef}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Status</b></td><td style="padding:8px;border:1px solid #e2e8f0;">Queued — under review</td></tr>
       </table>
       <p>We will process this as soon as possible. Thank you for your patience.</p>`
    ).catch((err) => logger.warn({ err, actorEmail }, 'QUEUED_WITHDRAWAL_EMAIL_FAILED'));

    const adminRecipients = ADMIN_EMAILS.length > 0 ? ADMIN_EMAILS : [ADMIN_EMAIL];
    emailTransporter.sendMail({
      from: emailFrom,
      to: adminRecipients.join(','),
      subject: `ConnectHub - Manual Withdrawal Required (${withdrawalRef})`,
      html: `
        <p>A withdrawal has been queued for manual processing because instant transfer failed.</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>User</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${actorEmail}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Amount</b></td><td style="padding:8px;border:1px solid #e2e8f0;">GHS ${amount.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Network</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${provider}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>MoMo Number</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${phoneUsed}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Reference</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${withdrawalRef}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Fallback Reason</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${fallbackReason || 'paystack_unavailable'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Paystack Error</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${paystackError || 'unknown'}</td></tr>
        </table>
        <p>Please process this payout from the admin withdrawals dashboard.</p>
        <p>
          <a href="${adminWithdrawalsUrl}" style="display:inline-block;padding:10px 14px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
            Open Admin Withdrawals
          </a>
        </p>
        <p>If the button does not work, copy this link: ${adminWithdrawalsUrl}</p>
      `,
    }).catch((err) => logger.warn({ err, withdrawalRef }, 'QUEUED_WITHDRAWAL_ADMIN_EMAIL_FAILED'));
  }

  logger.info({ actorEmail, amount, provider, withdrawalRef, fallbackReason, paystackError }, 'WITHDRAWAL_QUEUED_MANUAL_FALLBACK');

  return sendSuccess(res, req, {
    message: 'Your withdrawal request has been received and is being processed.',
    data: {
      reference: withdrawalRef, withdrawalId: withdrawalRef,
      transferCode: null, amount, provider,
      phoneNumber: phoneUsed, status: 'queued',
    },
  });
}

function mapNetworkToPaystackCodes(networkLabel) {
  const n = String(networkLabel || '').toLowerCase().replace(/\s+/g, '');
  if (n.includes('mtn')) return ['mtn', 'MTN'];
  if (n.includes('telecel') || n.includes('vodafone') || n.includes('vod')) return ['vod', 'VOD'];
  if (n.includes('airteltigo') || n.includes('airtel') || n.includes('tigo') || n.includes('atl')) return ['atl', 'ATL'];
  return [];
}

function mapNetworkToPaystackCode(networkLabel) {
  return mapNetworkToPaystackCodes(networkLabel)[0] || null;
}

function buildGhanaPhoneVariants(normalizedPhone) {
  const local = String(normalizedPhone || '').trim();
  if (!local) return [];
  const variants = [local];
  if (/^0\d{9}$/.test(local)) {
    variants.push(`233${local.slice(1)}`);
  }
  return Array.from(new Set(variants));
}

async function createPaystackRecipient({ name, accountNumber, bankCode, paystackSecret }) {
  const response = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'mobile_money',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'GHS',
    }),
  });
  const data = await response.json();
  return { ok: response.ok && data?.status, data };
}

async function initiatePaystackTransfer({ recipientCode, amount, reference, reason, paystackSecret }) {
  const response = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(amount * 100), // kobo
      recipient: recipientCode,
      reference,
      reason: reason || 'ConnectHub wallet withdrawal',
      currency: 'GHS',
    }),
  });
  const data = await response.json();
  return { ok: response.ok && data?.status, data };
}

async function retryWalletWithdrawalInstant({ withdrawalRef, withdrawalId, wd, paystackSecret, actorEmail, retryMode = 'manual' }) {
  const status = String(wd.status || '').toUpperCase();
  if (!['PENDING', 'FAILED', 'PROCESSING'].includes(status)) {
    const err = new Error(`Cannot retry a withdrawal with status "${wd.status}"`);
    err.statusCode = 409;
    err.errorCode = 'invalid_status';
    throw err;
  }

  const retryRef = `${String(wd.reference || withdrawalId).split('_RETRY_')[0]}_RETRY_${Date.now()}`;
  let useRecipientCode = wd.recipientCode || null;

  if (!useRecipientCode) {
    const retryPhones = buildGhanaPhoneVariants(normalizeGhanaPhone(wd.phoneNumber) || wd.phoneNumber);
    const retryCodes = wd.bankCode ? [wd.bankCode] : mapNetworkToPaystackCodes(wd.provider);
    let recipientResult = null;

    for (const accountNumber of retryPhones) {
      for (const bankCodeCandidate of retryCodes) {
        const attempt = await createPaystackRecipient({
          name: wd.accountName || wd.displayName || wd.userEmail,
          accountNumber,
          bankCode: bankCodeCandidate,
          paystackSecret,
        });
        recipientResult = attempt;
        if (attempt?.ok) break;
      }
      if (recipientResult?.ok) break;
    }

    if (!recipientResult?.ok) {
      const err = new Error(recipientResult?.data?.message || 'Could not create recipient');
      err.statusCode = 502;
      err.errorCode = 'recipient_creation_failed';
      throw err;
    }
    useRecipientCode = recipientResult.data?.data?.recipient_code;
  }

  const transferResult = await initiatePaystackTransfer({
    recipientCode: useRecipientCode,
    amount: parseMoney(wd.amount),
    reference: retryRef,
    reason: `ConnectHub retry withdrawal — ${wd.userEmail}`,
    paystackSecret,
  });

  if (!transferResult.ok) {
    const err = new Error(transferResult.data?.message || 'Transfer failed');
    err.statusCode = 502;
    err.errorCode = 'transfer_failed';
    throw err;
  }

  const newTransferCode = String(transferResult.data?.data?.transfer_code || '').trim();
  const nowIso = new Date().toISOString();
  const updatePayload = {
    status: 'PROCESSING',
    reference: retryRef,
    recipientCode: useRecipientCode || null,
    transferCode: newTransferCode || null,
    retryCount: admin.firestore.FieldValue.increment(1),
    lastRetriedAt: nowIso,
    lastRetriedBy: actorEmail,
    failureReason: null,
    updatedAt: nowIso,
  };

  if (retryMode === 'auto') {
    updatePayload.autoRetryCount = admin.firestore.FieldValue.increment(1);
    updatePayload.lastAutoRetriedAt = nowIso;
  }

  await withdrawalRef.set(updatePayload, { merge: true });
  return { retryRef, transferCode: newTransferCode, nowIso };
}

app.post('/wallet/withdraw', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const requestedEmail = String(req.body?.email || '').trim().toLowerCase();
    const amount = parseMoney(req.body?.amount);
    const accountName = String(req.body?.accountName || '').trim();
    const provider = String(req.body?.provider || req.body?.network || '').trim();
    const rawPhoneNumber = String(req.body?.phoneNumber || '').trim();
    const normalizedPhone = normalizeGhanaPhone(rawPhoneNumber);
    const nowIso = new Date().toISOString();
    const paystackSecret = getPaystackSecret();

    // ── FIX 2: Validation gates ───────────────────────────────────────────────
    if (!actorEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Could not determine authenticated user');
    }
    if (requestedEmail && requestedEmail !== actorEmail) {
      return sendError(res, req, 403, 'email_mismatch', 'Email must match authenticated user');
    }
    if (!Number.isFinite(amount) || amount < 10) {
      return sendError(res, req, 400, 'invalid_amount', 'Minimum withdrawal is GHS 10');
    }
    if (!accountName || !provider || !rawPhoneNumber) {
      return sendError(res, req, 400, 'missing_fields', 'Account name, network, and phone are required');
    }
    if (!normalizedPhone) {
      return sendError(res, req, 400, 'invalid_phone', 'Enter a valid 10-digit Ghana MoMo number starting with 0');
    }
    const bankCodes = mapNetworkToPaystackCodes(provider);
    if (bankCodes.length === 0) {
      return sendError(res, req, 400, 'invalid_network', 'Network must be MTN, Telecel, or AirtelTigo');
    }
    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Payment service is not configured');
    }

    // ── Pre-flight Firestore checks (outside transaction for speed) ───────────
    const userRef = adminDb.collection('users').doc(actorEmail);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return sendError(res, req, 404, 'user_not_found', 'User not found');
    }
    const userData = userSnap.data() || {};

    if (String(userData.kycStatus || '').trim().toLowerCase() !== 'verified') {
      return sendError(res, req, 403, 'kyc_required', 'Your account must be KYC verified before withdrawing');
    }

    const walletBalance = parseMoney(userData.walletBalance || 0);
    if (amount > walletBalance) {
      return sendError(res, req, 400, 'insufficient_balance', `Insufficient balance. Your balance is GHS ${walletBalance.toFixed(2)}`);
    }

    // Block duplicate pending withdrawals
    const pendingSnap = await adminDb.collection('wallet_withdrawals')
      .where('userEmail', '==', actorEmail)
      .where('status', 'in', ['PENDING', 'PROCESSING'])
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return sendError(res, req, 409, 'withdrawal_already_pending', 'You already have a pending withdrawal. Wait for it to complete before submitting another.');
    }

    const fraudCheck = await checkWithdrawalFraud(actorEmail, amount);

    // ── FIX 1: Instant Paystack Transfer ─────────────────────────────────────
    const withdrawalRef = `WD_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Step A: Create transfer recipient
    const accountNumbers = buildGhanaPhoneVariants(normalizedPhone);
    let recipientResult = null;
    let recipientPhoneUsed = normalizedPhone;
    let bankCodeUsed = bankCodes[0] || null;
    let lastRecipientMessage = '';

    for (const accountNumber of accountNumbers) {
      for (const bankCodeCandidate of bankCodes) {
        const attempt = await createPaystackRecipient({
          name: accountName,
          accountNumber,
          bankCode: bankCodeCandidate,
          paystackSecret,
        });
        recipientResult = attempt;
        lastRecipientMessage = String(attempt?.data?.message || '').trim();

        if (attempt?.ok) {
          recipientPhoneUsed = accountNumber;
          bankCodeUsed = bankCodeCandidate;
          break;
        }
      }
      if (recipientResult?.ok) break;
    }

    // ── Paystack recipient creation failed → queue for manual processing ──────
    if (!recipientResult?.ok) {
      logger.warn({
        provider, normalizedPhone, bankCodes, accountNumbers,
        paystackMessage: lastRecipientMessage,
      }, 'PAYSTACK_RECIPIENT_CREATION_FAILED_QUEUING');
      return await queueWithdrawalManually({
        res, req, userRef, userData, actorEmail, amount, provider,
        bankCodeUsed: bankCodeUsed || bankCodes[0] || '',
        phoneUsed: normalizedPhone,
        accountName, withdrawalRef, nowIso, fraudCheck,
        fallbackReason: `recipient_creation_failed: ${lastRecipientMessage || 'Paystack did not accept recipient'}`,
        paystackError: lastRecipientMessage,
        recipientCode: null,
      });
    }

    const recipientCode = String(recipientResult.data?.data?.recipient_code || '').trim();
    if (!recipientCode) {
      logger.warn({ normalizedPhone, provider }, 'PAYSTACK_MISSING_RECIPIENT_CODE_QUEUING');
      return await queueWithdrawalManually({
        res, req, userRef, userData, actorEmail, amount, provider,
        bankCodeUsed: bankCodeUsed || bankCodes[0] || '',
        phoneUsed: normalizedPhone,
        accountName, withdrawalRef, nowIso, fraudCheck,
        fallbackReason: 'recipient_code_missing',
        paystackError: 'Paystack did not return a recipient code',
        recipientCode: null,
      });
    }

    // Step B: Initiate transfer
    const transferResult = await initiatePaystackTransfer({
      recipientCode,
      amount,
      reference: withdrawalRef,
      reason: `ConnectHub withdrawal — ${actorEmail}`,
      paystackSecret,
    });

    if (!transferResult.ok) {
      const paystackMsg = String(transferResult.data?.message || '').trim();
      logger.warn({ transferResult, paystackMsg }, 'PAYSTACK_TRANSFER_INITIATION_FAILED_QUEUING');
      return await queueWithdrawalManually({
        res, req, userRef, userData, actorEmail, amount, provider,
        bankCodeUsed,
        phoneUsed: recipientPhoneUsed,
        accountName, withdrawalRef, nowIso, fraudCheck,
        fallbackReason: `transfer_initiation_failed: ${paystackMsg || 'unknown'}`,
        paystackError: paystackMsg,
        recipientCode,
      });
    }

    const transferCode = String(transferResult.data?.data?.transfer_code || '').trim();
    const transferStatus = String(transferResult.data?.data?.status || 'pending').toUpperCase();

    // Step C: Atomically deduct wallet + write records
    const withdrawalDocRef = adminDb.collection('wallet_withdrawals').doc(withdrawalRef);
    const legacyWithdrawalDocRef = adminDb.collection('withdrawals').doc();
    const transactionDocRef = adminDb.collection('transactions').doc();

    await adminDb.runTransaction(async (tx) => {
      // Re-read balance inside transaction for safety
      const freshUserSnap = await tx.get(userRef);
      const freshBalance = parseMoney(freshUserSnap.data()?.walletBalance || 0);
      if (amount > freshBalance) {
        const err = new Error(`Insufficient balance. Current balance is GHS ${freshBalance.toFixed(2)}`);
        err.statusCode = 400;
        err.errorCode = 'insufficient_balance';
        throw err;
      }

      // Deduct wallet
      tx.set(userRef, {
        walletBalance: admin.firestore.FieldValue.increment(-amount),
        updatedAt: nowIso,
      }, { merge: true });

      // Primary withdrawal record (wallet_withdrawals — webhook looks here)
      tx.set(withdrawalDocRef, {
        reference: withdrawalRef,
        userEmail: actorEmail,
        displayName: userData.displayName || actorEmail,
        amount,
        provider,
        bankCode: bankCodeUsed,
        phoneNumber: recipientPhoneUsed,
        accountName,
        recipientCode,
        transferCode: transferCode || null,
        status: transferStatus === 'SUCCESS' ? 'COMPLETED' : 'PROCESSING',
        fraudFlagged: Boolean(fraudCheck.flagged),
        fraudReason: fraudCheck.flagged ? String(fraudCheck.reason || 'risk_signal') : null,
        refunded: false,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedAtIso: nowIso,
        completedAt: null,
        failedAt: null,
        failureReason: null,
        transferStatusEvent: null,
        updatedAt: nowIso,
      });

      // Legacy withdrawals record (for admin backward-compat)
      tx.set(legacyWithdrawalDocRef, {
        type: 'withdrawal',
        status: 'processing',
        email: actorEmail,
        displayName: userData.displayName || actorEmail,
        amount,
        provider,
        bankCode: bankCodeUsed,
        phoneNumber: recipientPhoneUsed,
        accountName,
        reference: withdrawalRef,
        walletWithdrawalId: withdrawalRef,
        transferCode: transferCode || null,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: null,
        processedBy: 'paystack_instant',
        notes: `Paystack transfer ${transferCode || 'initiated'}`,
        fraudFlagged: Boolean(fraudCheck.flagged),
        fraudReason: fraudCheck.flagged ? String(fraudCheck.reason || 'risk_signal') : null,
      });

      // Transaction record
      tx.set(transactionDocRef, {
        transactionId: withdrawalRef,
        requestId: null,
        type: 'withdrawal',
        senderEmail: actorEmail,
        receiverEmail: actorEmail,
        userId: actorEmail,
        amount,
        provider,
        bankCode: bankCodeUsed,
        phoneNumber: recipientPhoneUsed,
        accountName,
        reference: withdrawalRef,
        walletWithdrawalId: withdrawalRef,
        transferCode: transferCode || null,
        status: transferStatus === 'SUCCESS' ? 'completed' : 'processing',
        paymentMethod: `MoMo (${provider})`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: nowIso,
      });
    });

    // ── FIX 5: Notifications ──────────────────────────────────────────────────
    await notifyUser(
      actorEmail,
      `Your withdrawal of GHS ${amount.toFixed(2)} to ${provider} (${recipientPhoneUsed}) is being processed. You'll be notified once it's complete. Reference: ${withdrawalRef}`,
      'Withdrawal Processing',
      { screen: 'withdrawal-history', reference: withdrawalRef }
    );

    if (isEmailConfigured()) {
      sendPaymentReceiptEmail(
        actorEmail,
        userData.displayName || actorEmail,
        'Withdrawal Submitted — ConnectHub',
        `<p>Dear ${userData.displayName || actorEmail},</p>
         <p>Your withdrawal is being processed <b>instantly</b> via Paystack.</p>
         <table style="width:100%;border-collapse:collapse;">
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Amount</b></td><td style="padding:8px;border:1px solid #e2e8f0;">GHS ${amount.toFixed(2)}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Network</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${provider}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>MoMo Number</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${recipientPhoneUsed}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Account Name</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${accountName}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Reference</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${withdrawalRef}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Status</b></td><td style="padding:8px;border:1px solid #e2e8f0;">Processing — Instant transfer</td></tr>
         </table>
         <p>You will receive another notification once the money lands in your MoMo wallet.</p>
         <p>Thank you for using ConnectHub!</p>`
      ).catch((err) => logger.warn({ err, actorEmail }, 'WITHDRAWAL_EMAIL_FAILED'));
    }

    logger.info({ actorEmail, amount, provider, transferCode, withdrawalRef, bankCodeUsed, recipientPhoneUsed }, 'INSTANT_WITHDRAWAL_INITIATED');

    return sendSuccess(res, req, {
      message: 'Withdrawal initiated. Funds are being sent instantly to your MoMo.',
      data: {
        reference: withdrawalRef,
        withdrawalId: withdrawalRef,
        transferCode: transferCode || null,
        amount,
        provider,
        phoneNumber: recipientPhoneUsed,
        status: 'processing',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_WITHDRAWAL_ERROR');
    if (error?.statusCode && error?.errorCode) {
      return sendError(res, req, error.statusCode, error.errorCode, error.message || 'Withdrawal failed');
    }
    return sendError(res, req, 500, 'server_error', 'An unexpected error occurred. Please try again.');
  }
});

app.post('/admin/withdrawals/:id/complete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const withdrawalId = String(req.params.id || '').trim();
    const adminActor = String(req.user?.email || ADMIN_EMAIL).trim().toLowerCase();
    if (!withdrawalId) {
      return sendError(res, req, 400, 'missing_withdrawal_id', 'Withdrawal id is required');
    }

    const withdrawalRef = adminDb.collection('withdrawals').doc(withdrawalId);
    let withdrawalData = null;
    const fail = (statusCode, code, message) => {
      const err = new Error(message);
      err.statusCode = statusCode;
      err.errorCode = code;
      throw err;
    };

    await adminDb.runTransaction(async (tx) => {
      const withdrawalSnap = await tx.get(withdrawalRef);
      if (!withdrawalSnap.exists) {
        fail(404, 'withdrawal_not_found', 'Withdrawal request not found');
      }

      withdrawalData = withdrawalSnap.data() || {};
      if (withdrawalData.status !== 'pending_admin_approval') {
        fail(409, 'withdrawal_not_pending', 'Withdrawal is already processed');
      }

      tx.set(withdrawalRef, {
        status: 'completed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: adminActor,
        notes: String(req.body?.notes || '').trim() || null,
      }, { merge: true });
    });

    const txSnap = await adminDb.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(5).get();
    await Promise.all(txSnap.docs.map((docSnap) => docSnap.ref.set({ status: 'completed', updatedAt: new Date().toISOString() }, { merge: true })));

    await adminDb.collection('notifications').add({
      userId: withdrawalData.email,
      title: 'Withdrawal Paid',
      body: `GHS ${Number(withdrawalData.amount || 0).toFixed(2)} has been sent to your ${withdrawalData.provider} account ${withdrawalData.phoneNumber}. Please check your MoMo balance.`,
      type: 'withdrawal_completed',
      withdrawalId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userDoc = await adminDb.collection('users').doc(String(withdrawalData.email || '').trim().toLowerCase()).get();
    if (userDoc.exists && userDoc.data()?.pushToken) {
      await sendPushNotification(
        userDoc.data().pushToken,
        'Withdrawal Paid',
        `GHS ${Number(withdrawalData.amount || 0).toFixed(2)} sent to your ${withdrawalData.provider} account ${withdrawalData.phoneNumber}.`
      );
    }

    await logAdminAction(adminActor, 'withdrawal_paid', {
      withdrawalId,
      targetEmail: String(withdrawalData.email || '').trim().toLowerCase(),
      amount: Number(withdrawalData.amount || 0),
      ip: req.ip,
    });

    return sendSuccess(res, req, { message: 'Withdrawal marked as paid' });
  } catch (error) {
    if (error?.statusCode && error?.errorCode) {
      return sendError(res, req, error.statusCode, error.errorCode, error.message || 'Withdrawal completion failed');
    }
    logger.error({ err: error }, 'ADMIN_WITHDRAWAL_COMPLETE_ERROR');
    return sendError(res, req, 500, 'withdrawal_complete_failed', 'Could not mark withdrawal as paid');
  }
});

app.post('/admin/withdrawals/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const withdrawalId = String(req.params.id || '').trim();
    const adminActor = String(req.user?.email || ADMIN_EMAIL).trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!withdrawalId) {
      return sendError(res, req, 400, 'missing_withdrawal_id', 'Withdrawal id is required');
    }

    if (!reason) {
      return sendError(res, req, 400, 'missing_rejection_reason', 'Rejection reason is required');
    }

    const withdrawalRef = adminDb.collection('withdrawals').doc(withdrawalId);
    let userEmail = '';
    let amount = 0;

    const fail = (statusCode, code, message) => {
      const err = new Error(message);
      err.statusCode = statusCode;
      err.errorCode = code;
      throw err;
    };

    await adminDb.runTransaction(async (tx) => {
      const withdrawalSnap = await tx.get(withdrawalRef);
      if (!withdrawalSnap.exists) {
        fail(404, 'withdrawal_not_found', 'Withdrawal request not found');
      }

      const withdrawalData = withdrawalSnap.data() || {};
      if (withdrawalData.status !== 'pending_admin_approval') {
        fail(409, 'withdrawal_not_pending', 'Withdrawal is already processed');
      }

      userEmail = String(withdrawalData.email || '').trim().toLowerCase();
      amount = parseMoney(withdrawalData.amount || 0);
      if (!userEmail || amount <= 0) {
        fail(400, 'invalid_withdrawal_payload', 'Withdrawal payload is invalid');
      }

      const userRef = adminDb.collection('users').doc(userEmail);
      tx.set(userRef, {
        walletBalance: admin.firestore.FieldValue.increment(amount),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      tx.set(withdrawalRef, {
        status: 'rejected',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: adminActor,
        notes: reason,
      }, { merge: true });
    });

    const txSnap = await adminDb.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(5).get();
    await Promise.all(txSnap.docs.map((docSnap) => docSnap.ref.set({ status: 'failed', updatedAt: new Date().toISOString() }, { merge: true })));

    await adminDb.collection('notifications').add({
      userId: userEmail,
      title: 'Withdrawal Rejected',
      body: `Your withdrawal of GHS ${amount.toFixed(2)} was rejected. Reason: ${reason || 'Rejected by admin'}. Your balance has been restored.`,
      type: 'withdrawal_rejected',
      withdrawalId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userDoc = await adminDb.collection('users').doc(userEmail).get();
    if (userDoc.exists && userDoc.data()?.pushToken) {
      await sendPushNotification(
        userDoc.data().pushToken,
        'Withdrawal Rejected',
        `Your GHS ${amount.toFixed(2)} has been returned to your wallet.`
      );
    }

    await logAdminAction(adminActor, 'withdrawal_rejected', {
      withdrawalId,
      targetEmail: userEmail,
      amount,
      reason,
      ip: req.ip,
    });

    return sendSuccess(res, req, { message: 'Withdrawal rejected and balance restored' });
  } catch (error) {
    if (error?.statusCode && error?.errorCode) {
      return sendError(res, req, error.statusCode, error.errorCode, error.message || 'Withdrawal rejection failed');
    }
    logger.error({ err: error }, 'ADMIN_WITHDRAWAL_REJECT_ERROR');
    return sendError(res, req, 500, 'withdrawal_reject_failed', 'Could not reject withdrawal');
  }
});

const WITHDRAWAL_SLA_HOURS = Number(process.env.WITHDRAWAL_SLA_HOURS || 24);
const CRON_SECRET = String(process.env.CRON_SECRET || '');
const WITHDRAWAL_AUTO_RETRY_LIMIT = Number(process.env.WITHDRAWAL_AUTO_RETRY_LIMIT || 3);
const WITHDRAWAL_AUTO_RETRY_COOLDOWN_MINUTES = Number(process.env.WITHDRAWAL_AUTO_RETRY_COOLDOWN_MINUTES || 15);

/**
 * POST /admin/withdrawals/auto-refund-overdue
 * Called by a cron job (Render cron or external scheduler).
 * Finds all withdrawals in `pending_admin_approval` older than WITHDRAWAL_SLA_HOURS
 * and atomically refunds each one — no admin action needed.
 * Secured by either CRON_SECRET header (for scheduler) or authenticated admin access.
 */
app.post('/admin/withdrawals/auto-refund-overdue', async (req, res) => {
  try {
    const providedSecret = String(req.headers['x-cron-secret'] || '').trim();

    // Allow trusted cron caller with secret header, or regular admin auth from dashboard.
    if (CRON_SECRET && providedSecret === CRON_SECRET) {
      req.user = {
        uid: 'cron-auto-refund',
        email: 'cron@local',
        admin: true,
        role: 'admin',
      };
      req.userEmail = 'cron@local';
    } else {
      const authHeader = String(req.headers.authorization || '');
      if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
      }

      const token = authHeader.slice('Bearer '.length).trim();
      if (!token || token.length < 10) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token format');
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(token, true);
      } catch (authError) {
        if (authError?.code === 'auth/id-token-revoked') {
          return sendError(res, req, 401, 'token_revoked', 'Session expired. Please log in again.');
        }
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token');
      }

      const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Authenticated account is missing an email');
      }

      const hasAdminClaim = decodedToken.admin === true || decodedToken.role === 'admin';
      if (!hasAdminClaim && !isAdminEmail(normalizedEmail)) {
        return sendError(res, req, 403, 'admin_access_required', 'Admin access required');
      }

      req.user = decodedToken;
      req.userEmail = normalizedEmail;
    }

    const nowMs = Date.now();
    const cutoffMs = nowMs - WITHDRAWAL_SLA_HOURS * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const snap = await adminDb
      .collection('withdrawals')
      .where('status', '==', 'pending_admin_approval')
      .orderBy('requestedAt', 'asc')
      .limit(50)
      .get();

    const overdue = snap.docs.filter((docSnap) => {
      const d = docSnap.data() || {};
      const requestedMs = toMillis(d.requestedAt);
      return requestedMs > 0 && requestedMs < cutoffMs;
    });

    if (!overdue.length) {
      return sendSuccess(res, req, { message: 'No overdue withdrawals found', refunded: 0 });
    }

    const results = [];
    for (const docSnap of overdue) {
      const withdrawalId = docSnap.id;
      const wd = docSnap.data() || {};
      const userEmail = String(wd.email || '').trim().toLowerCase();
      const amount = parseMoney(wd.amount || 0);
      if (!userEmail || amount <= 0) {
        results.push({ withdrawalId, skipped: true, reason: 'missing_email_or_amount' });
        continue;
      }

      try {
        const withdrawalRef = adminDb.collection('withdrawals').doc(withdrawalId);
        await adminDb.runTransaction(async (tx) => {
          const fresh = await tx.get(withdrawalRef);
          const freshData = fresh.data() || {};
          if (String(freshData.status || '') !== 'pending_admin_approval') {
            throw Object.assign(new Error('already_processed'), { skip: true });
          }
          const userRef = adminDb.collection('users').doc(userEmail);
          tx.set(userRef, {
            walletBalance: admin.firestore.FieldValue.increment(amount),
            updatedAt: new Date().toISOString(),
          }, { merge: true });
          tx.set(withdrawalRef, {
            status: 'rejected',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: 'system_auto_refund',
            notes: `Auto-refunded: exceeded ${WITHDRAWAL_SLA_HOURS}h SLA window (cutoff ${cutoffIso})`,
          }, { merge: true });
        });

        const txSnap = await adminDb.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(5).get();
        await Promise.all(txSnap.docs.map((d) => d.ref.set({ status: 'failed', updatedAt: new Date().toISOString() }, { merge: true })));

        await notifyUser(
          userEmail,
          `Your withdrawal of GHS ${amount.toFixed(2)} exceeded our processing window and was automatically refunded to your wallet.`,
          'Withdrawal Auto-Refunded',
          { screen: 'wallet' }
        );

        if (isEmailConfigured()) {
          const userDoc = await adminDb.collection('users').doc(userEmail).get();
          const displayName = userDoc.exists ? (userDoc.data()?.displayName || userEmail) : userEmail;
          await sendPaymentReceiptEmail(
            userEmail,
            displayName,
            'Withdrawal Auto-Refunded - ConnectHub',
            `<p>Hi ${displayName},</p>
             <p>Your withdrawal request exceeded our processing SLA of ${WITHDRAWAL_SLA_HOURS} hours and was automatically refunded.</p>
             <table style="width:100%;border-collapse:collapse;">
               <tr><td style="padding:8px;"><b>Amount</b></td><td>GHS ${amount.toFixed(2)}</td></tr>
               <tr><td style="padding:8px;"><b>Network</b></td><td>${String(wd.provider || '')}</td></tr>
               <tr><td style="padding:8px;"><b>Reference</b></td><td>${String(wd.reference || withdrawalId)}</td></tr>
               <tr><td style="padding:8px;"><b>Refunded at</b></td><td>${new Date().toISOString()}</td></tr>
             </table>
             <p>Please submit a new withdrawal request.</p>`
          ).catch((err) => logger.warn({ err, userEmail }, 'AUTO_REFUND_EMAIL_FAILED'));
        }

        await logAdminAction(req.userEmail || 'system_auto_refund', 'withdrawal_auto_refunded', {
          withdrawalId,
          targetEmail: userEmail,
          amount,
          slaHours: WITHDRAWAL_SLA_HOURS,
        });

        results.push({ withdrawalId, refunded: true, userEmail, amount });
      } catch (itemErr) {
        if (itemErr?.skip) {
          results.push({ withdrawalId, skipped: true, reason: 'already_processed' });
        } else {
          logger.error({ err: itemErr, withdrawalId }, 'AUTO_REFUND_ITEM_ERROR');
          results.push({ withdrawalId, error: itemErr?.message || 'unknown_error' });
        }
      }
    }

    const refundedCount = results.filter((r) => r.refunded).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const errorCount = results.filter((r) => r.error).length;
    logger.info({ refundedCount, skippedCount, errorCount, cutoffIso }, 'AUTO_REFUND_COMPLETE');
    return sendSuccess(res, req, { message: 'Auto-refund complete', refunded: refundedCount, skipped: skippedCount, errors: errorCount, results });
  } catch (error) {
    logger.error({ err: error }, 'AUTO_REFUND_OVERDUE_ERROR');
    return sendError(res, req, 500, 'auto_refund_failed', 'Auto-refund process failed');
  }
});

// ── FIX 6: Admin Withdrawal Dashboard endpoints ───────────────────────────────

app.get('/admin/withdrawals/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const snap = await adminDb.collection('wallet_withdrawals')
      .orderBy('requestedAt', 'desc')
      .limit(200)
      .get();

    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const nowMs = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    let paidToday = 0; let paidWeek = 0; let paidMonth = 0;

    rows.forEach((row) => {
      const ts = toMillis(row.requestedAt || row.requestedAtIso);
      const amt = parseMoney(row.amount);
      const status = String(row.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        if (ts >= todayStart.getTime()) paidToday += amt;
        if (ts >= weekStart.getTime()) paidWeek += amt;
        if (ts >= monthStart.getTime()) paidMonth += amt;
      }
    });

    return sendSuccess(res, req, {
      withdrawals: rows,
      stats: {
        paidToday: parseMoney(paidToday),
        paidWeek: parseMoney(paidWeek),
        paidMonth: parseMoney(paidMonth),
        totalCount: rows.length,
        failedCount: rows.filter((r) => String(r.status || '').toUpperCase() === 'FAILED').length,
        pendingCount: rows.filter((r) => ['PENDING', 'PROCESSING'].includes(String(r.status || '').toUpperCase())).length,
        completedCount: rows.filter((r) => String(r.status || '').toUpperCase() === 'COMPLETED').length,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_WITHDRAWAL_STATS_ERROR');
    return sendError(res, req, 500, 'stats_failed', 'Could not load withdrawal stats');
  }
});

app.get('/admin/auth/signup-errors', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
    const snap = await adminDb.collection(SIGNUP_ERROR_LOG_COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return sendSuccess(res, req, { logs: rows, count: rows.length });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_SIGNUP_ERROR_LOGS_FETCH_ERROR');
    return sendError(res, req, 500, 'signup_logs_failed', 'Could not load signup error logs');
  }
});

app.post('/admin/withdrawals/:id/retry', requireAuth, requireAdmin, async (req, res) => {
  try {
    const withdrawalId = String(req.params.id || '').trim();
    const adminActor = String(req.user?.email || ADMIN_EMAIL).trim().toLowerCase();
    const paystackSecret = getPaystackSecret();

    if (!withdrawalId) return sendError(res, req, 400, 'missing_id', 'Withdrawal id required');
    if (!paystackSecret) return sendError(res, req, 500, 'payment_configuration_missing', 'Payment service not configured');

    const withdrawalRef = adminDb.collection('wallet_withdrawals').doc(withdrawalId);
    const snap = await withdrawalRef.get();
    if (!snap.exists) return sendError(res, req, 404, 'not_found', 'Withdrawal not found');

    const wd = snap.data() || {};
    const { retryRef, transferCode: newTransferCode } = await retryWalletWithdrawalInstant({
      withdrawalRef,
      withdrawalId,
      wd,
      paystackSecret,
      actorEmail: adminActor,
      retryMode: 'manual',
    });

    await logAdminAction(adminActor, 'withdrawal_retry', {
      withdrawalId,
      retryRef,
      targetEmail: wd.userEmail,
      amount: parseMoney(wd.amount),
    });

    return sendSuccess(res, req, { message: 'Retry initiated', transferCode: newTransferCode, reference: retryRef });
  } catch (error) {
    if (error?.statusCode && error?.errorCode) {
      return sendError(res, req, error.statusCode, error.errorCode, error.message || 'Could not retry withdrawal');
    }
    logger.error({ err: error }, 'ADMIN_WITHDRAWAL_RETRY_ERROR');
    return sendError(res, req, 500, 'retry_failed', 'Could not retry withdrawal');
  }
});

app.post('/admin/withdrawals/auto-retry-queued', async (req, res) => {
  try {
    const providedSecret = String(req.headers['x-cron-secret'] || '').trim();

    if (CRON_SECRET && providedSecret === CRON_SECRET) {
      req.user = {
        uid: 'cron-auto-retry-withdrawals',
        email: 'cron@local',
        admin: true,
        role: 'admin',
      };
      req.userEmail = 'cron@local';
    } else {
      const authHeader = String(req.headers.authorization || '');
      if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
      }

      const token = authHeader.slice('Bearer '.length).trim();
      if (!token || token.length < 10) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token format');
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(token, true);
      } catch (authError) {
        if (authError?.code === 'auth/id-token-revoked') {
          return sendError(res, req, 401, 'token_revoked', 'Session expired. Please log in again.');
        }
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token');
      }

      const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Authenticated account is missing an email');
      }

      const hasAdminClaim = decodedToken.admin === true || decodedToken.role === 'admin';
      if (!hasAdminClaim && !isAdminEmail(normalizedEmail)) {
        return sendError(res, req, 403, 'admin_access_required', 'Admin access required');
      }

      req.user = decodedToken;
      req.userEmail = normalizedEmail;
    }

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Payment service not configured');
    }

    const actorEmail = String(req.userEmail || req.user?.email || 'cron@local').trim().toLowerCase();
    const nowMs = Date.now();
    const cooldownMs = WITHDRAWAL_AUTO_RETRY_COOLDOWN_MINUTES * 60 * 1000;
    const maxBatch = Math.max(1, Math.min(25, Number(req.body?.limit || 10)));

    const snap = await adminDb.collection('wallet_withdrawals')
      .where('status', 'in', ['PENDING', 'FAILED'])
      .limit(60)
      .get();

    const candidates = snap.docs
      .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {}, ref: docSnap.ref }))
      .filter((row) => {
        const d = row.data;
        if (!d.manualQueue) return false;
        if (d.refunded === true) return false;
        const autoRetryCount = Number(d.autoRetryCount || 0);
        if (autoRetryCount >= WITHDRAWAL_AUTO_RETRY_LIMIT) return false;
        const lastAutoRetryMs = toMillis(d.lastAutoRetriedAt);
        if (lastAutoRetryMs > 0 && nowMs - lastAutoRetryMs < cooldownMs) return false;
        return true;
      })
      .sort((a, b) => toMillis(a.data.requestedAt || a.data.requestedAtIso) - toMillis(b.data.requestedAt || b.data.requestedAtIso))
      .slice(0, maxBatch);

    const results = [];
    for (const item of candidates) {
      try {
        const retryResult = await retryWalletWithdrawalInstant({
          withdrawalRef: item.ref,
          withdrawalId: item.id,
          wd: item.data,
          paystackSecret,
          actorEmail,
          retryMode: 'auto',
        });

        results.push({
          withdrawalId: item.id,
          ok: true,
          reference: retryResult.retryRef,
          transferCode: retryResult.transferCode,
        });
      } catch (itemError) {
        const nowIso = new Date().toISOString();
        await item.ref.set({
          lastAutoRetriedAt: nowIso,
          lastAutoRetryError: itemError?.message || 'unknown_error',
          updatedAt: nowIso,
        }, { merge: true });

        results.push({
          withdrawalId: item.id,
          ok: false,
          errorCode: itemError?.errorCode || 'retry_failed',
          error: itemError?.message || 'Could not retry withdrawal',
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const failedCount = results.length - successCount;
    logger.info({
      actorEmail,
      candidateCount: candidates.length,
      successCount,
      failedCount,
      maxBatch,
      retryLimit: WITHDRAWAL_AUTO_RETRY_LIMIT,
      cooldownMinutes: WITHDRAWAL_AUTO_RETRY_COOLDOWN_MINUTES,
    }, 'AUTO_RETRY_QUEUED_WITHDRAWALS_COMPLETE');

    return sendSuccess(res, req, {
      message: 'Auto-retry run complete',
      attempted: results.length,
      successCount,
      failedCount,
      results,
    });
  } catch (error) {
    logger.error({ err: error }, 'AUTO_RETRY_QUEUED_WITHDRAWALS_ERROR');
    return sendError(res, req, 500, 'auto_retry_failed', 'Could not auto-retry queued withdrawals');
  }
});

app.post('/admin/withdrawals/:id/mark-manual-paid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const withdrawalId = String(req.params.id || '').trim();
    const adminActor = String(req.user?.email || ADMIN_EMAIL).trim().toLowerCase();
    const notes = String(req.body?.notes || '').trim();

    if (!withdrawalId) return sendError(res, req, 400, 'missing_id', 'Withdrawal id required');

    const withdrawalRef = adminDb.collection('wallet_withdrawals').doc(withdrawalId);
    const snap = await withdrawalRef.get();
    if (!snap.exists) return sendError(res, req, 404, 'not_found', 'Withdrawal not found');

    const wd = snap.data() || {};
    const nowIso = new Date().toISOString();

    await withdrawalRef.set({
      status: 'COMPLETED',
      completedAt: nowIso,
      manuallyMarkedBy: adminActor,
      manuallyMarkedAt: nowIso,
      notes: notes || 'Manually marked as paid by admin',
      updatedAt: nowIso,
    }, { merge: true });

    const txSnap = await adminDb.collection('transactions')
      .where('transactionId', '==', String(wd.reference || withdrawalId))
      .limit(5)
      .get();
    await Promise.all(txSnap.docs.map((d) => d.ref.set({ status: 'completed', updatedAt: nowIso }, { merge: true })));

    const userEmail = String(wd.userEmail || '').toLowerCase();
    await notifyUser(
      userEmail,
      `GHS ${Number(wd.amount || 0).toFixed(2)} has been sent to your ${wd.provider} account ${wd.phoneNumber}. Reference: ${wd.reference || withdrawalId}.`,
      'Withdrawal Paid',
      { screen: 'withdrawal-history' }
    );

    if (isEmailConfigured()) {
      const userDoc = await adminDb.collection('users').doc(userEmail).get();
      const displayName = userDoc.exists ? (userDoc.data()?.displayName || userEmail) : userEmail;
      sendPaymentReceiptEmail(
        userEmail,
        displayName,
        'Withdrawal Completed — ConnectHub',
        `<p>Dear ${displayName},</p>
         <p>Your withdrawal has been manually processed.</p>
         <table style="width:100%;border-collapse:collapse;">
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Amount</b></td><td style="padding:8px;border:1px solid #e2e8f0;">GHS ${Number(wd.amount || 0).toFixed(2)}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Network</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${wd.provider || ''}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>MoMo Number</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${wd.phoneNumber || ''}</td></tr>
           <tr><td style="padding:8px;border:1px solid #e2e8f0;"><b>Reference</b></td><td style="padding:8px;border:1px solid #e2e8f0;">${wd.reference || withdrawalId}</td></tr>
         </table>
         <p>Thank you for using ConnectHub!</p>`
      ).catch((err) => logger.warn({ err }, 'MANUAL_PAID_EMAIL_FAILED'));
    }

    await logAdminAction(adminActor, 'withdrawal_manual_paid', {
      withdrawalId,
      targetEmail: wd.userEmail,
      amount: parseMoney(wd.amount),
      notes,
    });

    return sendSuccess(res, req, { message: 'Withdrawal marked as paid' });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_WITHDRAWAL_MANUAL_PAID_ERROR');
    return sendError(res, req, 500, 'mark_paid_failed', 'Could not mark withdrawal as paid');
  }
});

app.post('/admin/notify-withdrawal-paid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const amount = parseMoney(req.body?.amount || 0);
    const provider = String(req.body?.provider || '').trim();
    const phoneNumber = String(req.body?.phoneNumber || '').trim();

    if (!email || amount <= 0) {
      return sendError(res, req, 400, 'missing_fields', 'email and amount are required');
    }

    if (!isEmailConfigured()) {
      return sendSuccess(res, req, { message: 'Email not configured — skipped' });
    }

    const userDoc = await adminDb.collection('users').doc(email).get();
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const displayName = userData.displayName || email;
    const lastFour = phoneNumber ? phoneNumber.slice(-4) : '****';

    await sendPaymentReceiptEmail(
      email,
      displayName,
      '✅ ConnectHub Withdrawal Successful',
      `<p>Dear ${displayName},</p>
       <p>Great news! Your withdrawal has been processed successfully.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;">
         <tr style="background:#f0fdf4;"><td style="padding:10px;"><b>Amount Sent</b></td>
           <td style="padding:10px;color:#16a34a;font-weight:bold;">GHS ${amount.toFixed(2)}</td></tr>
         <tr><td style="padding:10px;"><b>Network</b></td><td style="padding:10px;">${provider}</td></tr>
         <tr style="background:#f0fdf4;"><td style="padding:10px;"><b>MoMo Number</b></td>
           <td style="padding:10px;">****${lastFour}</td></tr>
         <tr><td style="padding:10px;"><b>Status</b></td><td style="padding:10px;color:#16a34a;">✅ Completed</td></tr>
       </table>
       <p>The money should appear in your MoMo wallet within a few minutes. If you do not receive it within 1 hour, please contact our support team.</p>
       <p>Thank you for using ConnectHub!</p>`
    );

    await logAdminAction(req.userEmail || req.user?.email || ADMIN_EMAIL, 'withdrawal_paid_notification_sent', {
      targetEmail: email,
      amount,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return sendSuccess(res, req, { message: 'Withdrawal paid email sent' });
  } catch (error) {
    logger.error({ err: error }, 'NOTIFY_WITHDRAWAL_PAID_ERROR');
    return sendError(res, req, 500, 'notify_failed', 'Could not send withdrawal paid notification email');
  }
});

app.post('/admin/notify-withdrawal-rejected', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const amount = parseMoney(req.body?.amount || 0);
    const provider = String(req.body?.provider || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!email || amount <= 0) {
      return sendError(res, req, 400, 'missing_fields', 'email and amount are required');
    }

    if (!isEmailConfigured()) {
      return sendSuccess(res, req, { message: 'Email not configured — skipped' });
    }

    const userDoc = await adminDb.collection('users').doc(email).get();
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const displayName = userData.displayName || email;

    await sendPaymentReceiptEmail(
      email,
      displayName,
      '❌ ConnectHub Withdrawal Not Processed',
      `<p>Dear ${displayName},</p>
       <p>Unfortunately your withdrawal request could not be processed at this time.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;">
         <tr><td style="padding:10px;"><b>Amount</b></td><td style="padding:10px;">GHS ${amount.toFixed(2)}</td></tr>
         <tr><td style="padding:10px;"><b>Network</b></td><td style="padding:10px;">${provider}</td></tr>
         <tr><td style="padding:10px;"><b>Reason</b></td>
           <td style="padding:10px;color:#dc2626;">${reason || 'Processing issue'}</td></tr>
         <tr><td style="padding:10px;"><b>Wallet Balance</b></td>
           <td style="padding:10px;color:#16a34a;">✅ Restored</td></tr>
       </table>
       <p>You can try withdrawing again or contact our support team if you need help.</p>
       <p>Thank you for using ConnectHub!</p>`
    );

    await logAdminAction(req.userEmail || req.user?.email || ADMIN_EMAIL, 'withdrawal_rejected_notification_sent', {
      targetEmail: email,
      amount,
      reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return sendSuccess(res, req, { message: 'Withdrawal rejected email sent' });
  } catch (error) {
    logger.error({ err: error }, 'NOTIFY_WITHDRAWAL_REJECTED_ERROR');
    return sendError(res, req, 500, 'notify_failed', 'Could not send withdrawal rejected notification email');
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

app.post('/subscription/client-event', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const eventName = String(req.body?.event || '').trim().toLowerCase();
    const plan = normalizePlan(req.body?.plan || 'free');
    const platform = String(req.body?.platform || '').trim().toLowerCase();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const message = String(req.body?.message || '').trim().slice(0, 500);
    const reference = String(req.body?.reference || '').trim().slice(0, 120);
    const sessionType = String(req.body?.sessionType || '').trim().toLowerCase();

    if (!actorEmail) {
      return sendError(res, req, 401, 'invalid_auth_token', 'Could not determine authenticated user');
    }

    if (!eventName) {
      return sendError(res, req, 400, 'missing_event', 'event is required');
    }

    const nowIso = new Date().toISOString();
    await adminDb.collection('subscription_client_events').add({
      email: actorEmail,
      event: eventName,
      plan,
      platform,
      status,
      message,
      reference: reference || null,
      sessionType: sessionType || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
      ip: req.ip || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    });

    logger.info({ actorEmail, eventName, plan, platform, status }, 'SUBSCRIPTION_CLIENT_EVENT_RECORDED');
    return sendSuccess(res, req, { message: 'Subscription client event recorded' });
  } catch (error) {
    logger.error({ err: error }, 'SUBSCRIPTION_CLIENT_EVENT_ERROR');
    return sendError(res, req, 500, 'subscription_client_event_failed', 'Could not record subscription client event');
  }
});

async function pollPaystackTransferStatus(transferCode, paystackSecret) {
  try {
    const response = await fetch(`https://api.paystack.co/transfer/${transferCode}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const data = await response.json();
    if (response.ok && data?.status) {
      return { ok: true, data: data.data || data };
    }
    return { ok: false, data };
  } catch (error) {
    logger.warn({ message: error?.message, transferCode }, 'POLL_PAYSTACK_TRANSFER_ERROR');
    return { ok: false, error };
  }
}

async function processCompletedTransferFromPolling(transferCode, paystackStatus, paystackData) {
  try {
    let withdrawalDocRef = adminDb.collection('wallet_withdrawals').doc(transferCode);
    let withdrawalSnap = await withdrawalDocRef.get();

    if (!withdrawalSnap.exists) {
      const byTransferCode = await adminDb.collection('wallet_withdrawals')
        .where('transferCode', '==', transferCode)
        .limit(1)
        .get();
      if (!byTransferCode.empty) {
        withdrawalDocRef = byTransferCode.docs[0].ref;
        withdrawalSnap = byTransferCode.docs[0];
      }
    }

    if (!withdrawalSnap.exists) {
      const byRef = await adminDb.collection('withdrawals').where('reference', '==', transferCode).limit(1).get();
      if (!byRef.empty) {
        withdrawalDocRef = byRef.docs[0].ref;
        withdrawalSnap = byRef.docs[0];
      }
    }

    if (!withdrawalSnap.exists) return null;

    const withdrawalData = withdrawalSnap.data() || {};
    const currentStatus = String(withdrawalData.status || '').toUpperCase();
    const isSuccess = paystackStatus === 'success';
    const newStatus = isSuccess ? 'COMPLETED' : 'FAILED';
    const nowIso = new Date().toISOString();
    const userEmail = String(withdrawalData.userEmail || withdrawalData.email || '').trim().toLowerCase();
    const amount = parseMoney(withdrawalData.amount);

    if (currentStatus === newStatus) {
      return { alreadyCompleted: true, withdrawalId: withdrawalSnap.id };
    }

    await withdrawalDocRef.set({
      status: newStatus,
      updatedAt: nowIso,
      completedAt: isSuccess ? nowIso : null,
      failedAt: isSuccess ? null : nowIso,
      failureReason: isSuccess ? null : (paystackStatus || 'transfer_failed'),
      transferStatusEvent: `transfer.${paystackStatus}`,
      transferStatusMessage: paystackStatus,
      pollDetectedAt: nowIso,
    }, { merge: true });

    const txById = await adminDb.collection('transactions').where('transactionId', '==', String(withdrawalData.reference || transferCode)).limit(5).get();
    const txByRef = await adminDb.collection('transactions').where('reference', '==', String(withdrawalData.reference || transferCode)).limit(5).get();
    const txByWid = await adminDb.collection('transactions').where('walletWithdrawalId', '==', String(withdrawalSnap.id || transferCode)).limit(5).get();
    const txMap = new Map();
    [...txById.docs, ...txByRef.docs, ...txByWid.docs].forEach((d) => txMap.set(d.ref.path, d));
    await Promise.all(Array.from(txMap.values()).map((d) => d.ref.set({
      status: isSuccess ? 'completed' : 'failed',
      updatedAt: nowIso,
    }, { merge: true })));

    if (isSuccess) {
      await notifyUser(
        userEmail,
        `GHS ${amount.toFixed(2)} has been sent to your MoMo account ${withdrawalData.phoneNumber || ''}. Reference: ${withdrawalData.reference || transferCode}.`,
        'Withdrawal Completed ✅',
        { screen: 'withdrawal-history' }
      );
      if (isEmailConfigured() && userEmail) {
        const userDoc = await adminDb.collection('users').doc(userEmail).get();
        const displayName = userDoc.exists ? (userDoc.data()?.displayName || userEmail) : userEmail;
        sendPaymentReceiptEmail(
          userEmail, displayName, 'Withdrawal Successful — ConnectHub',
          `<p>Dear ${displayName},</p><p><b>GHS ${amount.toFixed(2)}</b> has been sent to your ${withdrawalData.provider || 'MoMo'} account <b>${withdrawalData.phoneNumber || ''}</b>.</p><p><b>Reference:</b> ${withdrawalData.reference || transferCode}</p>`
        ).catch((err) => logger.warn({ err }, 'WITHDRAWAL_SUCCESS_EMAIL_FAILED'));
      }
    }

    return { processed: true, withdrawalId: withdrawalSnap.id, newStatus, userEmail, amount };
  } catch (error) {
    logger.error({ message: error?.message, transferCode }, 'PROCESS_COMPLETED_TRANSFER_ERROR');
    return null;
  }
}

async function handlePaystackWebhook(req, res) {
  try {
    const paystackSecret = process.env.PAYSTACK_WEBHOOK_SECRET || getPaystackSecret();
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
      return sendError(res, req, 400, 'invalid_paystack_signature', 'Invalid signature');
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
      } else if (metadata?.type === 'wallet_topup' || isWalletTopupReference(event?.data?.reference)) {
        const ownerEmail = String(
          metadata?.ownerEmail
            || metadata?.userEmail
            || event?.data?.customer?.email
            || ''
        ).trim().toLowerCase();

        const topupResult = await applyWalletTopupCredit({
          reference: event?.data?.reference,
          ownerEmail,
          amountPesewas: Number(event?.data?.amount || 0),
          gatewayResponse: event?.data?.gateway_response || null,
          paymentChannel: event?.data?.channel || null,
          source: 'paystack_webhook',
          allowLegacyMatch: true,
        });

        if (!topupResult.ok) {
          logger.warn({ topupResult, ref: event?.data?.reference || null }, 'WEBHOOK_WALLET_TOPUP_SKIPPED');
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
      const reference = String(event?.data?.reference || event?.data?.transfer_code || '').trim();
      if (reference) {
        // Primary: wallet_withdrawals (new instant-transfer records)
        let withdrawalDocRef = adminDb.collection('wallet_withdrawals').doc(reference);
        let withdrawalSnap = await withdrawalDocRef.get();

        if (!withdrawalSnap.exists) {
          const byTransferCode = await adminDb.collection('wallet_withdrawals')
            .where('transferCode', '==', reference)
            .limit(1)
            .get();
          if (!byTransferCode.empty) {
            withdrawalDocRef = byTransferCode.docs[0].ref;
            withdrawalSnap = byTransferCode.docs[0];
          }
        }

        // Legacy fallback: old withdrawals collection
        if (!withdrawalSnap.exists) {
          const byRef = await adminDb.collection('withdrawals').where('reference', '==', reference).limit(1).get();
          if (!byRef.empty) {
            withdrawalDocRef = byRef.docs[0].ref;
            withdrawalSnap = byRef.docs[0];
          }
        }

        if (withdrawalSnap.exists) {
          const withdrawalData = withdrawalSnap.data() || {};
          const isSuccess = event?.event === 'transfer.success';
          const newStatus = isSuccess ? 'COMPLETED' : 'FAILED';
          const nowIso = new Date().toISOString();
          const userEmail = String(withdrawalData.userEmail || withdrawalData.email || '').trim().toLowerCase();
          const amount = parseMoney(withdrawalData.amount);

          await withdrawalDocRef.set({
            status: newStatus,
            updatedAt: nowIso,
            completedAt: isSuccess ? nowIso : null,
            failedAt: isSuccess ? null : nowIso,
            failureReason: isSuccess ? null : (event?.data?.status || 'transfer_failed'),
            transferStatusEvent: event?.event,
            transferStatusMessage: event?.data?.status || null,
          }, { merge: true });

          const txById = await adminDb.collection('transactions').where('transactionId', '==', String(withdrawalData.reference || reference)).limit(5).get();
          const txByRef = await adminDb.collection('transactions').where('reference', '==', String(withdrawalData.reference || reference)).limit(5).get();
          const txByWid = await adminDb.collection('transactions').where('walletWithdrawalId', '==', String(withdrawalSnap.id || reference)).limit(5).get();
          const txMap = new Map();
          [...txById.docs, ...txByRef.docs, ...txByWid.docs].forEach((d) => txMap.set(d.ref.path, d));
          await Promise.all(Array.from(txMap.values()).map((d) => d.ref.set({
            status: isSuccess ? 'completed' : 'failed',
            updatedAt: nowIso,
          }, { merge: true })));

          if (isSuccess) {
            await notifyUser(
              userEmail,
              `GHS ${amount.toFixed(2)} has been sent to your MoMo account ${withdrawalData.phoneNumber || ''}. Reference: ${withdrawalData.reference || reference}.`,
              'Withdrawal Completed ✅',
              { screen: 'withdrawal-history' }
            );
            if (isEmailConfigured() && userEmail) {
              const userDoc = await adminDb.collection('users').doc(userEmail).get();
              const displayName = userDoc.exists ? (userDoc.data()?.displayName || userEmail) : userEmail;
              sendPaymentReceiptEmail(
                userEmail, displayName, 'Withdrawal Successful — ConnectHub',
                `<p>Dear ${displayName},</p><p><b>GHS ${amount.toFixed(2)}</b> has been sent to your ${withdrawalData.provider || 'MoMo'} account <b>${withdrawalData.phoneNumber || ''}</b>.</p><p><b>Reference:</b> ${withdrawalData.reference || reference}</p>`
              ).catch((err) => logger.warn({ err }, 'WITHDRAWAL_SUCCESS_EMAIL_FAILED'));
            }
          } else {
            // FIX 4: Auto-refund on failure
            const alreadyRefunded = withdrawalData.refunded === true;
            if (!alreadyRefunded && userEmail && amount > 0) {
              await adminDb.collection('users').doc(userEmail).set({
                walletBalance: admin.firestore.FieldValue.increment(amount),
                updatedAt: nowIso,
              }, { merge: true });
              await withdrawalDocRef.set({ refunded: true, refundedAt: nowIso }, { merge: true });
              await adminDb.collection('fraudAlerts').add({
                type: 'withdrawal_failed',
                email: userEmail,
                amount,
                reference: withdrawalData.reference || reference,
                failureReason: event?.data?.status || 'transfer_failed',
                resolved: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
            await notifyUser(
              userEmail,
              `Your withdrawal of GHS ${amount.toFixed(2)} failed. GHS ${amount.toFixed(2)} has been returned to your wallet. Please check your MoMo number and try again.`,
              'Withdrawal Failed ❌',
              { screen: 'withdrawal-history' }
            );
            if (isEmailConfigured() && userEmail) {
              const userDoc = await adminDb.collection('users').doc(userEmail).get();
              const displayName = userDoc.exists ? (userDoc.data()?.displayName || userEmail) : userEmail;
              sendPaymentReceiptEmail(
                userEmail, displayName, 'Withdrawal Failed — ConnectHub',
                `<p>Dear ${displayName},</p><p>Your withdrawal of <b>GHS ${amount.toFixed(2)}</b> failed. <b>GHS ${amount.toFixed(2)} has been returned to your wallet.</b></p><p>Please check your MoMo number and network, then try again.</p><p><b>Reference:</b> ${withdrawalData.reference || reference}</p>`
              ).catch((err) => logger.warn({ err }, 'WITHDRAWAL_FAILED_EMAIL_FAILED'));
            }
          }
        } else {
          logger.warn({ reference, event: event?.event }, 'TRANSFER_WEBHOOK_NO_MATCHING_WITHDRAWAL');
        }
      }
    }

    return sendSuccess(res, req, { received: true });
  } catch (error) {
    logger.error({ err: error }, 'WEBHOOK_ERROR');
    return sendError(res, req, 500, 'webhook_processing_failed', 'Webhook processing failed');
  }
}

app.post('/admin/withdrawals/poll-transfer-status', async (req, res) => {
  try {
    const providedSecret = String(req.headers['x-cron-secret'] || '').trim();

    if (CRON_SECRET && providedSecret === CRON_SECRET) {
      req.user = {
        uid: 'cron-poll-transfers',
        email: 'cron@local',
        admin: true,
        role: 'admin',
      };
      req.userEmail = 'cron@local';
    } else {
      const authHeader = String(req.headers.authorization || '');
      if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, req, 401, 'missing_bearer_token', 'Missing bearer token');
      }

      const token = authHeader.slice('Bearer '.length).trim();
      if (!token || token.length < 10) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token format');
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(token, true);
      } catch (authError) {
        if (authError?.code === 'auth/id-token-revoked') {
          return sendError(res, req, 401, 'token_revoked', 'Session expired. Please log in again.');
        }
        return sendError(res, req, 401, 'invalid_auth_token', 'Invalid auth token');
      }

      const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return sendError(res, req, 401, 'invalid_auth_token', 'Authenticated account is missing an email');
      }

      const hasAdminClaim = decodedToken.admin === true || decodedToken.role === 'admin';
      if (!hasAdminClaim && !isAdminEmail(normalizedEmail)) {
        return sendError(res, req, 403, 'admin_access_required', 'Admin access required');
      }

      req.user = decodedToken;
      req.userEmail = normalizedEmail;
    }

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Payment service not configured');
    }

    const maxBatch = Math.max(1, Math.min(25, Number(req.body?.limit || 15)));

    const snap = await adminDb.collection('wallet_withdrawals')
      .where('status', '==', 'PROCESSING')
      .limit(60)
      .get();

    const candidates = snap.docs
      .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {}, ref: docSnap.ref }))
      .filter((row) => {
        if (!row.data.transferCode) return false;
        if (row.data.refunded === true) return false;
        if (row.data.manualQueue === true) return false;
        return true;
      })
      .slice(0, maxBatch);

    const results = [];
    for (const item of candidates) {
      try {
        const pollResult = await pollPaystackTransferStatus(item.data.transferCode, paystackSecret);
        if (!pollResult.ok) {
          results.push({
            transferCode: item.data.transferCode,
            ok: false,
            reason: 'paystack_poll_failed',
          });
          continue;
        }

        const paystackStatus = String(pollResult.data?.status || '').toLowerCase();
        if (!['success', 'failed', 'pending', 'cancelled'].includes(paystackStatus)) {
          results.push({
            transferCode: item.data.transferCode,
            ok: false,
            reason: 'unknown_paystack_status',
            paystackStatus,
          });
          continue;
        }

        if (paystackStatus === 'pending') {
          results.push({
            transferCode: item.data.transferCode,
            ok: true,
            action: 'no_change',
            paystackStatus,
          });
          continue;
        }

        const processResult = await processCompletedTransferFromPolling(
          item.data.transferCode,
          paystackStatus,
          pollResult.data
        );

        if (processResult?.alreadyCompleted) {
          results.push({
            transferCode: item.data.transferCode,
            ok: true,
            action: 'already_completed',
            newStatus: item.data.status,
          });
        } else if (processResult?.processed) {
          results.push({
            transferCode: item.data.transferCode,
            ok: true,
            action: 'completed_from_polling',
            newStatus: processResult.newStatus,
            userEmail: processResult.userEmail,
            amount: processResult.amount,
          });
        } else {
          results.push({
            transferCode: item.data.transferCode,
            ok: false,
            reason: 'process_failed',
          });
        }
      } catch (itemError) {
        results.push({
          transferCode: item.data.transferCode,
          ok: false,
          reason: itemError?.message || 'unknown_error',
        });
      }
    }

    const completedCount = results.filter((r) => r.action === 'completed_from_polling').length;
    const alreadyCount = results.filter((r) => r.action === 'already_completed').length;
    const noChangeCount = results.filter((r) => r.action === 'no_change').length;
    const failedCount = results.filter((r) => !r.ok).length;
    logger.info({
      candidateCount: candidates.length,
      completedCount,
      alreadyCount,
      noChangeCount,
      failedCount,
      maxBatch,
    }, 'POLL_TRANSFER_STATUS_COMPLETE');

    return sendSuccess(res, req, {
      message: 'Transfer status polling complete',
      polled: results.length,
      completedFromPolling: completedCount,
      alreadyCompleted: alreadyCount,
      stillPending: noChangeCount,
      errors: failedCount,
      results,
    });
  } catch (error) {
    logger.error({ err: error }, 'POLL_TRANSFER_STATUS_ERROR');
    return sendError(res, req, 500, 'polling_failed', 'Could not poll transfer statuses');
  }
});

app.post('/paystack/webhook', handlePaystackWebhook);
app.post('/webhook', handlePaystackWebhook);

app.post('/api/jobs', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const payload = req.body || {};

    const category = String(payload.category || '').trim();
    const title = String(payload.title || '').trim();
    const description = String(payload.description || '').trim();
    const location = payload.location || {};
    const area = String(location.area || payload.area || '').trim();
    const fullAddress = String(location.fullAddress || payload.fullAddress || '').trim();
    const specialInstructions = String(location.specialInstructions || payload.specialInstructions || '').trim();
    const latitude = Number(location.latitude ?? location.coordinates?.latitude ?? payload.latitude);
    const longitude = Number(location.longitude ?? location.coordinates?.longitude ?? payload.longitude);
    const urgency = String(payload.urgency || 'normal').trim().toLowerCase() === 'urgent' ? 'urgent' : 'normal';
    const preferredDate = String(payload.preferredDate || '').trim();
    const budget = parseMoney(payload.budget || payload.price || 0);

    if (!category) return sendError(res, req, 400, 'invalid_category', 'Category is required');
    if (title.length < 5 || title.length > 80) return sendError(res, req, 400, 'invalid_title', 'Title must be between 5 and 80 characters');
    if (description.length < 20 || description.length > 500) return sendError(res, req, 400, 'invalid_description', 'Description must be between 20 and 500 characters');
    if (!Number.isFinite(budget) || budget < 10) return sendError(res, req, 400, 'invalid_budget', 'Budget must be at least GHS 10');
    if (!area) return sendError(res, req, 400, 'invalid_area', 'Area is required');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return sendError(res, req, 400, 'invalid_location_coords', 'Exact map coordinates are required');
    }
    if (specialInstructions.length > 200) return sendError(res, req, 400, 'invalid_special_instructions', 'Special instructions cannot exceed 200 characters');

    const preferredDateMs = preferredDate ? new Date(preferredDate).getTime() : Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (!Number.isFinite(preferredDateMs) || preferredDateMs < startOfToday.getTime()) {
      return sendError(res, req, 400, 'invalid_preferred_date', 'Preferred date must be today or later');
    }

    const createdAtIso = new Date().toISOString();
    const jobRef = adminDb.collection('requests').doc();
    const referenceNumber = `JOB-${Date.now().toString().slice(-8)}-${jobRef.id.slice(0, 4).toUpperCase()}`;
    const locationLabel = fullAddress ? `${area}, ${fullAddress}` : area;

    await jobRef.set({
      category,
      title,
      description,
      price: budget,
      budget,
      urgency,
      preferredDate,
      latitude,
      longitude,
      address: fullAddress || locationLabel,
      locationArea: area,
      hasGpsLocation: Number.isFinite(latitude) && Number.isFinite(longitude),
      location: {
        area,
        fullAddress,
        specialInstructions,
        latitude,
        longitude,
        coordinates: {
          latitude,
          longitude,
        },
        label: locationLabel,
      },
      locationText: locationLabel,
      user: actorEmail,
      userId: actorEmail,
      customerId: actorEmail,
      status: 'open',
      referenceNumber,
      paid: false,
      escrowFunded: false,
      payment_received: false,
      work_started: false,
      work_completed: false,
      customer_confirmed: false,
      payment_released: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtIso,
    });

    const providersSnapshot = await adminDb.collection('providers').where('isAvailable', '==', true).limit(300).get();
    const normalizedCategory = category.toLowerCase();
    const normalizedArea = area.toLowerCase();
    const recipients = providersSnapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((provider) => {
        const providerCategory = String(provider.category || '').trim().toLowerCase();
        const providerArea = String(provider.locationArea || provider.area || '').trim().toLowerCase();
        const categoryMatch = !providerCategory || providerCategory === normalizedCategory;
        const areaMatch = !providerArea || providerArea.includes(normalizedArea) || normalizedArea.includes(providerArea);
        return categoryMatch && areaMatch;
      })
      .map((provider) => String(provider.email || provider.id || '').trim().toLowerCase())
      .filter(Boolean);

    await Promise.all(recipients.map((recipient) => sendNotification(recipient, 'job_accepted', {
      title: 'New Job Nearby',
      body: `${title} • ${area} • GHS ${budget.toFixed(2)}`,
      jobId: jobRef.id,
    })));

    return sendSuccess(res, req, {
      message: 'Job posted successfully',
      data: {
        jobId: jobRef.id,
        referenceNumber,
        status: 'open',
      },
    }, 201);
  } catch (error) {
    logger.error({ err: error }, 'API_CREATE_JOB_ERROR');
    return sendError(res, req, 500, 'create_job_failed', 'Could not post job right now');
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
    const actorRole = String(actorProfile.role || '').trim().toLowerCase();

    if (actorRole !== 'provider') {
      return sendError(res, req, 403, 'provider_access_required', 'Only providers can accept open jobs');
    }

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

    const currentStatus = normalizeRequestStatus(beforeData.status || 'open');
    if (currentStatus !== 'open') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Only open requests can be accepted');
    }

    try {
      enforceStatusTransition({
        requestData: { ...beforeData, id: requestId },
        fromStatus: currentStatus,
        toStatus: 'accepted',
        actorRole: 'provider',
        actorEmail,
        actorUid: req.user?.uid || null,
      });
    } catch (error) {
      return sendError(res, req, 403, 'invalid_status_transition', error.message || 'Status transition not allowed');
    }

    const patch = {
      acceptedBy: actorEmail,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      paymentDueAt: new Date(Date.now() + ACCEPTED_PAYMENT_TIMEOUT_MS).toISOString(),
      escrowFunded: false,
      escrowStatus: 'awaiting_payment',
      payment_received: false,
      work_started: false,
      work_completed: false,
      customer_confirmed: false,
      payment_released: false,
      paymentHold: false,
      paid: false,
    };

    await requestRef.set(patch, { merge: true });

    await logStatusTransition({
      userId: actorEmail,
      jobId: requestId,
      oldStatus: beforeData.status || 'open',
      newStatus: 'accepted',
      triggeredBy: 'manual',
      actorEmail,
      reason: 'provider_accepted',
    });
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: actorEmail,
      fromStatus: beforeData.status || 'open',
      toStatus: 'accepted',
      success: true,
      reason: 'provider_accepted',
      source: 'api_accept',
    });

    if (beforeData.user) {
      const providerSnap = await adminDb.collection('users').doc(actorEmail).get().catch(() => null);
      const providerName = providerSnap && providerSnap.exists
        ? (providerSnap.data()?.name || providerSnap.data()?.displayName || actorEmail)
        : actorEmail;
      await notifyUser(
        beforeData.user,
        `${providerName} has accepted your job: ${beforeData.title || requestId}. Please fund escrow within 24 hours to start work.`,
        'Job Accepted!',
        { type: 'job_accepted', screen: 'job-details', requestId, jobId: requestId }
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

    if (normalizeRequestStatus(beforeData.status) !== 'in_progress') {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: beforeData.status,
        toStatus: 'pending_confirmation',
        success: false,
        reason: 'invalid_status_transition',
        source: 'api_mark_complete',
      });
      return sendError(res, req, 409, 'invalid_status_transition', 'Job must be in progress to mark complete');
    }

    try {
      enforceStatusTransition({
        requestData: { ...beforeData, id: requestId },
        fromStatus: beforeData.status,
        toStatus: 'pending_confirmation',
        actorRole: 'provider',
        actorEmail,
        actorUid: req.user?.uid || null,
      });
    } catch (error) {
      return sendError(res, req, 403, 'invalid_status_transition', error.message || 'Status transition not allowed');
    }

    if (!hasEscrowPaymentProof(beforeData) || beforeData?.work_started !== true) {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: beforeData.status,
        toStatus: 'pending_confirmation',
        success: false,
        reason: 'payment_or_work_start_not_verified',
        source: 'api_mark_complete',
      });
      return sendError(res, req, 409, 'invalid_status_transition', 'Cannot mark complete before verified payment and work start');
    }

    const patch = {
      status: 'pending_confirmation',
      completedAt: new Date().toISOString(),
      work_completed: true,
      workCompletedAt: new Date().toISOString(),
    };

    await requestRef.set(patch, { merge: true });
    await logStatusTransition({
      userId: actorEmail,
      jobId: requestId,
      oldStatus: beforeData.status,
      newStatus: 'pending_confirmation',
      triggeredBy: 'manual',
      actorEmail,
      reason: 'provider_marked_done',
    });
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: actorEmail,
      fromStatus: beforeData.status,
      toStatus: 'pending_confirmation',
      success: true,
      reason: 'provider_marked_done',
      source: 'api_mark_complete',
    });

    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `${beforeData.acceptedBy || 'Your provider'} marked your job as complete. Please confirm.`,
        'Work Completed!',
        { type: 'job_done', screen: 'confirm-completion', requestId, jobId: requestId }
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

app.post('/jobs/:id/start-working', requireAuth, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const actorEmail = String(req.user?.email || '').toLowerCase();
    if (!requestId) return sendError(res, req, 400, 'missing_request_id', 'Missing request id');

    const requestRef = adminDb.collection('requests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return sendError(res, req, 404, 'request_not_found', 'Request not found');

    const beforeData = snap.data() || {};
    const acceptedBy = String(beforeData.acceptedBy || '').toLowerCase();
    if (!acceptedBy || acceptedBy !== actorEmail) {
      return sendError(res, req, 403, 'provider_access_required', 'Only the assigned provider can start work');
    }

    if (!beforeData.escrowFunded || !beforeData.payment_received) {
      return sendError(res, req, 409, 'escrow_not_funded', 'Customer payment must succeed before work can start');
    }

    if (normalizeRequestStatus(beforeData.status) !== 'accepted') {
      return sendError(res, req, 409, 'invalid_status_transition', 'Job must be accepted before starting work');
    }

    try {
      enforceStatusTransition({
        requestData: { ...beforeData, id: requestId },
        fromStatus: beforeData.status,
        toStatus: 'in_progress',
        actorRole: 'system',
        actorEmail: 'provider-triggered-system',
        actorUid: req.user?.uid || null,
      });
    } catch (error) {
      return sendError(res, req, 403, 'invalid_status_transition', error.message || 'Status transition not allowed');
    }

    const patch = {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      work_started: true,
      workStartedAt: new Date().toISOString(),
    };
    await requestRef.set(patch, { merge: true });

    await logStatusTransition({
      userId: actorEmail,
      jobId: requestId,
      oldStatus: beforeData.status,
      newStatus: 'in_progress',
      triggeredBy: 'manual',
      actorEmail,
      reason: 'provider_started_work',
    });

    return sendSuccess(res, req, {
      message: 'Job moved to in progress',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'JOB_START_WORKING_ERROR');
    return sendError(res, req, 500, 'job_start_failed', 'Could not start this job');
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

app.post('/jobs/:id/cancel', requireAuth, async (req, res) => {
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
    const ownerEmail = String(beforeData.user || '').toLowerCase();
    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the customer can cancel this request');
    }

    const normalizedStatus = normalizeRequestStatus(beforeData.status || (beforeData.paid ? 'paid' : 'open'));
    if (normalizedStatus !== 'open') {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: beforeData.status,
        toStatus: 'cancelled',
        success: false,
        reason: 'only_open_requests_can_be_cancelled',
        source: 'api_cancel_job',
      });
      return sendError(res, req, 409, 'invalid_status_transition', 'Only open requests can be cancelled');
    }

    const patch = {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: actorEmail,
      cancellationReason: 'customer_cancelled_before_acceptance',
    };

    await requestRef.set(patch, { merge: true });
    await logStatusTransition({
      userId: ownerEmail,
      jobId: requestId,
      oldStatus: beforeData.status || 'open',
      newStatus: 'cancelled',
      triggeredBy: 'manual',
      actorEmail,
      reason: 'customer_cancelled_before_acceptance',
    });
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: actorEmail,
      fromStatus: beforeData.status || 'open',
      toStatus: 'cancelled',
      success: true,
      reason: 'customer_cancelled_before_acceptance',
      source: 'api_cancel_job',
    });

    await writeAuditLog({
      actorEmail,
      actorUid: req.user?.uid || null,
      eventType: 'customer_cancelled_request',
      requestId,
      before: beforeData,
      after: { ...beforeData, ...patch },
    });

    return sendSuccess(res, req, {
      message: 'Request cancelled successfully',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    logger.error({ err: error }, 'JOB_CANCEL_ERROR');
    return sendError(res, req, 500, 'job_cancel_failed', 'Could not cancel request');
  }
});

app.post('/jobs/:id/confirm-completion', requireAuth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const actorEmail = String(req.user?.email || '').toLowerCase();
    const numericRating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();
    const hasRating = Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5;

    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
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
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: beforeData.status,
        toStatus: 'completed',
        success: false,
        reason: 'invalid_status_transition',
        source: 'api_confirm_completion',
      });
      return sendError(res, req, 409, 'invalid_status_transition', 'Job is not pending customer confirmation');
    }

    try {
      enforceStatusTransition({
        requestData: { ...beforeData, id: requestId },
        fromStatus: beforeData.status,
        toStatus: 'completed',
        actorRole: 'customer',
        actorEmail,
        actorUid: req.user?.uid || null,
      });
    } catch (error) {
      return sendError(res, req, 403, 'invalid_status_transition', error.message || 'Status transition not allowed');
    }

    if (!beforeData?.work_completed) {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: beforeData.status,
        toStatus: 'completed',
        success: false,
        reason: 'work_not_marked_completed',
        source: 'api_confirm_completion',
      });
      return sendError(res, req, 409, 'invalid_status_transition', 'Provider must mark work complete before customer confirmation');
    }

    const nowIso = new Date().toISOString();
    const ratingWindowDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const completionPatch = {
      status: 'completed',
      completionConfirmedAt: nowIso,
      completionConfirmedBy: actorEmail,
      customer_confirmed: true,
      customerConfirmedAt: nowIso,
      rating: hasRating ? numericRating : (beforeData.rating || null),
      review: hasRating ? comment : (beforeData.review || ''),
      ratedAt: hasRating ? nowIso : (beforeData.ratedAt || null),
      ratingRequiredBy: hasRating ? null : ratingWindowDeadline,
    };

    await requestRef.set(completionPatch, { merge: true });
    await logStatusTransition({
      userId: actorEmail,
      jobId: requestId,
      oldStatus: beforeData.status,
      newStatus: 'completed',
      triggeredBy: 'manual',
      actorEmail,
      reason: hasRating ? 'customer_confirmed_with_rating' : 'customer_confirmed_without_rating',
    });
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: actorEmail,
      fromStatus: beforeData.status,
      toStatus: 'completed',
      success: true,
      reason: hasRating ? 'customer_confirmed_with_rating' : 'customer_confirmed_without_rating',
      source: 'api_confirm_completion',
    });

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
        { type: 'payment_received', screen: 'wallet', requestId, jobId: requestId }
      );
    }
    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Job "${beforeData.title || requestId}" completed successfully. Payment has been released.`,
        'Payment Released',
        { type: 'auto_confirmed', screen: 'job-details', requestId, jobId: requestId }
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
        rating: hasRating ? numericRating : null,
        paymentReference: escrowReference,
      },
    });

    return sendSuccess(res, req, {
      message: 'Job confirmed and payment released',
      data: {
        id: requestId,
        status: 'paid',
        paymentReference: escrowReference,
        ratingPendingUntil: hasRating ? null : ratingWindowDeadline,
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

async function releaseEscrowForRequest({ requestId, actorEmail = 'system@connecthub', source = 'manual', forceReconcile = false }) {
  const requestRef = adminDb.collection('requests').doc(String(requestId));
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    return { updated: false, reason: 'request_not_found' };
  }

  const requestData = requestSnap.data() || {};
  const currentStatus = normalizeRequestStatus(requestData.status || (requestData.paid ? 'paid' : 'open'));

  if (!hasEscrowPaymentProof(requestData)) {
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: actorEmail,
      fromStatus: currentStatus,
      toStatus: 'paid',
      success: false,
      reason: 'missing_verified_payment_proof',
      source,
    });
    return { updated: false, reason: 'missing_verified_payment_proof' };
  }

  if (currentStatus === 'pending_confirmation') {
    const confirmGate = validateStatusTransitionGate({
      fromStatus: 'pending_confirmation',
      toStatus: 'completed',
      requestData,
      allowAutoConfirm: source === 'auto_confirmation',
    });
    if (!confirmGate.ok) {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: actorEmail,
        fromStatus: currentStatus,
        toStatus: 'completed',
        success: false,
        reason: confirmGate.reason,
        source,
      });
      return { updated: false, reason: confirmGate.reason };
    }

    const completionPatch = {
      status: 'completed',
      completionConfirmedAt: new Date().toISOString(),
      completionConfirmedBy: actorEmail,
      autoConfirmedAt: source === 'auto_confirmation' ? new Date().toISOString() : null,
      autoConfirmed: source === 'auto_confirmation',
      customer_confirmed: true,
      customerConfirmedAt: new Date().toISOString(),
    };
    await requestRef.set(completionPatch, { merge: true });
    await logStatusTransition({
      userId: requestData.user || null,
      jobId: requestId,
      oldStatus: currentStatus,
      newStatus: 'completed',
      triggeredBy: source === 'auto_confirmation' ? 'auto' : 'manual',
      actorEmail,
      reason: source,
    });
  }

  const escrowReference = requestData.paymentReference || `escrow_release_${requestId}_${Date.now()}`;
  const release = await markRequestPaid(String(requestId), escrowReference, {
    paymentChannel: 'escrow_release',
    gatewayResponse: source === 'auto_confirmation'
      ? 'Escrow released after 48h auto-confirmation timeout'
      : 'Escrow released by admin reconciliation',
    source,
    forceReconcile,
  });

  if (release.updated) {
    await requestRef.set({
      completionMode: source === 'auto_confirmation' ? 'auto_confirmed' : 'manual_admin_release',
      completionResolutionReason: source,
      completionResolvedAt: new Date().toISOString(),
    }, { merge: true });

    if (requestData.user) {
      await notifyUser(
        requestData.user,
        source === 'auto_confirmation'
          ? `Your job "${requestData.title || requestId}" was auto-confirmed after 48 hours.`
          : `Admin has resolved payment for your job "${requestData.title || requestId}".`,
        'Job Resolution Update',
        { screen: 'job-details', requestId, jobId: requestId }
      );
    }
  }

  return release;
}

async function collectStuckPaymentJobs(limitCount = 200) {
  const statuses = ['done', 'confirmed', 'completed', 'paid', 'pending_confirmation'];
  const snapshot = await adminDb.collection('requests')
    .where('status', 'in', statuses)
    .limit(Math.max(1, Math.min(limitCount, 500)))
    .get();

  const rows = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((row) => {
      const provider = String(row.acceptedBy || '').trim().toLowerCase();
      if (!provider) return false;
      if (row.payoutCredited === true) return false;
      if (!hasEscrowPaymentProof(row)) return false;
      return true;
    });

  return rows;
}

async function reconcileStuckPayments({ reason = 'manual_admin_release', maxJobs = 200 } = {}) {
  const stuckJobs = await collectStuckPaymentJobs(maxJobs);
  const results = [];

  for (const row of stuckJobs) {
    const release = await releaseEscrowForRequest({
      requestId: row.id,
      actorEmail: 'admin@connecthub',
      source: reason,
      forceReconcile: false,
    });
    results.push({ id: row.id, status: row.status || 'unknown', release });
  }

  return {
    scanned: stuckJobs.length,
    fixed: results.filter((item) => item.release?.updated).length,
    skipped: results.filter((item) => !item.release?.updated).length,
    items: results,
  };
}

async function autoConfirmOverdueJobs() {
  const pendingSnapshot = await adminDb.collection('requests')
    .where('status', '==', 'pending_confirmation')
    .limit(300)
    .get();

  const cutoffMs = Date.now() - (48 * 60 * 60 * 1000);
  const overdue = pendingSnapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((row) => {
      const completedMs = toMillis(row.completedAt);
      return completedMs > 0 && completedMs <= cutoffMs && hasEscrowPaymentProof(row);
    });

  let released = 0;
  for (const row of overdue) {
    const result = await releaseEscrowForRequest({
      requestId: row.id,
      actorEmail: 'auto-confirm@connecthub',
      source: 'auto_confirmation',
      forceReconcile: false,
    });
    if (result.updated) {
      released += 1;
      await logStatusTransition({
        userId: row.user || null,
        jobId: row.id,
        oldStatus: row.status,
        newStatus: 'paid',
        triggeredBy: 'auto',
        actorEmail: 'auto-confirm@connecthub',
        reason: '48h_timeout',
      });
    }
  }

  if (overdue.length > 0) {
    logger.info({ overdue: overdue.length, released }, 'AUTO_CONFIRM_48H_SWEEP_COMPLETE');
  }
}

async function autoCancelUnpaidAcceptedJobs() {
  const acceptedSnapshot = await adminDb.collection('requests')
    .where('status', '==', 'accepted')
    .limit(400)
    .get();

  const cutoffMs = Date.now() - ACCEPTED_PAYMENT_TIMEOUT_MS;
  const overdueAccepted = acceptedSnapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((row) => {
      const acceptedAtMs = toMillis(row.acceptedAt);
      if (acceptedAtMs <= 0 || acceptedAtMs > cutoffMs) return false;
      if (row.paid === true || row.payment_released === true) return false;
      if (row.payment_received === true || row.escrowFunded === true) return false;
      return true;
    });

  for (const row of overdueAccepted) {
    const requestRef = adminDb.collection('requests').doc(row.id);
    await requestRef.set({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: 'system@connecthub',
      cancellationReason: 'payment_timeout_24h',
      paymentTimeoutAt: new Date().toISOString(),
    }, { merge: true });

    await logStatusTransition({
      userId: row.user || null,
      jobId: row.id,
      oldStatus: row.status || 'accepted',
      newStatus: 'cancelled',
      triggeredBy: 'auto',
      actorEmail: 'system@connecthub',
      reason: 'payment_timeout_24h',
    });
    await logStatusAttempt({
      jobId: row.id,
      attemptedBy: 'system@connecthub',
      fromStatus: row.status || 'accepted',
      toStatus: 'cancelled',
      success: true,
      reason: 'payment_timeout_24h',
      source: 'auto_cancel_unpaid',
    });

    if (row.user) {
      await notifyUser(
        row.user,
        `Your job "${row.title || row.id}" was cancelled because escrow payment was not made within 24 hours.`,
        'Job Cancelled - Payment Timeout',
        { screen: 'job-details', requestId: row.id, jobId: row.id }
      );
    }

    if (row.acceptedBy) {
      await notifyUser(
        row.acceptedBy,
        `Job "${row.title || row.id}" was cancelled because customer payment was not received within 24 hours.`,
        'Job Cancelled - Payment Timeout',
        { screen: 'job-details', requestId: row.id, jobId: row.id }
      );
    }
  }

  if (overdueAccepted.length > 0) {
    logger.info({ cancelled: overdueAccepted.length }, 'AUTO_CANCEL_UNPAID_ACCEPTED_COMPLETE');
  }
}

app.get('/admin/jobs/stuck-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await collectStuckPaymentJobs(200);
    return sendSuccess(res, req, {
      data: rows.map((row) => ({
        id: row.id,
        title: row.title || row.id,
        status: row.status || 'unknown',
        user: row.user || null,
        acceptedBy: row.acceptedBy || null,
        price: parseMoney(row.price),
        escrowFunded: Boolean(row.escrowFunded),
        payoutCredited: Boolean(row.payoutCredited),
        completedAt: row.completedAt || null,
        paidAt: row.paidAt || null,
      })),
      count: rows.length,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_STUCK_PAYMENTS_LIST_ERROR');
    return sendError(res, req, 500, 'admin_stuck_payments_failed', 'Could not load stuck payments');
  }
});

app.post('/admin/jobs/:id/manual-release', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    if (!requestId) {
      return sendError(res, req, 400, 'missing_request_id', 'Missing request id');
    }

    const result = await releaseEscrowForRequest({
      requestId,
      actorEmail: req.userEmail || req.user?.email || ADMIN_EMAIL,
      source: 'manual_admin_release',
      forceReconcile: false,
    });

    await logAdminAction(req.userEmail || req.user?.email || ADMIN_EMAIL, 'manual_admin_release', {
      requestId,
      releaseResult: result,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    if (!result.updated) {
      return sendError(res, req, 409, 'manual_release_skipped', 'Manual release skipped', result);
    }

    return sendSuccess(res, req, {
      message: 'Payment released manually',
      data: { requestId, result },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_MANUAL_RELEASE_ERROR');
    return sendError(res, req, 500, 'manual_release_failed', 'Could not release payment manually');
  }
});

app.post('/admin/jobs/reconcile-stuck-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const maxJobs = Number(req.body?.maxJobs || 200);
    const summary = await reconcileStuckPayments({ reason: 'manual_admin_release', maxJobs });
    await logAdminAction(req.userEmail || req.user?.email || ADMIN_EMAIL, 'reconcile_stuck_payments', {
      summary: {
        scanned: summary.scanned,
        fixed: summary.fixed,
        skipped: summary.skipped,
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });
    return sendSuccess(res, req, { data: summary });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_RECONCILE_STUCK_PAYMENTS_ERROR');
    return sendError(res, req, 500, 'reconcile_stuck_payments_failed', 'Could not reconcile stuck payments');
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
    await logAdminAction(actorEmail, 'user_banned', { targetEmail, reason, ip: req.ip });

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
    await logAdminAction(actorEmail, 'user_unbanned', { targetEmail, ip: req.ip });

    return sendSuccess(res, req, { message: `${targetEmail} has been unbanned.` });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_UNBAN_ERROR');
    return sendError(res, req, 500, 'unban_failed', 'Could not unban user');
  }
});

app.post('/admin/delete-user', verifyAdminToken, async (req, res) => {
  try {
    const uid = String(req.body?.uid || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!uid && !email) {
      return sendError(res, req, 400, 'missing_uid', 'uid or email is required');
    }

    let targetUser = null;

    if (uid) {
      try {
        targetUser = await admin.auth().getUser(uid);
      } catch {
        targetUser = null;
      }
    }

    if (!targetUser && email) {
      try {
        targetUser = await admin.auth().getUserByEmail(email);
      } catch {
        targetUser = null;
      }
    }

    if (!targetUser) {
      return sendError(res, req, 404, 'user_not_found', 'User not found');
    }

    const targetEmail = String(targetUser.email || email || '').trim().toLowerCase();

    await admin.auth().deleteUser(targetUser.uid);

    if (targetEmail) {
      await adminDb.collection('users').doc(targetEmail).delete().catch(() => null);
    }

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      eventType: 'user_deleted',
      metadata: { targetUid: targetUser.uid, targetEmail },
    });
    await logAdminAction(req.user?.email || null, 'user_deleted', { targetUid: targetUser.uid, targetEmail, ip: req.ip });

    return sendSuccess(res, req, {
      message: `${targetEmail || targetUser.uid} deleted.`,
      uid: targetUser.uid,
      email: targetEmail || null,
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_DELETE_USER_ERROR');
    return sendError(res, req, 500, 'delete_user_failed', 'Could not delete user');
  }
});

app.get('/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const logsSnap = await adminDb.collection('adminLogs').orderBy('timestamp', 'desc').limit(20).get();
    const rows = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return sendSuccess(res, req, { data: rows });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_ACTIVITY_LOGS_ERROR');
    return sendError(res, req, 500, 'admin_activity_logs_failed', 'Could not load admin activity logs');
  }
});

app.get('/admin/fraud-alerts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertsSnap = await adminDb.collection('fraudAlerts').orderBy('timestamp', 'desc').limit(50).get();
    const rows = alertsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return sendSuccess(res, req, { data: rows });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_FRAUD_ALERTS_ERROR');
    return sendError(res, req, 500, 'admin_fraud_alerts_failed', 'Could not load fraud alerts');
  }
});

app.post('/admin/fraud-alerts/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = String(req.params.id || '').trim();
    if (!alertId) {
      return sendError(res, req, 400, 'missing_alert_id', 'Alert id is required');
    }

    await adminDb.collection('fraudAlerts').doc(alertId).set({
      resolved: true,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedBy: String(req.userEmail || req.user?.email || ADMIN_EMAIL).trim().toLowerCase(),
    }, { merge: true });

    await logAdminAction(req.userEmail || req.user?.email || ADMIN_EMAIL, 'fraud_alert_resolved', {
      alertId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return sendSuccess(res, req, { message: 'Fraud alert marked resolved' });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_FRAUD_ALERT_RESOLVE_ERROR');
    return sendError(res, req, 500, 'admin_fraud_alert_resolve_failed', 'Could not resolve fraud alert');
  }
});

// ── Admin: Analytics ──────────────────────────────────────────────────────
app.get('/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cacheKey = 'analytics:overview:v1';
    const cached = cache.get(cacheKey);
    if (cached) {
      return sendSuccess(res, req, { data: cached, cached: true });
    }

    const [requestsSnap, usersSnap, transactionsSnap] = await Promise.all([
      adminDb.collection('requests').limit(50).get(),
      adminDb.collection('users').limit(100).get(),
      adminDb.collection('transactions').limit(50).get(),
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

    const analyticsData = {
      jobs: { total: totalJobs, paid: paidJobs, open: openJobs, active: activeJobs, disputed: disputedJobs },
      revenue: { commissionEarned: parseFloat(totalRevenue.toFixed(2)), subscriptionMRR: subscriptionRevenue, escrowHeld: parseFloat(totalEscrow.toFixed(2)), transactionVolume: parseFloat(totalTransactionVolume.toFixed(2)) },
      users: { total: totalUsers, verified: verifiedUsers, banned: bannedUsers, proSubscribers: proSubs, premiumSubscribers: premiumSubs },
    };

    cache.set(cacheKey, analyticsData, 60 * 1000);
    return sendSuccess(res, req, { data: analyticsData });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_ANALYTICS_ERROR');
    return sendError(res, req, 500, 'analytics_failed', 'Could not compute analytics');
  }
});

// ✅ START SERVER
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ url: PUBLIC_SERVER_BASE_URL, allowedOrigins: Array.from(allowedOriginSet) }, 'SERVER_STARTED');
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxConnections = 10000;

function gracefulShutdown(signal) {
  logger.info({ signal }, 'SERVER_SHUTDOWN_REQUESTED');
  server.close(() => {
    logger.info('SERVER_STOPPED');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error({ signal }, 'SERVER_FORCED_SHUTDOWN_TIMEOUT');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'UNHANDLED_REJECTION');
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
    cleanupExpiredOTPs();
    autoConfirmOverdueJobs().catch((error) => logger.error({ err: error }, 'AUTO_CONFIRM_SWEEP_ERROR'));
    reconcileStuckPayments({ reason: 'auto_reconcile_stuck_payments', maxJobs: 120 }).catch((error) => logger.error({ err: error }, 'AUTO_RECONCILE_SWEEP_ERROR'));
    autoCancelUnpaidAcceptedJobs().catch((error) => logger.error({ err: error }, 'AUTO_CANCEL_UNPAID_SWEEP_ERROR'));
    setInterval(() => {
      expireDueSubscriptions();
      cleanupExpiredOTPs();
      autoConfirmOverdueJobs().catch((error) => logger.error({ err: error }, 'AUTO_CONFIRM_SWEEP_ERROR'));
      reconcileStuckPayments({ reason: 'auto_reconcile_stuck_payments', maxJobs: 120 }).catch((error) => logger.error({ err: error }, 'AUTO_RECONCILE_SWEEP_ERROR'));
      autoCancelUnpaidAcceptedJobs().catch((error) => logger.error({ err: error }, 'AUTO_CANCEL_UNPAID_SWEEP_ERROR'));
    }, 24 * 60 * 60 * 1000);
  }, delayMs);
}

scheduleDailySubscriptionSweep();
expireDueSubscriptions();
cleanupExpiredOTPs();
autoConfirmOverdueJobs().catch((error) => logger.error({ err: error }, 'AUTO_CONFIRM_SWEEP_ERROR'));
reconcileStuckPayments({ reason: 'startup_reconcile_stuck_payments', maxJobs: 80 }).catch((error) => logger.error({ err: error }, 'AUTO_RECONCILE_SWEEP_ERROR'));
autoCancelUnpaidAcceptedJobs().catch((error) => logger.error({ err: error }, 'AUTO_CANCEL_UNPAID_SWEEP_ERROR'));

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
    const testTo = String(req.body?.to || process.env.SUPPORT_EMAIL || 'connecthub1000@gmail.com').trim().toLowerCase();
    if (!testTo) return sendError(res, req, 400, 'missing_to', 'Provide a destination email address');

    if (!isEmailConfigured()) {
      return sendError(res, req, 503, 'email_not_configured',
        'EMAIL_USER and EMAIL_PASS environment variables are not set on this server. Add them in your Render dashboard under Environment.');
    }

    await emailTransporter.sendMail({
      from: emailFrom || 'no-reply@connecthub.app',
      to: testTo,
      subject: 'ConnectHub Email Health Check',
      html: `<h2>Email delivery confirmed ✅</h2>
             <p>This test email was sent from the ConnectHub backend at <b>${new Date().toUTCString()}</b>.</p>
             <p>SMTP is correctly configured and emails will be delivered.</p>`,
    });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_email_test',
      metadata: { to: testTo },
    });

    return sendSuccess(res, req, { message: 'Test email sent', to: testTo, configured: true });
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

    const allowedStatuses = ['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'paid', 'disputed', 'cancelled'];

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
    const oldStatus = normalizeRequestStatus(beforeData?.status || (beforeData?.paid ? 'paid' : 'open'));
    const newStatus = normalizeRequestStatus(status);

    if (['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'paid'].includes(oldStatus)
      && ['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'paid'].includes(newStatus)
      && !canAdvanceStatus(oldStatus, newStatus)) {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: req.user?.email || null,
        fromStatus: oldStatus,
        toStatus: newStatus,
        success: false,
        reason: 'backward_transition_blocked',
        source: 'admin_moderate',
      });
      return sendError(res, req, 409, 'invalid_status_transition', `Cannot move request backward from ${oldStatus} to ${newStatus}`);
    }

    const gate = validateStatusTransitionGate({
      fromStatus: oldStatus,
      toStatus: newStatus,
      requestData: beforeData,
      allowAutoConfirm: false,
    });
    if (!gate.ok && !['disputed', 'cancelled', 'open'].includes(newStatus)) {
      await logStatusAttempt({
        jobId: requestId,
        attemptedBy: req.user?.email || null,
        fromStatus: oldStatus,
        toStatus: newStatus,
        success: false,
        reason: gate.reason,
        source: 'admin_moderate',
      });
      return sendError(res, req, 409, 'invalid_status_transition', `Cannot move request from ${oldStatus} to ${newStatus}: ${gate.reason}`);
    }

    const patch = {
      status: newStatus,
      moderatedBy: req.user?.email || null,
      moderatedAt: new Date().toISOString(),
      moderationNote: note || null,
    };

    if (status === 'open') {
      patch.acceptedBy = null;
      patch.paid = false;
      patch.payment_received = false;
      patch.work_started = false;
      patch.work_completed = false;
      patch.customer_confirmed = false;
      patch.payment_released = false;
      patch.escrowFunded = false;
      patch.escrowStatus = null;
      patch.paymentHold = false;
      patch.paymentReference = null;
      patch.paymentStatus = null;
      patch.paidAt = null;
    }

    await requestRef.set(patch, { merge: true });
    await logStatusTransition({
      userId: beforeData?.user || null,
      jobId: requestId,
      oldStatus,
      newStatus,
      triggeredBy: 'manual',
      actorEmail: req.user?.email || null,
      reason: 'admin_status_change',
    });
    await logStatusAttempt({
      jobId: requestId,
      attemptedBy: req.user?.email || null,
      fromStatus: oldStatus,
      toStatus: newStatus,
      success: true,
      reason: 'admin_status_change',
      source: 'admin_moderate',
    });

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


/**
 * POST /profile/username/change
 * First change: standard self-service.
 * Second+ changes: requires automatic KYC re-verification (name + dob + idNumber + new ID upload URL).
 */
app.post('/profile/username/change', requireAuth, async (req, res) => {
  try {
    const email = String(req.userEmail || req.user?.email || '').trim().toLowerCase();
    const userUid = String(req.user?.uid || '').trim();
    if (!email) {
      return sendError(res, req, 401, 'missing_user_email', 'Unable to determine user email');
    }

    if (!hasRecentAuth(req.user)) {
      return sendError(
        res,
        req,
        401,
        'recent_login_required',
        'For security, please re-authenticate and try again.',
        { reauthWindowSeconds: RECENT_AUTH_MAX_AGE_SECONDS }
      );
    }

    const newUsername = String(req.body?.newUsername || '').trim();
    if (!USERNAME_PATTERN.test(newUsername)) {
      return sendError(res, req, 400, 'invalid_username', 'Username must be 3-40 chars and can include letters, numbers, spaces, underscores, hyphens, and dots.');
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const nextUsernameLower = newUsername.toLowerCase();
    const userRef = adminDb.collection('users').doc(email);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return sendError(res, req, 404, 'user_not_found', 'User profile not found');
    }

    const userData = userSnap.data() || {};
    const displayName = String(userData.displayName || userData.username || userData.name || email).trim();
    const currentUsername = String(userData.username || userData.displayName || userData.name || '').trim();
    const lockedUntilMs = toMillis(userData.usernameChangeLockedUntil);

    if (lockedUntilMs > nowMs) {
      const secondsRemaining = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
      await adminDb.collection('usernameChangeLogs').add({
        email,
        outcome: 'failed',
        reason: 'locked',
        attemptedUsername: newUsername,
        attemptedAt: nowIso,
        createdAt: nowIso,
        ip: req.ip,
        secondsRemaining,
      });
      await notifyUser(
        email,
        'Username change is temporarily locked after multiple failed verification attempts. Please try again later.',
        'Username Change Locked',
        { screen: 'profile' }
      );
      if (isEmailConfigured()) {
        await sendPaymentReceiptEmail(
          email,
          displayName,
          'Username Change Locked - ConnectHub',
          `<p>Hi ${displayName},</p>
           <p>We blocked a username change attempt because your account is currently locked after repeated failed verification checks.</p>
           <p><b>Attempted username:</b> ${newUsername}</p>
           <p><b>Time:</b> ${nowIso}</p>
           <p><b>Lock expires:</b> ${new Date(lockedUntilMs).toISOString()}</p>
           <p>If this was not you, reset your password immediately.</p>`
        ).catch((err) => logger.warn({ err, email }, 'USERNAME_SECURITY_EMAIL_FAILED'));
      }
      return sendError(res, req, 429, 'username_change_locked', 'Too many failed attempts. Please try again later.', {
        lockedUntil: new Date(lockedUntilMs).toISOString(),
        secondsRemaining,
      });
    }

    const lastChangeMs = toMillis(userData.usernameUpdatedAt);
    const cooldownMs = Math.max(0, USERNAME_CHANGE_COOLDOWN_SECONDS) * 1000;
    if (Number.isFinite(lastChangeMs) && lastChangeMs > 0 && cooldownMs > 0 && (nowMs - lastChangeMs) < cooldownMs) {
      const secondsRemaining = Math.max(1, Math.ceil((cooldownMs - (nowMs - lastChangeMs)) / 1000));
      const nextAllowedAt = new Date(nowMs + secondsRemaining * 1000).toISOString();
      await adminDb.collection('usernameChangeLogs').add({
        email,
        outcome: 'failed',
        reason: 'cooldown_not_elapsed',
        attemptedUsername: newUsername,
        attemptedAt: nowIso,
        createdAt: nowIso,
        ip: req.ip,
        secondsRemaining,
        nextAllowedAt,
      });
      await notifyUser(
        email,
        'A cooldown is active for username changes. Please try again after the timer ends.',
        'Username Cooldown Active',
        { screen: 'profile' }
      );
      if (isEmailConfigured()) {
        await sendPaymentReceiptEmail(
          email,
          displayName,
          'Username Change Cooldown - ConnectHub',
          `<p>Hi ${displayName},</p>
           <p>A username change attempt was blocked because your cooldown window is still active.</p>
           <p><b>Attempted username:</b> ${newUsername}</p>
           <p><b>Time:</b> ${nowIso}</p>
           <p><b>Try again after:</b> ${nextAllowedAt}</p>
           <p>If this was not you, reset your password immediately.</p>`
        ).catch((err) => logger.warn({ err, email }, 'USERNAME_SECURITY_EMAIL_FAILED'));
      }
      return sendError(res, req, 429, 'username_change_cooldown', 'Username can only be changed after the cooldown period.', {
        cooldownSeconds: USERNAME_CHANGE_COOLDOWN_SECONDS,
        secondsRemaining,
        nextAllowedAt,
      });
    }

    if (currentUsername && currentUsername.toLowerCase() === nextUsernameLower) {
      return sendError(res, req, 409, 'same_username', 'That is already your current username');
    }

    const duplicateSnap = await adminDb.collection('users').where('usernameLower', '==', nextUsernameLower).limit(1).get();
    if (!duplicateSnap.empty && duplicateSnap.docs[0].id !== email) {
      return sendError(res, req, 409, 'username_taken', 'That username is already taken');
    }

    const changeCount = Number(userData.usernameChangeCount || 0);
    const requiresKycReverification = changeCount >= 1;
    let verificationMetadata = null;

    if (requiresKycReverification) {
      const providedFullName = normalizeLooseText(req.body?.fullName);
      const providedDob = normalizeDob(req.body?.dob);
      const providedIdNumber = normalizeIdNumberForMatch(req.body?.idNumber);
      const providedIdCardUrl = String(req.body?.idCardUrl || '').trim();

      if (!providedFullName || !providedDob || !providedIdNumber || !providedIdCardUrl) {
        return sendError(res, req, 400, 'missing_reverification_fields', 'For additional username changes, provide fullName, dob, idNumber, and uploaded idCardUrl.');
      }

      if (!isLikelyStorageUrl(providedIdCardUrl)) {
        return sendError(res, req, 400, 'invalid_id_upload', 'Please upload your ID card and submit a valid storage URL.');
      }

      const kycSnap = await adminDb.collection('kyc_submissions').doc(email).get();
      if (!kycSnap.exists) {
        return sendError(res, req, 403, 'kyc_missing', 'No KYC record found for automated re-verification');
      }

      const kyc = kycSnap.data() || {};
      const effectiveKycStatus = String(kyc.kycStatus || userData.kycStatus || '').trim().toLowerCase();
      if (effectiveKycStatus !== 'verified') {
        return sendError(res, req, 403, 'kyc_not_verified', 'Username re-verification requires a verified KYC profile');
      }

      const expectedFullName = normalizeLooseText(kyc.fullName);
      const expectedDob = normalizeDob(kyc.dob);
      const expectedIdNumber = normalizeIdNumberForMatch(kyc.idNumber);

      const detailsMatch = expectedFullName && expectedDob && expectedIdNumber
        && providedFullName === expectedFullName
        && providedDob === expectedDob
        && providedIdNumber === expectedIdNumber;

      if (!detailsMatch) {
        const priorFailures = Number(userData.usernameChangeFailedAttempts || 0);
        const nextFailures = priorFailures + 1;
        const shouldLock = nextFailures >= Math.max(1, USERNAME_CHANGE_LOCK_THRESHOLD);
        const lockedUntil = shouldLock
          ? new Date(nowMs + (Math.max(1, USERNAME_CHANGE_LOCK_SECONDS) * 1000)).toISOString()
          : null;

        await userRef.set({
          usernameChangeFailedAttempts: nextFailures,
          usernameChangeLockedUntil: lockedUntil,
          updatedAt: nowIso,
        }, { merge: true });

        await adminDb.collection('usernameChangeLogs').add({
          email,
          outcome: 'failed',
          reason: 'kyc_details_mismatch',
          attemptedUsername: newUsername,
          attemptedAt: nowIso,
          createdAt: nowIso,
          ip: req.ip,
          failureCount: nextFailures,
          lockedUntil,
        });

        await notifyUser(
          email,
          shouldLock
            ? 'Username change was locked because repeated verification attempts failed.'
            : 'A username change attempt failed because the submitted details did not match your KYC profile.',
          shouldLock ? 'Username Change Locked' : 'Username Change Failed',
          { screen: 'profile' }
        );

        if (isEmailConfigured()) {
          await sendPaymentReceiptEmail(
            email,
            displayName,
            shouldLock ? 'Username Change Locked - ConnectHub' : 'Username Change Attempt Failed - ConnectHub',
            `<p>Hi ${displayName},</p>
             <p>We blocked a username change attempt because the verification details did not match your KYC profile.</p>
             <p><b>Attempted username:</b> ${newUsername}</p>
             <p><b>IP:</b> ${String(req.ip || 'unknown')}</p>
             <p><b>Time:</b> ${nowIso}</p>
             ${shouldLock ? `<p><b>Lock expires:</b> ${lockedUntil}</p>` : `<p><b>Remaining attempts before lock:</b> ${Math.max(0, USERNAME_CHANGE_LOCK_THRESHOLD - nextFailures)}</p>`}
             <p>If this was not you, reset your password immediately.</p>`
          ).catch((err) => logger.warn({ err, email }, 'USERNAME_SECURITY_EMAIL_FAILED'));
        }

        if (shouldLock) {
          return sendError(res, req, 429, 'username_change_locked', 'Too many failed attempts. Please try again later.', {
            lockedUntil,
            failureCount: nextFailures,
          });
        }

        return sendError(res, req, 403, 'kyc_details_mismatch', 'The submitted verification details do not match your existing KYC record.', {
          failureCount: nextFailures,
          remainingAttempts: Math.max(0, USERNAME_CHANGE_LOCK_THRESHOLD - nextFailures),
        });
      }

      verificationMetadata = {
        mode: 'kyc_auto_match',
        matchedAt: nowIso,
        idCardUrl: providedIdCardUrl,
        fullNameMatched: true,
        dobMatched: true,
        idNumberMasked: maskIdentifier(providedIdNumber),
        idNumberEncrypted: encryptField(providedIdNumber),
      };
    }

    const nextChangeCount = changeCount + 1;

    await userRef.set({
      username: newUsername,
      usernameLower: nextUsernameLower,
      displayName: newUsername,
      usernameUpdatedAt: nowIso,
      usernameChangeCount: nextChangeCount,
      usernameLastChangeBy: email,
      usernameLastVerification: verificationMetadata,
      usernameChangeFailedAttempts: 0,
      usernameChangeLockedUntil: null,
      updatedAt: nowIso,
    }, { merge: true });

    await adminDb.collection('usernameChangeLogs').add({
      email,
      outcome: 'success',
      previousUsername: currentUsername || null,
      newUsername,
      attemptedAt: nowIso,
      usernameChangeCount: nextChangeCount,
      requiresKycReverification,
      createdAt: nowIso,
      ip: req.ip,
      cooldownSeconds: USERNAME_CHANGE_COOLDOWN_SECONDS,
    });

    await notifyUser(
      email,
      'Your username was changed to ' + newUsername + '. Other devices were signed out. If this was not you, contact support immediately.',
      'Username Updated',
      { screen: 'profile' }
    );

    if (isEmailConfigured()) {
      await sendPaymentReceiptEmail(
        email,
        displayName,
        'Username Updated - Security Notice - ConnectHub',
        `<p>Hi ${displayName},</p>
         <p>Your username was changed successfully.</p>
         <p><b>Old username:</b> ${currentUsername || '(none)'}</p>
         <p><b>New username:</b> ${newUsername}</p>
         <p><b>Time:</b> ${nowIso}</p>
         <p><b>IP:</b> ${String(req.ip || 'unknown')}</p>
         <p>For your security, other sessions were signed out.</p>`
      ).catch((err) => logger.warn({ err, email }, 'USERNAME_SECURITY_EMAIL_FAILED'));
    }

    if (userUid) {
      try {
        await admin.auth().revokeRefreshTokens(userUid);
        await userRef.set({ usernameSessionsRevokedAt: nowIso }, { merge: true });
      } catch (revokeError) {
        logger.warn({ err: revokeError, userUid, email }, 'USERNAME_REVOKE_SESSIONS_FAILED');
      }
    }

    return sendSuccess(res, req, {
      message: 'Username updated successfully',
      data: {
        username: newUsername,
        usernameChangeCount: nextChangeCount,
        requiresKycReverification,
        cooldownSeconds: USERNAME_CHANGE_COOLDOWN_SECONDS,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'PROFILE_USERNAME_CHANGE_ERROR');
    return sendError(res, req, 500, 'username_change_failed', 'Could not change username');
  }
});

app.get('/profile/username/audit', requireAuth, async (req, res) => {
  try {
    const email = String(req.userEmail || req.user?.email || '').trim().toLowerCase();
    if (!email) {
      return sendError(res, req, 401, 'missing_user_email', 'Unable to determine user email');
    }

    const limit = Math.min(Math.max(Number(req.query?.limit || USERNAME_CHANGE_AUDIT_LIMIT), 1), 50);
    const logsSnap = await adminDb
      .collection('usernameChangeLogs')
      .where('email', '==', email)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const rows = logsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return sendSuccess(res, req, { data: rows });
  } catch (error) {
    logger.error({ err: error }, 'PROFILE_USERNAME_AUDIT_ERROR');
    return sendError(res, req, 500, 'username_audit_failed', 'Could not load username audit history');
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
    let q = adminDb.collection('kyc_submissions').orderBy('submittedAt', 'desc').limit(100);
    if (status) {
      q = adminDb.collection('kyc_submissions').where('kycStatus', '==', String(status)).orderBy('submittedAt', 'desc').limit(100);
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

    await logAdminAction(req.user?.email || ADMIN_EMAIL, 'kyc_approved', {
      targetEmail,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
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

    await logAdminAction(req.user?.email || ADMIN_EMAIL, 'kyc_rejected', {
      targetEmail,
      reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
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

    await logAdminAction(req.user?.email || ADMIN_EMAIL, 'kyc_approval_notified', {
      targetEmail: email,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

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

    await logAdminAction(req.user?.email || ADMIN_EMAIL, 'kyc_rejection_notified', {
      targetEmail: email,
      reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

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
      nextStatus = 'completed';
      paid = false;
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
      nextStatus = 'completed';
      paid = false;
    }

    const paymentReference = `dispute_${resolution}_${requestId}_${Date.now()}`;
    const requestPatch = {
      status: nextStatus,
      paid,
      paidAt: paid ? now : null,
      payment_released: false,
      payoutCredited: false,
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
      customer_confirmed: resolution === 'refund_customer' ? false : true,
      customerConfirmedAt: resolution === 'refund_customer' ? null : now,
      paymentReference: beforeRequest.paymentReference || null,
      paymentStatus: resolution === 'refund_customer'
        ? 'refunded'
        : (beforeRequest.paymentStatus || 'success'),
      paymentChannel: beforeRequest.paymentChannel || 'paystack',
      gatewayResponse: resolution === 'release_to_worker'
        ? 'Escrow released to provider by admin after dispute review'
        : resolution === 'refund_customer'
          ? 'Escrow refunded to customer by admin after dispute review'
          : 'Escrow split between customer and provider by admin after dispute review',
      disputeResolutionReference: paymentReference,
      splitPercentToWorker: resolution === 'split' ? splitPercentToWorker : null,
      splitPercentToCustomer: resolution === 'split' ? parseFloat((100 - splitPercentToWorker).toFixed(2)) : null,
      refundAmount: resolution === 'refund_customer' ? customerRefund : null,
      refundedAt: resolution === 'refund_customer' ? now : null,
      payoutCreditedAt: null,
      payoutCreditReason: null,
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

    await logAdminAction(req.user?.email || ADMIN_EMAIL, 'dispute_resolved', {
      disputeId,
      requestId,
      resolution,
      providerPayout,
      customerRefund,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    if (providerPayout > 0 && beforeRequest.acceptedBy) {
      const payoutRelease = await markRequestPaid(requestId, paymentReference, {
        paymentChannel: 'dispute_resolution',
        gatewayResponse: requestPatch.gatewayResponse,
        source: 'dispute_resolution',
      });

      if (!payoutRelease.updated) {
        return sendError(res, req, 409, 'dispute_payout_release_failed', 'Dispute resolved but payout release failed', payoutRelease);
      }

      nextStatus = 'paid';
      paid = true;
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
    const checkout = await createWalletTopupCheckout({
      actorEmail,
      amount: req.body?.amount,
      callbackUrl: req.body?.callbackUrl,
    });

    if (!checkout.ok) {
      return sendError(res, req, checkout.statusCode || 500, checkout.code || 'wallet_topup_init_failed', checkout.message || 'Could not initialize wallet top up');
    }

    return sendSuccess(res, req, {
      message: 'Wallet top up initialized',
      data: {
        authorization_url: checkout.authorizationUrl,
        access_code: checkout.accessCode,
        reference: checkout.reference,
        amount: checkout.amount,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_TOPUP_INIT_ERROR');
    return sendError(res, req, 500, 'wallet_topup_init_failed', 'Could not initialize wallet top up');
  }
});

app.post('/wallet/topup', payInitLimiter, requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    const checkout = await createWalletTopupCheckout({
      actorEmail,
      amount: req.body?.amount,
      callbackUrl: req.body?.callbackUrl,
    });

    if (!checkout.ok) {
      return sendError(res, req, checkout.statusCode || 500, checkout.code || 'wallet_topup_init_failed', checkout.message || 'Could not initialize wallet top up');
    }

    return sendSuccess(res, req, {
      message: 'Wallet top up initialized',
      data: {
        authorization_url: checkout.authorizationUrl,
        access_code: checkout.accessCode,
        reference: checkout.reference,
        amount: checkout.amount,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_TOPUP_INIT_ALIAS_ERROR');
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
    const amountPesewas = Number(data?.data?.amount || 0);
    const amountGhs = parseMoney(amountPesewas / 100);

    // Two valid flows:
    // A) Server-initialized: Paystack transaction has metadata.type = 'wallet_topup'
    // B) Client-initiated: no Paystack metadata, but the reference was pre-registered
    //    in Firestore wallet_topups by the client before opening Paystack.
    if (metadataType && metadataType !== 'wallet_topup') {
      return sendError(res, req, 400, 'invalid_topup_type', 'This payment reference is not a wallet top up');
    }

    if (!amountGhs || amountGhs <= 0) {
      return sendError(res, req, 400, 'invalid_topup_amount', 'Top up amount is invalid');
    }

    const ownerEmail = metadataOwner || transactionEmail || actorEmail;
    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the payment owner can apply this wallet top up');
    }
    const applyResult = await applyWalletTopupCredit({
      reference,
      ownerEmail,
      amountPesewas,
      gatewayResponse: data?.data?.gateway_response || null,
      paymentChannel: data?.data?.channel || null,
      source: metadataType === 'wallet_topup' ? 'wallet_topup_verify' : 'wallet_topup_verify_legacy',
      allowLegacyMatch: !metadataType,
    });

    if (!applyResult.ok) {
      const statusCode = applyResult.code === 'owner_access_required'
        ? 403
        : applyResult.code === 'ambiguous_topup_reference'
          ? 409
          : 400;
      return sendError(res, req, statusCode, applyResult.code || 'wallet_topup_apply_failed', applyResult.message || 'Could not apply wallet top up');
    }

    return sendSuccess(res, req, {
      message: applyResult.alreadyApplied ? 'Wallet top up already applied' : 'Wallet top up applied',
      data: {
        reference,
        amount: applyResult.amount,
        applied: !applyResult.alreadyApplied,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'WALLET_TOPUP_VERIFY_ERROR');
    return sendError(res, req, 500, 'wallet_topup_verify_failed', 'Could not verify wallet top up');
  }
});

app.post('/api/payments/initiate', paymentLimiter, requireAuth, async (req, res) => {
  try {
    const paystackSecret = getPaystackSecret();
    const jobId = String(req.body?.jobId || req.body?.requestId || '').trim();
    const customerEmail = String(req.user?.email || '').trim().toLowerCase();

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    if (!jobId) {
      return sendError(res, req, 400, 'missing_job_id', 'Job id is required');
    }

    const requestRef = adminDb.collection('requests').doc(jobId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return sendError(res, req, 404, 'job_not_found', 'Job was not found');
    }

    const requestData = requestSnap.data() || {};
    const ownerEmail = String(requestData.user || '').trim().toLowerCase();
    const providerId = String(requestData.acceptedBy || '').trim().toLowerCase();
    const amount = parseMoney(requestData.price || 0);
    const status = normalizeRequestStatus(requestData.status || 'open');

    if (!ownerEmail || ownerEmail !== customerEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the job customer can initiate payment');
    }

    if (!providerId) {
      return sendError(res, req, 409, 'provider_not_assigned', 'Provider must be assigned before payment');
    }

    if (!['open', 'accepted'].includes(status)) {
      return sendError(res, req, 409, 'invalid_status_transition', 'Payment can only start for open or accepted jobs');
    }

    if (!Number.isFinite(amount) || amount < 10) {
      return sendError(res, req, 400, 'invalid_amount', 'Job budget is invalid for payment');
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency: 'GHS',
        email: ownerEmail,
        callback_url: `${NORMALIZED_CALLBACK_BASE_URL}/pay-return?id=${encodeURIComponent(jobId)}`,
        metadata: {
          jobId,
          requestId: jobId,
          customerId: ownerEmail,
          providerId,
        },
      }),
    });

    const payload = await paystackResponse.json();
    if (!paystackResponse.ok || !payload?.status || !payload?.data?.reference) {
      return sendError(res, req, 502, 'paystack_init_failed', payload?.message || 'Could not initialize payment');
    }

    await requestRef.set({
      paymentInitReference: payload.data.reference,
      paymentInitAt: new Date().toISOString(),
    }, { merge: true });

    return sendSuccess(res, req, {
      message: 'Payment initialized',
      data: {
        jobId,
        reference: payload.data.reference,
        authorizationUrl: payload.data.authorization_url,
        accessCode: payload.data.access_code,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'API_PAYMENTS_INITIATE_ERROR');
    return sendError(res, req, 500, 'payments_initiate_failed', 'Could not initiate payment');
  }
});

app.post('/api/payments/verify', paymentLimiter, requireAuth, async (req, res) => {
  try {
    const paystackSecret = getPaystackSecret();
    const reference = String(req.body?.reference || '').trim();
    if (!reference) {
      return sendError(res, req, 400, 'missing_reference', 'Payment reference is required');
    }

    if (!paystackSecret) {
      return sendError(res, req, 500, 'payment_configuration_missing', 'Server payment configuration missing');
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
    });
    const verifiedPayload = await verifyResponse.json();

    if (!verifyResponse.ok || !verifiedPayload?.status || verifiedPayload?.data?.status !== 'success') {
      return sendError(res, req, 400, 'payment_not_verified', 'Payment verification was not successful', verifiedPayload);
    }

    const jobId = String(verifiedPayload?.data?.metadata?.jobId || verifiedPayload?.data?.metadata?.requestId || '').trim();
    if (!jobId) {
      return sendError(res, req, 409, 'missing_job_reference', 'Verified payment does not include a valid job id');
    }

    const requestRef = adminDb.collection('requests').doc(jobId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return sendError(res, req, 404, 'job_not_found', 'Job was not found for this payment');
    }

    const requestData = requestSnap.data() || {};
    const ownerEmail = String(requestData.user || '').trim().toLowerCase();
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    if (!ownerEmail || ownerEmail !== actorEmail) {
      return sendError(res, req, 403, 'owner_access_required', 'Only the job customer can verify this payment');
    }

    const chargedAmount = parseMoney(Number(verifiedPayload?.data?.amount || 0) / 100);
    const jobAmount = parseMoney(requestData.price || 0);
    if (Math.abs(chargedAmount - jobAmount) > 0.01) {
      return sendError(res, req, 409, 'amount_mismatch', 'Payment amount does not match job amount');
    }

    const updateResult = await markRequestEscrowFunded(jobId, reference, {
      paymentChannel: verifiedPayload?.data?.channel || 'paystack',
      gatewayResponse: verifiedPayload?.data?.gateway_response || 'verified',
      source: 'api_payments_verify',
    });
    if (!updateResult.updated) {
      return sendError(res, req, 409, 'status_update_failed', 'Payment verified but status transition failed', updateResult);
    }

    await adminDb.collection('transactions').add({
      jobId,
      requestId: jobId,
      customerId: ownerEmail,
      providerId: String(requestData.acceptedBy || '').trim().toLowerCase(),
      amount: jobAmount,
      paystackRef: reference,
      status: 'escrowed',
      type: 'escrow',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });

    await adminDb.collection('escrow').doc(jobId).set({
      jobId,
      customerId: ownerEmail,
      providerId: String(requestData.acceptedBy || '').trim().toLowerCase(),
      amount: jobAmount,
      paystackRef: reference,
      status: 'held',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    }, { merge: true });

    return sendSuccess(res, req, {
      message: 'Payment verified and escrow funded',
      data: {
        jobId,
        reference,
        status: 'working',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'API_PAYMENTS_VERIFY_ERROR');
    return sendError(res, req, 500, 'payments_verify_failed', 'Could not verify payment');
  }
});

app.post('/api/payments/release', requireAuth, async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').trim().toLowerCase();
    if (!isAdminEmail(actorEmail) && req.user?.admin !== true) {
      return sendError(res, req, 403, 'system_only', 'This endpoint is system-only');
    }

    const jobId = String(req.body?.jobId || req.body?.requestId || '').trim();
    if (!jobId) {
      return sendError(res, req, 400, 'missing_job_id', 'Job id is required');
    }

    const release = await releaseEscrowForRequest({
      requestId: jobId,
      actorEmail,
      source: String(req.body?.triggeredBy || 'api_release'),
      forceReconcile: false,
    });

    if (!release.updated) {
      return sendError(res, req, 409, 'release_failed', 'Escrow release was not applied', release);
    }

    return sendSuccess(res, req, {
      message: 'Escrow released and job marked paid',
      data: { jobId, status: 'paid' },
    });
  } catch (error) {
    logger.error({ err: error }, 'API_PAYMENTS_RELEASE_ERROR');
    return sendError(res, req, 500, 'payments_release_failed', 'Could not release escrow payment');
  }
});

app.post('/api/withdrawals/request', requireAuth, (req, res, next) => {
  req.url = '/wallet/withdraw';
  return app.handle(req, res, next);
});

app.post('/api/webhooks/paystack', handlePaystackWebhook);