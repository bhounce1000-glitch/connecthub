/* eslint-disable no-console */

async function run() {
  const baseUrl = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/$/, '');
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const limit = Number(process.env.WITHDRAWAL_AUTO_RETRY_BATCH_LIMIT || 10);

  if (!baseUrl) {
    throw new Error('Missing BACKEND_PUBLIC_URL');
  }

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET');
  }

  const url = `${baseUrl}/admin/withdrawals/auto-retry-queued`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': cronSecret,
    },
    body: JSON.stringify({ limit }),
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!response.ok || !payload?.status) {
    const message = payload?.message || `HTTP ${response.status}`;
    throw new Error(`Auto-retry queued withdrawals failed: ${message}`);
  }

  console.log('Auto-retry queued withdrawals completed', {
    attempted: payload.attempted || 0,
    successCount: payload.successCount || 0,
    failedCount: payload.failedCount || 0,
  });
}

run().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
