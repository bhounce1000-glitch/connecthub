require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const pino = require('pino');

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
  serviceAccount = require('./serviceAccountKey.json.json');
}

const app = express();
const PORT = process.env.PORT || 3001;
const CALLBACK_BASE_URL = process.env.PAYSTACK_CALLBACK_BASE_URL || 'http://localhost:8081';
const PUBLIC_SERVER_BASE_URL = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;
const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL || 'http://localhost:8081';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || `${WEB_BASE_URL},${CALLBACK_BASE_URL}`)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.EXPO_PUBLIC_ADMIN_EMAILS || 'bhounce1000@gmail.com')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || '';

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
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  },
}));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const adminDb = admin.firestore();

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
  try {
    await adminDb.collection('notifications').add({
      user: userEmail,
      text,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, 'NOTIFICATION_WRITE_ERROR');
  }
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

  const payload = {
    paid: true,
    status: 'paid',
    paymentReference,
    paymentStatus: 'success',
    paidAt: new Date().toISOString(),
    ...extraFields,
  };

  await requestRef.set(payload, { merge: true });

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

// ✅ HEALTH CHECK
app.get('/', (req, res) => {
  return sendSuccess(res, req, {
    message: 'Server is working',
    uptimeSeconds: Math.round(process.uptime()),
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

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(normalizedAmount * 100),
        callback_url: `${NORMALIZED_CALLBACK_BASE_URL}/pay-return?id=${encodeURIComponent(requestId)}`,
        metadata: { requestId },
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
      paymentUpdate = await markRequestPaid(data?.data?.metadata?.requestId, data?.data?.reference, {
        paymentChannel: data?.data?.channel || null,
        gatewayResponse: data?.data?.gateway_response || null,
      });

      if (!paymentUpdate.updated) {
        logger.warn({ paymentUpdate }, 'PAYMENT_UPDATE_SKIPPED');
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
      const paymentUpdate = await markRequestPaid(event?.data?.metadata?.requestId, event?.data?.reference, {
        paymentChannel: event?.data?.channel || null,
        gatewayResponse: event?.data?.gateway_response || null,
        source: 'paystack_webhook',
      });

      if (!paymentUpdate.updated) {
        logger.warn({ paymentUpdate }, 'WEBHOOK_PAYMENT_UPDATE_SKIPPED');
      }
    }

    return sendSuccess(res, req, { received: true });
  } catch (error) {
    logger.error({ err: error }, 'WEBHOOK_ERROR');
    return sendError(res, req, 500, 'webhook_processing_failed', 'Webhook processing failed');
  }
});

// ✅ START SERVER
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ url: PUBLIC_SERVER_BASE_URL, allowedOrigins: Array.from(allowedOriginSet) }, 'SERVER_STARTED');
});

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

app.post('/admin/requests/:id/moderate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status, note } = req.body || {};

    const allowedStatuses = ['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled'];

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
    }

    if (status === 'paid') {
      patch.paid = true;
      patch.paidAt = new Date().toISOString();
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
    await requestRef.delete();

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_delete_request',
      requestId,
      before: beforeData,
      after: null,
      metadata: {
        reason: req.body?.reason || null,
      },
    });

    return sendSuccess(res, req, {
      message: 'Request deleted successfully',
      data: { id: requestId },
    });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_DELETE_ERROR');
    return sendError(res, req, 500, 'admin_delete_failed', 'Delete failed');
  }
});