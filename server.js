require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const pino = require('pino');
const { sendPaymentReceiptEmail, sendKycSubmissionEmail, sendKycApprovalEmail, sendKycRejectionEmail } = require('./src/server/email');

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

async function sendPushNotification(token, title, body) {
  if (!token || !title || !body) {
    return;
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        sound: 'default',
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

async function notifyUser(userEmail, text, pushTitle = 'ConnectHub') {
  if (!userEmail || !text) return;

  await writeNotification(userEmail, text);
  const pushToken = await getPushTokenForUser(userEmail);
  if (pushToken) {
    await sendPushNotification(pushToken, pushTitle, text);
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

  const requestPrice = Number(beforeData?.price || 0);
  const commission = parseFloat((requestPrice * COMMISSION_RATE).toFixed(2));
  const providerNet = parseFloat((requestPrice * (1 - COMMISSION_RATE)).toFixed(2));

  const payload = {
    paid: true,
    status: 'paid',
    paymentReference,
    paymentStatus: 'success',
    paidAt: new Date().toISOString(),
    commission,
    providerNet,
    commissionRate: COMMISSION_RATE,
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

function parseMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, parseFloat(amount.toFixed(2)));
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
              timestamp: request.paidAt || new Date().toISOString(),
              status: request.paymentStatus ? request.paymentStatus.toUpperCase() : 'SUCCESS',
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
    };

    await requestRef.set(patch, { merge: true });

    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `${actorEmail} accepted your request "${beforeData.title || requestId}".`,
        'Job Accepted'
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

    if (!['accepted', 'in_progress'].includes(beforeData.status)) {
      return sendError(res, req, 409, 'invalid_status_transition', 'Job must be accepted or in progress to mark complete');
    }

    const patch = {
      status: 'pending_confirmation',
      completedAt: new Date().toISOString(),
    };

    await requestRef.set(patch, { merge: true });

    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Your service provider marked "${beforeData.title || requestId}" as done. Please review and confirm completion.`,
        'Work Marked Complete'
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

    const escrowReference = `escrow_release_${requestId}_${Date.now()}`;
    const paymentUpdate = await markRequestPaid(requestId, escrowReference, {
      paymentChannel: 'escrow_release',
      gatewayResponse: 'Escrow released after customer confirmation',
      source: 'customer_confirmation',
    });

    if (!paymentUpdate.updated) {
      return sendError(res, req, 409, 'payment_release_failed', 'Could not release escrow payment', paymentUpdate);
    }

    if (beforeData.acceptedBy) {
      await notifyUser(
        beforeData.acceptedBy,
        `Job "${beforeData.title || requestId}" was confirmed by the customer and paid successfully.`,
        'Job Confirmed and Paid'
      );
    }
    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Job "${beforeData.title || requestId}" completed successfully. Payment has been released.`,
        'Payment Released'
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
        'Dispute Opened'
      );
    }
    if (beforeData.user) {
      await notifyUser(
        beforeData.user,
        `Your dispute for "${beforeData.title || requestId}" has been submitted for admin review.`,
        'Dispute Submitted'
      );
    }
    for (const adminEmail of ADMIN_EMAILS) {
      await notifyUser(adminEmail, `New dispute requires review: "${beforeData.title || requestId}".`, 'Dispute Requires Review');
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

    await notifyUser(
      targetEmail,
      'Your identity verification has been approved. You can now access all ConnectHub features.',
      'KYC Approved'
    );

    const approvedUser = await adminDb.collection('users').doc(targetEmail).get();
    const approvedName = approvedUser.exists ? (approvedUser.data()?.name || targetEmail) : targetEmail;
    await sendKycApprovalEmail({ email: targetEmail, name: approvedName }).catch((err) => {
      logger.warn({ err, targetEmail }, 'KYC_APPROVAL_EMAIL_FAILED');
    });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_kyc_approved',
      metadata: { targetEmail },
    });

    return sendSuccess(res, req, { message: 'KYC approved', email: targetEmail });
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

    await notifyUser(
      targetEmail,
      `Your identity verification was not approved. Reason: ${reason}. Please resubmit with correct documents.`,
      'KYC Rejected'
    );

    const rejectedUser = await adminDb.collection('users').doc(targetEmail).get();
    const rejectedName = rejectedUser.exists ? (rejectedUser.data()?.name || targetEmail) : targetEmail;
    await sendKycRejectionEmail({ email: targetEmail, name: rejectedName, reason }).catch((err) => {
      logger.warn({ err, targetEmail }, 'KYC_REJECTION_EMAIL_FAILED');
    });

    await writeAuditLog({
      actorEmail: req.user?.email || null,
      actorUid: req.user?.uid || null,
      eventType: 'admin_kyc_rejected',
      metadata: { targetEmail, reason },
    });

    return sendSuccess(res, req, { message: 'KYC rejected', email: targetEmail });
  } catch (error) {
    logger.error({ err: error }, 'ADMIN_KYC_REJECT_ERROR');
    return sendError(res, req, 500, 'admin_kyc_reject_failed', 'KYC rejection failed');
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

    let providerPayout = 0;
    let customerRefund = 0;
    let nextStatus = beforeRequest.status || 'disputed';
    let paid = false;

    if (resolution === 'release_to_worker') {
      providerPayout = requestPrice;
      customerRefund = 0;
      nextStatus = 'paid';
      paid = true;
    } else if (resolution === 'refund_customer') {
      providerPayout = 0;
      customerRefund = requestPrice;
      nextStatus = 'cancelled';
      paid = false;
    } else {
      providerPayout = parseFloat((requestPrice * (splitPercentToWorker / 100)).toFixed(2));
      customerRefund = parseFloat((requestPrice - providerPayout).toFixed(2));
      nextStatus = 'paid';
      paid = true;
    }

    const paymentReference = `dispute_${resolution}_${requestId}_${Date.now()}`;
    const requestPatch = {
      status: nextStatus,
      paid,
      paidAt: paid ? now : null,
      paymentHold: false,
      disputeResolvedAt: now,
      disputeResolvedBy: req.user?.email || null,
      disputeResolution: resolution,
      disputeResolutionNote: resolutionNote || null,
      providerPayout,
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
      },
    });

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