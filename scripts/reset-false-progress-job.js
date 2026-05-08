/* eslint-disable no-console */
require('dotenv').config();

const admin = require('firebase-admin');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return require('../serviceAccountKey.json');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const title = 'Deep clean 2-bedroom apartment';
  const customerEmail = 'testcustomer0429@mailinator.com';
  const providerEmail = 'bhounce1000@gmail.com';

  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  }

  const db = admin.firestore();
  const querySnap = await db.collection('requests')
    .where('title', '==', title)
    .where('user', '==', customerEmail)
    .where('acceptedBy', '==', providerEmail)
    .get();

  if (querySnap.empty) {
    console.log('No matching request found.');
    return;
  }

  for (const docSnap of querySnap.docs) {
    const data = docSnap.data() || {};
    const patch = {
      status: 'pending_confirmation',
      paid: false,
      payment_received: false,
      work_started: false,
      work_completed: false,
      customer_confirmed: false,
      payment_released: false,
      escrowFunded: false,
      escrowStatus: 'awaiting_payment',
      paymentReference: null,
      paymentStatus: null,
      paymentChannel: null,
      gatewayResponse: null,
      paidAt: null,
      payoutCredited: false,
      payoutCreditedAt: null,
      payoutCreditReason: null,
      providerPayout: null,
      providerNet: null,
      commission: null,
      completionMode: null,
      completionResolutionReason: null,
      completionResolvedAt: null,
      updatedAt: new Date().toISOString(),
    };

    if (dryRun) {
      console.log(`[DRY RUN] Would reset request ${docSnap.id}`);
      continue;
    }

    await docSnap.ref.set(patch, { merge: true });

    await db.collection('request_status_attempts').add({
      job_id: docSnap.id,
      attempted_by: 'ops-reset-script',
      from_status: String(data.status || 'unknown').toLowerCase(),
      to_status: 'pending_confirmation',
      timestamp: new Date().toISOString(),
      success: true,
      reason: 'manual_false_progression_reset',
      source: 'script_reset_false_progress',
    });

    await db.collection('request_status_logs').add({
      user_id: customerEmail,
      job_id: docSnap.id,
      old_status: String(data.status || 'unknown').toLowerCase(),
      new_status: 'pending_confirmation',
      timestamp: new Date().toISOString(),
      triggered_by: 'manual',
      actor_email: 'ops-reset-script',
      reason: 'manual_false_progression_reset',
    });

    const payoutRef = db.collection('request_payouts').doc(docSnap.id);
    await payoutRef.set({
      credited: false,
      updatedAt: new Date().toISOString(),
      source: 'manual_false_progression_reset',
    }, { merge: true });

    console.log(`Reset request ${docSnap.id} to pending_confirmation with all lifecycle flags cleared.`);
  }
}

main().catch((error) => {
  console.error('reset-false-progress-job failed:', error?.message || error);
  process.exitCode = 1;
});
