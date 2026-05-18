/* eslint-disable no-console */
require('dotenv').config();

const admin = require('firebase-admin');

const GHANA_BOUNDS = {
  minLat: 4.0,
  maxLat: 12.0,
  minLng: -4.5,
  maxLng: 2.0,
};

const GHANA_AREA_CENTROIDS = {
  'east legon': { latitude: 5.6402, longitude: -0.1517 },
  tema: { latitude: 5.6698, longitude: -0.0166 },
  osu: { latitude: 5.5603, longitude: -0.1814 },
  labone: { latitude: 5.5565, longitude: -0.1805 },
  cantonments: { latitude: 5.5709, longitude: -0.1758 },
  adenta: { latitude: 5.7055, longitude: -0.1608 },
  spintex: { latitude: 5.6429, longitude: -0.0966 },
  achimota: { latitude: 5.6366, longitude: -0.2499 },
  kumasi: { latitude: 6.6885, longitude: -1.6244 },
  takoradi: { latitude: 4.9016, longitude: -1.7831 },
  'cape coast': { latitude: 5.1053, longitude: -1.2466 },
  accra: { latitude: 5.6037, longitude: -0.1870 },
};

const fetchJson = typeof fetch === 'function'
  ? fetch
  : (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));

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
    disableGeocode: args.has('--no-geocode'),
    limit: Number.isFinite(Number(process.env.BACKFILL_LIMIT)) ? Number(process.env.BACKFILL_LIMIT) : 1000,
    geocodeDelayMs: Number.isFinite(Number(process.env.BACKFILL_GEOCODE_DELAY_MS))
      ? Number(process.env.BACKFILL_GEOCODE_DELAY_MS)
      : 250,
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

function insideGhanaBounds(latitude, longitude) {
  return latitude >= GHANA_BOUNDS.minLat
    && latitude <= GHANA_BOUNDS.maxLat
    && longitude >= GHANA_BOUNDS.minLng
    && longitude <= GHANA_BOUNDS.maxLng;
}

function buildGeocodeQueries(row) {
  const location = typeof row?.location === 'object' && row?.location !== null ? row.location : {};
  const legacyLocation = typeof row?.location === 'string' ? row.location : '';
  const area = String(location.area || '').trim();
  const fullAddress = String(location.fullAddress || '').trim();
  const label = String(location.label || '').trim();
  const locationText = String(row?.locationText || '').trim();
  const topLevelArea = String(row?.area || '').trim();
  const topLevelAddress = String(row?.fullAddress || '').trim();

  const candidates = [
    [fullAddress, area].filter(Boolean).join(', '),
    [topLevelAddress, topLevelArea].filter(Boolean).join(', '),
    fullAddress,
    topLevelAddress,
    label,
    legacyLocation,
    locationText,
    area,
    topLevelArea,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => (/(ghana)/i.test(value) ? value : `${value}, Ghana`));

  return Array.from(new Set(candidates));
}

function normalizeAreaKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function centroidFromArea(row) {
  const location = typeof row?.location === 'object' && row?.location !== null ? row.location : {};
  const legacyLocation = typeof row?.location === 'string' ? row.location : '';
  const areaCandidates = [
    location.area,
    location.label,
    row?.locationText,
    row?.area,
    legacyLocation,
  ]
    .map((value) => normalizeAreaKey(value))
    .filter(Boolean);

  for (const candidate of areaCandidates) {
    const exact = GHANA_AREA_CENTROIDS[candidate];
    if (exact) {
      return { ...exact, source: 'ghana_area_centroid' };
    }

    const tokenMatch = Object.entries(GHANA_AREA_CENTROIDS)
      .find(([key]) => candidate.includes(key));
    if (tokenMatch) {
      const [, coords] = tokenMatch;
      return { ...coords, source: 'ghana_area_centroid' };
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeWithNominatim(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`;
  const response = await fetchJson(url, {
    headers: {
      'User-Agent': 'ConnectHubBackfill/1.0 (connecthub operations)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  const rows = await response.json();
  const best = Array.isArray(rows) ? rows[0] : null;
  if (!best) return null;

  const latitude = parseNumber(best.lat);
  const longitude = parseNumber(best.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!insideGhanaBounds(latitude, longitude)) return null;

  const countryCode = String(best?.address?.country_code || '').trim().toLowerCase();
  if (countryCode && countryCode !== 'gh') {
    return null;
  }

  return {
    latitude,
    longitude,
    source: 'nominatim_geocode',
  };
}

async function geocodeCoordinates(row, geocodeDelayMs) {
  const queries = buildGeocodeQueries(row);
  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    try {
      const hit = await geocodeWithNominatim(query);
      if (hit) {
        return hit;
      }
    } catch {
      // Keep trying lower-priority queries.
    }

    if (i < queries.length - 1 && geocodeDelayMs > 0) {
      await sleep(geocodeDelayMs);
    }
  }

  return null;
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
  const { dryRun, disableGeocode, limit, geocodeDelayMs } = parseArgs(process.argv);
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
  console.log(`Geocoding: ${disableGeocode ? 'disabled' : 'enabled (Nominatim)'}`);

  const snapshot = await db.collection('requests').limit(limit).get();
  console.log(`Inspected up to ${snapshot.size} request documents.`);

  let checked = 0;
  let alreadyHasCoords = 0;
  let backfilled = 0;
  let backfilledFromParsedText = 0;
  let backfilledFromGeocode = 0;
  let geocodeAttempts = 0;
  let geocodeMisses = 0;
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
    let parsed = parsedFromLocationText || parsedFromLabel;

    if (!parsed && !disableGeocode) {
      geocodeAttempts += 1;
      parsed = await geocodeCoordinates(row, geocodeDelayMs);
      if (!parsed) {
        geocodeMisses += 1;
      }
    }

    if (!parsed) {
      parsed = centroidFromArea(row);
    }

    if (!parsed) {
      skipped += 1;
      continue;
    }

    backfilled += 1;
    if (parsed.source === 'parsed_text') {
      backfilledFromParsedText += 1;
    } else {
      backfilledFromGeocode += 1;
    }
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
  console.log(`- from coordinate text: ${backfilledFromParsedText}`);
  console.log(`- from geocoding: ${backfilledFromGeocode}`);
  console.log(`- geocode attempts: ${geocodeAttempts}`);
  console.log(`- geocode misses: ${geocodeMisses}`);
  console.log(`- skipped (no parseable/geocodable coordinates): ${skipped}`);

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
