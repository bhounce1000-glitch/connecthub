/* eslint-disable no-console */
require('dotenv').config();

const admin = require('firebase-admin');

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
    limit: Number.isFinite(Number(process.env.BACKFILL_LIMIT)) ? Number(process.env.BACKFILL_LIMIT) : 1000,
  };
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCoordinatesFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Supports patterns like "5.6037,-0.187" or "lat: 5.6037 lng: -0.187"
  const match = raw.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;

  const latitude = parseNumber(match[1]);
  const longitude = parseNumber(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude, source: 'parsed_text' };
}

function extractExistingCoordinates(row) {
  const location = row?.location || {};
  const latitude = parseNumber(location.coordinates?.latitude) ?? parseNumber(location.latitude) ?? parseNumber(row?.latitude);
  const longitude = parseNumber(location.coordinates?.longitude) ?? parseNumber(location.longitude) ?? parseNumber(row?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, source: 'already_present' };
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv);
  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  }

  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  console.log('Starting request coordinates backfill...');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`);

  const snapshot = await db.collection('requests').limit(limit).get();
  console.log(`Inspected up to ${snapshot.size} request documents.`);

  let checked = 0;
  let alreadyHasCoords = 0;
  let backfilled = 0;
  let skipped = 0;

  let batch = db.batch();
  let opsInBatch = 0;
  const commitPromises = [];

  const queueSet = (ref, payload) => {
    if (dryRun) return;

    batch.set(ref, payload, { merge: true });
    opsInBatch += 1;
    if (opsInBatch >= 400) {
      commitPromises.push(batch.commit());
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (const docSnap of snapshot.docs) {
    checked += 1;
    const row = docSnap.data() || {};

    const existing = extractExistingCoordinates(row);
    if (existing) {
      alreadyHasCoords += 1;
      continue;
    }

    const parsedFromLocationText = parseCoordinatesFromText(row?.locationText);
    const parsedFromLabel = parseCoordinatesFromText(row?.location?.label);
    const parsed = parsedFromLocationText || parsedFromLabel;

    if (!parsed) {
      skipped += 1;
      continue;
    }

    backfilled += 1;
    queueSet(docSnap.ref, {
      location: {
        ...(row.location || {}),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        coordinates: {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
        },
      },
      locationCoordsBackfilledAt: nowIso,
      locationCoordsBackfillSource: parsed.source,
      updatedAt: nowIso,
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
  console.log(`- checked: ${checked}`);
  console.log(`- already had coordinates: ${alreadyHasCoords}`);
  console.log(`- backfilled ${dryRun ? 'to apply' : 'applied'}: ${backfilled}`);
  console.log(`- skipped (no parseable coordinates): ${skipped}`);

  if (dryRun) {
    console.log('');
    console.log('Dry run complete. Re-run without --dry-run to apply changes.');
  } else {
    console.log('');
    console.log('Backfill complete.');
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error?.message || error);
  process.exitCode = 1;
});
