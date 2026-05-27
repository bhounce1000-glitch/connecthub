'use strict';
const { onRequest } = require('firebase-functions/v2/https');

const RENDER_BACKEND = 'https://connecthub-yrox.onrender.com';

/**
 * Wallet API proxy — forwards /api/wallet/* to the Render backend.
 * Deployed via Firebase Hosting rewrite so the browser makes a same-origin request
 * to connecthub-1873e.web.app/api/... — no CORS, no extension blocking.
 */
exports.walletProxy = onRequest(
  {
    invoker: 'public',
    cors: [
      'https://connecthub-1873e.web.app',
      'https://connecthub-1873e.firebaseapp.com',
      'http://localhost:8081',
      'http://localhost:19006',
    ],
    timeoutSeconds: 60,
    region: 'us-central1',
  },
  async (req, res) => {
    // Firebase Hosting passes the full path, e.g. /api/wallet/topup/init
    // Strip /api prefix before forwarding to Render
    const targetPath = req.path.replace(/^\/api/, '') || '/';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }

      const fetchOptions = { method: req.method, headers };
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
