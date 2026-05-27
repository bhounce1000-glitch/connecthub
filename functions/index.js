const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const SYSTEM_API_TOKEN = defineSecret('SYSTEM_API_TOKEN');
const BACKEND_URL = defineSecret('BACKEND_URL');

exports.pushOnNotificationCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const data = event.data?.data() || {};
  const recipientId = String(data.recipientId || data.userId || data.user || '').trim().toLowerCase();
  const title = String(data.title || 'ConnectHub').trim() || 'ConnectHub';
  const body = String(data.body || data.text || '').trim();

  if (!recipientId || !body) return;

  const userSnap = await db.collection('users').doc(recipientId).get();
  if (!userSnap.exists) return;

  const userData = userSnap.data() || {};
  const fcmToken = String(userData.fcmToken || '').trim();
  if (!fcmToken) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: {
        type: String(data.type || 'system'),
        jobId: String(data.jobId || ''),
      },
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('registration-token-not-registered') || message.includes('invalid-registration-token')) {
      await db.collection('users').doc(recipientId).set({ fcmToken: admin.firestore.FieldValue.delete() }, { merge: true });
    }
  }
});

exports.autoConfirmDoneJobs = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Africa/Accra',
    secrets: [SYSTEM_API_TOKEN, BACKEND_URL],
  },
  async () => {
    const now = Date.now();
    const cutoff = now - (48 * 60 * 60 * 1000);
    const doneJobs = await db.collection('requests').where('status', '==', 'pending_confirmation').limit(200).get();

    const backendUrl = BACKEND_URL.value();
    const token = SYSTEM_API_TOKEN.value();
    if (!backendUrl || !token) return;

    for (const docSnap of doneJobs.docs) {
      const row = docSnap.data() || {};
      const completedAtRaw = row.completedAt;
      let completedAtMs = 0;
      if (completedAtRaw?.toDate) completedAtMs = completedAtRaw.toDate().getTime();
      else completedAtMs = new Date(completedAtRaw || 0).getTime();

      if (!Number.isFinite(completedAtMs) || completedAtMs <= 0 || completedAtMs > cutoff) {
        continue;
      }

      await fetch(`${backendUrl}/api/payments/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId: docSnap.id, triggeredBy: 'auto_confirm' }),
      }).catch(() => {});

      const customerId = String(row.user || '').trim().toLowerCase();
      const providerId = String(row.acceptedBy || '').trim().toLowerCase();

      const notifications = [];
      if (customerId) {
        notifications.push(db.collection('notifications').add({
          recipientId: customerId,
          type: 'auto_confirmed',
          title: 'Job Auto-Confirmed',
          body: 'Your job was auto-confirmed after 48 hours and escrow was released.',
          jobId: docSnap.id,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          user: customerId,
          userId: customerId,
        }));
      }
      if (providerId) {
        notifications.push(db.collection('notifications').add({
          recipientId: providerId,
          type: 'auto_confirmed',
          title: 'Job Auto-Confirmed',
          body: 'Customer confirmation window elapsed; payout has been released.',
          jobId: docSnap.id,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          user: providerId,
          userId: providerId,
        }));
      }
      await Promise.all(notifications);
    }
  }
);

/**
 * Wallet API proxy — forwards /api/wallet/* to the Render backend.
 * Runs same-origin from Firebase Hosting so no CORS or browser-extension blocking.
 */
const RENDER_BACKEND = 'https://connecthub-yrox.onrender.com';
exports.walletProxy = onRequest(
  {
    cors: [
      'https://connecthub-1873e.web.app',
      'https://connecthub-1873e.firebaseapp.com',
      'http://localhost:8081',
      'http://localhost:19006',
    ],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    // Strip /api prefix: /api/wallet/topup/init -> /wallet/topup/init
    const targetPath = req.path.replace(/^\/api/, '') || '/';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }

      const fetchOptions = {
        method: req.method,
        headers,
      };
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const upstream = await fetch(`${RENDER_BACKEND}${targetPath}`, fetchOptions);
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      res.status(502).json({ status: false, error: 'proxy_error', message: err.message });
    }
  }
);
