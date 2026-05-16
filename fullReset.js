/* eslint-disable no-console */
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

const KEEP_EMAILS = ['oseiwusumaroni@gmail.com', 'bhounce1000@gmail.com'];

const WIPE_COLLECTIONS = [
  'jobs',
  'transactions',
  'withdrawals',
  'notifications',
  'ratings',
  'otps',
  'disputes',
  'fraudReports',
  'messages',
  'chatRooms',
  'activityLogs',
  'bookings',
  'reviews',
];

const RELATED_COLLECTIONS = [
  'users',
  'wallets',
  'providerProfiles',
  'providers',
  'kyc',
  'kyc_submissions',
];

const USER_LINK_FIELDS = ['userId', 'customerId', 'providerId', 'email', 'userEmail', 'ownerEmail', 'providerEmail'];

async function deleteDocsInChunks(collectionName, queryRef = null, chunkSize = 400) {
  let total = 0;

  while (true) {
    const snap = queryRef
      ? await queryRef.limit(chunkSize).get()
      : await db.collection(collectionName).limit(chunkSize).get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
    total += snap.size;

    if (snap.size < chunkSize) break;
  }

  return total;
}

async function deleteCollection(collectionName) {
  const deleted = await deleteDocsInChunks(collectionName);
  console.log(`Wiped ${deleted} docs from /${collectionName}`);
}

async function resetUserDataByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const usersByEmail = await db.collection('users').where('email', '==', normalized).get();
  const usersById = await db.collection('users').doc(normalized).get();

  const refs = new Map();
  usersByEmail.docs.forEach((d) => refs.set(d.id, d.ref));
  if (usersById.exists) refs.set(usersById.id, usersById.ref);

  for (const [id, ref] of refs.entries()) {
    await ref.set(
      {
        walletBalance: 0,
        jobsPosted: 0,
        jobsAccepted: 0,
        jobsDone: 0,
        totalEarnings: 0,
        rating: null,
        reviewCount: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('wallets').doc(id).set(
      {
        balance: 0,
        walletBalance: 0,
        currency: 'GHS',
        transactions: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('wallets').doc(normalized).set(
      {
        balance: 0,
        walletBalance: 0,
        currency: 'GHS',
        transactions: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`Reset stats for ${normalized} on user doc ${id}`);
  }
}

async function resetProviderProfile(email) {
  const normalized = String(email || '').trim().toLowerCase();

  const providerDocByEmail = await db.collection('providerProfiles').doc(normalized).get();
  if (providerDocByEmail.exists) {
    await providerDocByEmail.ref.set(
      {
        jobsDone: 0,
        rating: null,
        reviews: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const providersDocByEmail = await db.collection('providers').doc(normalized).get();
  if (providersDocByEmail.exists) {
    await providersDocByEmail.ref.set(
      {
        jobsDone: 0,
        avgRating: 0,
        rating: null,
        reviewCount: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

async function deleteUserRelatedDocs(uid, email) {
  const idValues = [String(uid || '').trim(), String(email || '').trim().toLowerCase()].filter(Boolean);

  for (const col of RELATED_COLLECTIONS) {
    for (const id of idValues) {
      await db.collection(col).doc(id).delete().catch(() => null);
    }

    for (const field of USER_LINK_FIELDS) {
      for (const value of idValues) {
        const snap = await db.collection(col).where(field, '==', value).get().catch(() => null);
        if (!snap || snap.empty) continue;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }
}

async function deleteAllOtherUsers() {
  const allUsers = [];
  let pageToken;

  do {
    const result = await auth.listUsers(1000, pageToken);
    allUsers.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  const keepSet = new Set(KEEP_EMAILS.map((e) => e.toLowerCase()));
  const toDelete = allUsers.filter((u) => !keepSet.has(String(u.email || '').toLowerCase()));

  for (const user of toDelete) {
    const userEmail = String(user.email || '').trim().toLowerCase();
    try {
      await deleteUserRelatedDocs(user.uid, userEmail);
      await auth.deleteUser(user.uid);
      console.log(`Deleted user: ${userEmail || user.uid}`);
    } catch (e) {
      console.log(`Could not delete ${userEmail || user.uid}: ${e.message}`);
    }
  }

  console.log(`Deleted ${toDelete.length} users from Auth`);
}

async function run() {
  console.log('Starting full reset...');

  console.log('Step 1: Deleting test users...');
  await deleteAllOtherUsers();

  console.log('Step 2: Wiping all activity collections...');
  for (const col of WIPE_COLLECTIONS) {
    await deleteCollection(col);
  }

  console.log('Step 3: Resetting kept user stats...');
  for (const email of KEEP_EMAILS) {
    await resetUserDataByEmail(email);
  }

  console.log('Step 4: Resetting kept provider profiles...');
  await resetProviderProfile('bhounce1000@gmail.com');

  console.log('Full reset complete. App is now clean and fresh.');
  process.exit(0);
}

run().catch((error) => {
  console.error('Full reset failed:', error);
  process.exit(1);
});
