/* eslint-disable no-console */
require('dotenv').config();

const admin = require('firebase-admin');

const VALID_KYC_STATUSES = new Set([
  'pending_verification',
  'verified',
  'rejected',
  'not_submitted',
]);

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_KYC_STATUSES.has(normalized) ? normalized : '';
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  return require('../serviceAccountKey.json');
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    includeMissingUsers: args.has('--include-missing-users'),
    autoRepairBlankStatus: args.has('--auto-repair-blank-status'),
    deleteMalformed: args.has('--delete-malformed'),
  };
}

async function main() {
  const {
    dryRun,
    includeMissingUsers,
    autoRepairBlankStatus,
    deleteMalformed,
  } = parseArgs(process.argv);
  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  }

  const db = admin.firestore();
  const now = new Date().toISOString();

  console.log('Starting KYC status sync migration...');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`);
  console.log(`Include missing users: ${includeMissingUsers ? 'yes' : 'no'}`);
  console.log(`Auto repair blank status: ${autoRepairBlankStatus ? 'yes' : 'no'}`);
  console.log(`Delete malformed docs: ${deleteMalformed ? 'yes' : 'no'}`);

  const submissionsSnap = await db.collection('kyc_submissions').get();
  console.log(`Found ${submissionsSnap.size} kyc_submissions documents.`);

  let inspected = 0;
  let missingEmail = 0;
  let unknownStatus = 0;
  const unknownStatusRecords = [];
  let repairedUnknownStatus = 0;
  let userMissing = 0;
  let unchanged = 0;
  let queuedUpdates = 0;
  let malformedDeleted = 0;
  let malformedCandidates = 0;

  let batch = db.batch();
  let opsInBatch = 0;
  const commitPromises = [];

  function queueSet(ref, payload) {
    if (dryRun) {
      return;
    }

    batch.set(ref, payload, { merge: true });
    opsInBatch += 1;

    if (opsInBatch >= 400) {
      commitPromises.push(batch.commit());
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  function queueDelete(ref) {
    if (dryRun) {
      return;
    }

    batch.delete(ref);
    opsInBatch += 1;

    if (opsInBatch >= 400) {
      commitPromises.push(batch.commit());
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  for (const submissionDoc of submissionsSnap.docs) {
    inspected += 1;
    const submissionData = submissionDoc.data() || {};

    const emailFromDoc = String(submissionData.email || '').trim().toLowerCase();
    const emailFromId = String(submissionDoc.id || '').trim().toLowerCase();
    const email = emailFromDoc || emailFromId;
    const hasValidEmail = email && email.includes('@') && email.includes('.');

    if (!hasValidEmail) {
      missingEmail += 1;

      if (deleteMalformed) {
        malformedCandidates += 1;
        queueDelete(submissionDoc.ref);
        malformedDeleted += 1;
      }

      continue;
    }

    const userRef = db.collection('users').doc(email);
    const userSnap = await userRef.get();

    let submissionStatus = normalizeStatus(submissionData.kycStatus);
    if (!submissionStatus) {
      const currentUserStatus = normalizeStatus(userSnap.exists ? userSnap.data()?.kycStatus : null);

      if (autoRepairBlankStatus) {
        submissionStatus = currentUserStatus || 'not_submitted';
        repairedUnknownStatus += 1;

        queueSet(submissionDoc.ref, {
          email,
          kycStatus: submissionStatus,
          updatedAt: now,
          kycStatusRepairedAt: now,
          kycStatusRepairSource: currentUserStatus ? 'users_doc' : 'auto_default_not_submitted',
        });
      } else {
        unknownStatus += 1;
        unknownStatusRecords.push({
          docId: submissionDoc.id,
          email,
          rawStatus: String(submissionData.kycStatus ?? ''),
        });
        continue;
      }
    }

    if (!userSnap.exists && !includeMissingUsers) {
      userMissing += 1;
      continue;
    }

    const currentStatus = normalizeStatus(userSnap.exists ? userSnap.data()?.kycStatus : null);
    if (currentStatus === submissionStatus) {
      unchanged += 1;
      continue;
    }

    queuedUpdates += 1;

    queueSet(userRef, {
      kycStatus: submissionStatus,
      updatedAt: now,
      kycStatusSyncedAt: now,
      kycStatusSyncSource: 'kyc_submissions',
    });
  }

  if (!dryRun && opsInBatch > 0) {
    commitPromises.push(batch.commit());
  }

  if (!dryRun && commitPromises.length > 0) {
    await Promise.all(commitPromises);
  }

  console.log('');
  console.log('Summary');
  console.log(`- inspected submissions: ${inspected}`);
  console.log(`- updates ${dryRun ? 'to apply' : 'applied'}: ${queuedUpdates}`);
  console.log(`- unchanged users: ${unchanged}`);
  console.log(`- missing users skipped: ${userMissing}`);
  console.log(`- invalid email skipped: ${missingEmail}`);
  console.log(`- unknown status skipped: ${unknownStatus}`);
  console.log(`- blank/unknown statuses auto-repaired: ${repairedUnknownStatus}`);
  console.log(`- malformed docs deleted: ${malformedDeleted}`);
  console.log(`- malformed docs candidates: ${malformedCandidates}`);

  if (unknownStatusRecords.length > 0) {
    console.log('');
    console.log('Unknown-status records:');
    unknownStatusRecords.forEach((item) => {
      console.log(`- docId=${item.docId} email=${item.email} rawStatus="${item.rawStatus}"`);
    });
  }

  if (dryRun) {
    console.log('');
    console.log('Dry run complete. Re-run without --dry-run to apply changes.');
  } else {
    console.log('');
    console.log('Migration complete.');
  }
}

main().catch((error) => {
  console.error('KYC sync migration failed:', error?.message || error);
  process.exitCode = 1;
});
