/* eslint-disable no-console */
require('dotenv').config();

const admin = require('firebase-admin');

function parseMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, parseFloat(amount.toFixed(2)));
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return require('../serviceAccountKey.json');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  }

  const db = admin.firestore();
  const statuses = ['done', 'confirmed', 'completed', 'paid', 'pending_confirmation'];
  const snapshot = await db.collection('requests').where('status', 'in', statuses).get();

  const candidates = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((row) => {
      if (!row.acceptedBy) return false;
      if (row.payoutCredited === true) return false;
      if (!row.escrowFunded || row.payment_received !== true) return false;
      if (!row.paymentReference || String(row.paymentStatus || '').toLowerCase() !== 'success') return false;
      return true;
    });

  console.log(`Found ${candidates.length} stuck candidate jobs.`);

  let fixed = 0;
  let skipped = 0;

  for (const row of candidates) {
    const requestRef = db.collection('requests').doc(row.id);
    const payoutRef = db.collection('request_payouts').doc(row.id);
    const providerEmail = String(row.acceptedBy || '').trim().toLowerCase();
    const requestPrice = parseMoney(row.price);
    const commission = parseMoney(row.commission || (requestPrice * 0.1));
    const providerNet = parseMoney(row.providerNet || row.providerPayout || (requestPrice - commission));

    if (!providerEmail || providerNet <= 0) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would release ${row.id} => ${providerEmail} GHS ${providerNet.toFixed(2)}`);
      fixed += 1;
      continue;
    }

    let applied = false;
    await db.runTransaction(async (tx) => {
      const [requestSnap, payoutSnap] = await Promise.all([tx.get(requestRef), tx.get(payoutRef)]);
      if (!requestSnap.exists) return;
      if (payoutSnap.exists && payoutSnap.data()?.credited === true) return;

      const current = requestSnap.data() || {};
      const nowIso = new Date().toISOString();
      const providerRef = db.collection('users').doc(providerEmail);

      tx.set(providerRef, {
        walletBalance: admin.firestore.FieldValue.increment(providerNet),
        updatedAt: nowIso,
      }, { merge: true });

      tx.set(requestRef, {
        status: 'paid',
        paid: true,
        paidAt: current.paidAt || nowIso,
        payoutCredited: true,
        payment_released: true,
        payoutCreditedAt: nowIso,
        payoutCreditReason: 'manual_admin_release',
        completionMode: 'manual_admin_release',
        completionResolutionReason: 'manual_admin_release',
        escrowStatus: 'released',
      }, { merge: true });

      tx.set(payoutRef, {
        requestId: row.id,
        providerEmail,
        amount: providerNet,
        commission,
        paymentReference: current.paymentReference || `manual_fix_${row.id}_${Date.now()}`,
        source: 'manual_admin_release',
        credited: true,
        creditedAt: nowIso,
      }, { merge: true });

      applied = true;
    });

    if (applied) {
      fixed += 1;
      await db.collection('request_status_logs').add({
        user_id: row.user || null,
        job_id: row.id,
        old_status: String(row.status || 'unknown').toLowerCase(),
        new_status: 'paid',
        timestamp: new Date().toISOString(),
        triggered_by: 'manual',
        actor_email: 'manual_admin_release',
        reason: 'manual_admin_release',
      });
      console.log(`Fixed ${row.id}: credited ${providerEmail} GHS ${providerNet.toFixed(2)}`);
    } else {
      skipped += 1;
    }
  }

  console.log(`Done. fixed=${fixed}, skipped=${skipped}, dryRun=${dryRun}`);
}

main().catch((error) => {
  console.error('fix-stuck-job-payments failed:', error?.message || error);
  process.exitCode = 1;
});
