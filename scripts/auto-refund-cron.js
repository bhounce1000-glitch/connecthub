/* eslint-disable no-console */

async function run() {
  const baseUrl = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/$/, '');
  const cronSecret = String(process.env.CRON_SECRET || '').trim();

  if (!baseUrl) {
    throw new Error('Missing BACKEND_PUBLIC_URL');
  }

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET');
  }

  const url = `${baseUrl}/admin/withdrawals/auto-refund-overdue`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': cronSecret,
    },
    body: JSON.stringify({}),
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
    throw new Error(`Auto-refund failed: ${message}`);
  }

  console.log('Auto-refund completed', {
    refunded: payload.refunded || 0,
    skipped: payload.skipped || 0,
    errors: payload.errors || 0,
  });
}

run().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
