/* eslint-disable no-console */

async function run() {
  const baseUrl = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/$/, '');
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const limit = Number(process.env.WITHDRAWAL_POLL_BATCH_LIMIT || 15);

  if (!baseUrl) {
    throw new Error('Missing BACKEND_PUBLIC_URL');
  }

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET');
  }

  const url = `${baseUrl}/admin/withdrawals/poll-transfer-status`;
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
    throw new Error(`Poll transfer status failed: ${message}`);
  }

  console.log('Poll transfer status completed', {
    polled: payload.polled || 0,
    completedFromPolling: payload.completedFromPolling || 0,
    alreadyCompleted: payload.alreadyCompleted || 0,
    stillPending: payload.stillPending || 0,
    errors: payload.errors || 0,
  });
}

run().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
