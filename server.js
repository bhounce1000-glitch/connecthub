require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

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
const PUBLIC_SERVER_BASE_URL = process.env.BACKEND_PUBLIC_URL || `http://192.168.1.194:${PORT}`;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.EXPO_PUBLIC_ADMIN_EMAILS || 'bhounce1000@gmail.com')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || '';

app.use(cors());
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
    console.log('AUDIT LOG ERROR:', error.message || error);
  }
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
}

function requireAdmin(req, res, next) {
  const user = req.user || {};
  const email = user.email || '';
  const hasAdminClaim = user.admin === true || user.role === 'admin';

  if (!hasAdminClaim && !isAdminEmail(email)) {
    return res.status(403).json({ error: 'Admin access required' });
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
    return;
  }

  const requestRef = adminDb.collection('requests').doc(requestId);
  const existingSnapshot = await requestRef.get();
  const beforeData = existingSnapshot.exists ? existingSnapshot.data() : null;
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
}

// ✅ HEALTH CHECK
app.get('/', (req, res) => {
  res.send('Server is working ✅');
});

// ✅ PAYSTACK INIT
app.post('/pay', async (req, res) => {
  try {
    const { email, amount, requestId } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amount * 100,
        callback_url: `${CALLBACK_BASE_URL}/pay-return?id=${encodeURIComponent(requestId)}`,
        metadata: { requestId },
      }),
    });

    const data = await response.json();

    console.log("PAYSTACK RESPONSE:", data);

    return res.status(response.status).json(data);

  } catch (error) {
    console.log("SERVER ERROR:", error);
    return res.status(500).json({ error: 'Payment init failed' });
  }
});

app.post('/pay/verify', async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ error: 'Missing reference' });
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    console.log('PAYSTACK VERIFY RESPONSE:', data);

    if (data?.status && data?.data?.status === 'success') {
      await markRequestPaid(data?.data?.metadata?.requestId, data?.data?.reference, {
        paymentChannel: data?.data?.channel || null,
        gatewayResponse: data?.data?.gateway_response || null,
      });
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.log('VERIFY ERROR:', error);
    return res.status(500).json({ error: 'Payment verification failed' });
  }
});

app.post('/paystack/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const expectedSignature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    console.log('PAYSTACK WEBHOOK:', event?.event, event?.data?.reference || null);

    if (event?.event === 'charge.success' && event?.data?.status === 'success') {
      await markRequestPaid(event?.data?.metadata?.requestId, event?.data?.reference, {
        paymentChannel: event?.data?.channel || null,
        gatewayResponse: event?.data?.gateway_response || null,
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.log('WEBHOOK ERROR:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ✅ START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on ${PUBLIC_SERVER_BASE_URL}`);
});

app.post('/admin/sync-claims', requireAdminOrBootstrapSecret, async (req, res) => {
  try {
    const requestedEmails = Array.isArray(req.body?.emails) ? req.body.emails : ADMIN_EMAILS;
    const targetEmails = requestedEmails.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);

    if (!targetEmails.length) {
      return res.status(400).json({ error: 'No target emails provided' });
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

    return res.status(200).json({
      status: true,
      message: 'Claim sync completed',
      results,
    });
  } catch (error) {
    console.log('ADMIN CLAIM SYNC ERROR:', error);
    return res.status(500).json({ error: 'Admin claim sync failed' });
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

    return res.status(200).json({ status: true, data: logs });
  } catch (error) {
    console.log('ADMIN AUDIT READ ERROR:', error);
    return res.status(500).json({ error: 'Could not read audit logs' });
  }
});

app.post('/admin/requests/:id/moderate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status, note } = req.body || {};

    const allowedStatuses = ['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled'];

    if (!requestId) {
      return res.status(400).json({ error: 'Missing request id' });
    }

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status transition target' });
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const existingSnapshot = await requestRef.get();

    if (!existingSnapshot.exists) {
      return res.status(404).json({ error: 'Request not found' });
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

    return res.status(200).json({
      status: true,
      message: 'Request moderated successfully',
      data: { id: requestId, ...patch },
    });
  } catch (error) {
    console.log('ADMIN MODERATION ERROR:', error);
    return res.status(500).json({ error: 'Moderation failed' });
  }
});

app.delete('/admin/requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;

    if (!requestId) {
      return res.status(400).json({ error: 'Missing request id' });
    }

    const requestRef = adminDb.collection('requests').doc(requestId);
    const existingSnapshot = await requestRef.get();

    if (!existingSnapshot.exists) {
      return res.status(404).json({ error: 'Request not found' });
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

    return res.status(200).json({
      status: true,
      message: 'Request deleted successfully',
      data: { id: requestId },
    });
  } catch (error) {
    console.log('ADMIN DELETE ERROR:', error);
    return res.status(500).json({ error: 'Delete failed' });
  }
});