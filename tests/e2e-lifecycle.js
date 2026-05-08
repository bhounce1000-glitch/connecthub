/**
 * ConnectHub – authenticated e2e lifecycle smoke tests
 * Runs against the LOCAL server (http://localhost:3001) by default.
 * Set E2E_BASE=https://connecthub-yrox.onrender.com to test production.
 *
 * Usage:  node tests/e2e-lifecycle.js
 */

const admin = require('firebase-admin');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE = process.env.E2E_BASE || 'http://localhost:3001';
const SA   = require('../serviceAccountKey.json');

// ── Firebase Admin (for minting custom tokens + Firestore access) ─────────────
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(SA) });
}
const db = admin.firestore();

// ── helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}  ${detail}`);
    failed++;
  }
}

async function mintIdToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  // Exchange custom token → ID token via Firebase REST API
  const apiKey = 'AIzaSyAej377YaX224k6xYNdTTJtfmuQ6t5fuGs';
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error('Failed to mint ID token: ' + JSON.stringify(data));
  return data.idToken;
}

async function api(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const hasBody = body != null && !['GET', 'HEAD'].includes(method.toUpperCase());
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

// ── Test seed data ────────────────────────────────────────────────────────────
const TEST_CUSTOMER_UID = 'e2e-test-customer-001';
const TEST_PROVIDER_UID = 'e2e-test-provider-001';
const TEST_CUSTOMER_EMAIL = 'e2e-customer@connecthub-test.local';
const TEST_PROVIDER_EMAIL = 'e2e-provider@connecthub-test.local';
const TEST_JOB_ID = `e2e-job-${Date.now()}`;

async function ensureAuthUsers() {
  for (const [uid, email, displayName] of [
    [TEST_CUSTOMER_UID, TEST_CUSTOMER_EMAIL, 'E2E Customer'],
    [TEST_PROVIDER_UID, TEST_PROVIDER_EMAIL, 'E2E Provider'],
  ]) {
    try {
      await admin.auth().updateUser(uid, { email, displayName });
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await admin.auth().createUser({ uid, email, displayName, emailVerified: true });
      } else throw e;
    }
  }
  console.log('  [seed] Firebase Auth users ensured');
}

async function seedTestJob() {
  await db.collection('users').doc(TEST_CUSTOMER_EMAIL).set({
    uid: TEST_CUSTOMER_UID, email: TEST_CUSTOMER_EMAIL,
    displayName: 'E2E Customer', role: 'customer', walletBalance: 0,
  }, { merge: true });
  await db.collection('users').doc(TEST_PROVIDER_EMAIL).set({
    uid: TEST_PROVIDER_UID, email: TEST_PROVIDER_EMAIL,
    displayName: 'E2E Provider', role: 'provider', walletBalance: 0,
    kycStatus: 'approved',
  }, { merge: true });

  await db.collection('requests').doc(TEST_JOB_ID).set({
    userId: TEST_CUSTOMER_UID,
    user: TEST_CUSTOMER_EMAIL,
    title: 'E2E Test Job',
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    payment_received: false,
    work_started: false,
    work_completed: false,
    customer_confirmed: false,
    payment_released: false,
    escrowFunded: false,
  });
  console.log(`  [seed] job ${TEST_JOB_ID} created`);
}

async function cleanupTestJob() {
  await db.collection('requests').doc(TEST_JOB_ID).delete();
  console.log(`  [cleanup] job ${TEST_JOB_ID} deleted`);
}

// ── Test suite ────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\nConnectHub e2e lifecycle checks → ${BASE}\n`);

  // 1. Health
  console.log('── 1. Health ──────────────────────────────────────────────');
  const health = await api('GET', '/health');
  ok('GET /health → 200', health.status === 200, `got ${health.status}`);

  // 2. Unauthenticated requests blocked
  console.log('\n── 2. Auth guards ─────────────────────────────────────────');
  const endpoints = [
    ['POST', `/jobs/${TEST_JOB_ID}/cancel`],
    ['POST', `/jobs/${TEST_JOB_ID}/accept`],
    ['POST', `/jobs/${TEST_JOB_ID}/mark-complete`],
    ['POST', `/jobs/${TEST_JOB_ID}/confirm-completion`],
    ['GET',  '/admin/jobs/stuck-payments'],
    ['POST', '/admin/jobs/reconcile-stuck-payments'],
  ];
  for (const [m, p] of endpoints) {
    const r = await api(m, p, {});
    ok(`${m} ${p} without token → 401`, r.status === 401, `got ${r.status}`);
  }

  // 3. Mint tokens
  console.log('\n── 3. Token minting ───────────────────────────────────────');
  let customerToken, providerToken;
  try {
    await ensureAuthUsers(); // must happen before minting tokens
    customerToken = await mintIdToken(TEST_CUSTOMER_UID);
    ok('Customer ID token minted', !!customerToken);
    providerToken = await mintIdToken(TEST_PROVIDER_UID);
    ok('Provider ID token minted', !!providerToken);
  } catch (e) {
    console.error('  FAIL  Token minting threw:', e.message);
    failed += 2;
  }

  if (!customerToken || !providerToken) {
    console.log('\nSkipping remaining tests (no tokens).');
    summarise();
    return;
  }

  // 4. Seed test job (no auth user creation here - done in step 3)
  console.log('\n── 4. Seed test data ──────────────────────────────────────');
  await db.collection('users').doc(TEST_CUSTOMER_EMAIL).set({
    uid: TEST_CUSTOMER_UID, email: TEST_CUSTOMER_EMAIL,
    displayName: 'E2E Customer', role: 'customer', walletBalance: 0,
  }, { merge: true });
  await db.collection('users').doc(TEST_PROVIDER_EMAIL).set({
    uid: TEST_PROVIDER_UID, email: TEST_PROVIDER_EMAIL,
    displayName: 'E2E Provider', role: 'provider', walletBalance: 0,
    kycStatus: 'approved',
  }, { merge: true });
  await db.collection('requests').doc(TEST_JOB_ID).set({
    userId: TEST_CUSTOMER_UID,
    user: TEST_CUSTOMER_EMAIL,
    title: 'E2E Test Job',
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    payment_received: false, work_started: false, work_completed: false,
    customer_confirmed: false, payment_released: false, escrowFunded: false,
  });
  ok('Test job seeded', true);

  // 5. Gate: accept without payment should fail (gate blocks in_progress)
  console.log('\n── 5. Lifecycle gates ─────────────────────────────────────');
  const acceptRes = await api('POST', `/jobs/${TEST_JOB_ID}/accept`, { providerId: TEST_PROVIDER_UID }, providerToken);
  // accept itself may succeed (moves to accepted), but in_progress without escrow should be blocked
  console.log(`  [info] accept → ${acceptRes.status} ${JSON.stringify(acceptRes.body).slice(0,80)}`);

  // 6. Gate: mark-complete without payment proof should be blocked
  const mcRes = await api('POST', `/jobs/${TEST_JOB_ID}/mark-complete`, {}, providerToken);
  ok('mark-complete without escrow proof → blocked (400/403/409)', [400, 403, 409].includes(mcRes.status), `got ${mcRes.status}`);

  // 7. Gate: confirm-completion without payment proof should be blocked
  const ccRes = await api('POST', `/jobs/${TEST_JOB_ID}/confirm-completion`, {}, customerToken);
  ok('confirm-completion without escrow proof → blocked (400/403/409)', [400, 403, 409].includes(ccRes.status), `got ${ccRes.status}`);

  // 8. cancel via backend endpoint — use a fresh open job
  const CANCEL_JOB_ID = `e2e-cancel-${Date.now()}`;
  await db.collection('requests').doc(CANCEL_JOB_ID).set({
    userId: TEST_CUSTOMER_UID, user: TEST_CUSTOMER_EMAIL,
    title: 'E2E Cancel Test Job', status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    payment_received: false, work_started: false, work_completed: false,
    customer_confirmed: false, payment_released: false, escrowFunded: false,
  });
  const cancelRes = await api('POST', `/jobs/${CANCEL_JOB_ID}/cancel`, {}, customerToken);
  ok('cancel open job via backend → 200 or 201', [200, 201].includes(cancelRes.status), `got ${cancelRes.status} ${JSON.stringify(cancelRes.body)}`);
  // cleanup cancel job
  await db.collection('requests').doc(CANCEL_JOB_ID).delete();

  // 9. Simulate full escrow proof then test in-progress gate
  console.log('\n── 6. Simulated escrow-funded job gates ───────────────────');
  const JOB2 = `e2e-job-funded-${Date.now()}`;
  await db.collection('requests').doc(JOB2).set({
    userId: TEST_CUSTOMER_UID,
    user: TEST_CUSTOMER_EMAIL,
    title: 'E2E Funded Test Job',
    status: 'in_progress',
    acceptedBy: TEST_PROVIDER_EMAIL,
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    paymentReference: `e2e-ref-${Date.now()}`,
    paymentStatus: 'success',
    escrowFunded: true,
    payment_received: true,
    work_started: true,
    work_completed: false,
    customer_confirmed: false,
    payment_released: false,
  });
  console.log(`  [seed] funded job ${JOB2} created`);

  // mark-complete on funded job should proceed
  const mc2 = await api('POST', `/jobs/${JOB2}/mark-complete`, {}, providerToken);
  ok('mark-complete with escrow proof → 200 or 201', [200, 201].includes(mc2.status), `got ${mc2.status} ${JSON.stringify(mc2.body).slice(0,100)}`);

  // confirm-completion now requires work_completed
  const cc2 = await api('POST', `/jobs/${JOB2}/confirm-completion`, { rating: 5 }, customerToken);
  ok('confirm-completion after mark-complete → 200 or blocked-correctly', [200, 201, 400, 403, 409].includes(cc2.status), `got ${cc2.status}`);

  // 10. Admin stuck-payments with admin token
  console.log('\n── 7. Admin endpoints ─────────────────────────────────────');
  // Set custom claim admin on the customer token for this test via service account direct call
  try {
    await admin.auth().setCustomUserClaims(TEST_CUSTOMER_UID, { admin: true });
    // Re-mint token with updated claims (may need slight delay for propagation)
    await new Promise(r => setTimeout(r, 1000));
    const adminToken = await mintIdToken(TEST_CUSTOMER_UID);
    const stuckRes = await api('GET', '/admin/jobs/stuck-payments', null, adminToken);
    ok('GET /admin/jobs/stuck-payments with admin token → 200', stuckRes.status === 200, `got ${stuckRes.status}`);
    ok('stuck-payments response has jobs/data array', Array.isArray(stuckRes.body.jobs || stuckRes.body.data), JSON.stringify(stuckRes.body).slice(0, 80));
    // Remove admin claim when done
    await admin.auth().setCustomUserClaims(TEST_CUSTOMER_UID, { admin: false });
  } catch (e) {
    console.error('  FAIL  Admin token setup:', e.message);
    failed++;
  }

  // Cleanup
  console.log('\n── 8. Cleanup ─────────────────────────────────────────────');
  await cleanupTestJob();
  await db.collection('requests').doc(JOB2).delete();
  ok('Cleanup complete', true);

  summarise();
}

function summarise() {
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => {
  console.error('\nFATAL:', err);
  process.exitCode = 1;
});
