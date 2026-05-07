/* eslint-disable no-console */
/**
 * fix-all-verified-users.js
 *
 * Loops all Firestore `users` documents and sets emailVerified=true in Firebase Auth
 * for any account that does not already have it. This unblocks any existing user
 * who is stuck behind the email-verification gate.
 */
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function fixAll() {
  const snapshot = await db.collection('users').get();
  console.log(`Found ${snapshot.size} Firestore user documents.`);

  let fixed = 0;
  let alreadyOk = 0;
  let noAuthAccount = 0;
  let errors = 0;

  for (const docSnap of snapshot.docs) {
    const email = String(docSnap.id || '').trim().toLowerCase();
    if (!email) continue;

    try {
      let authUser;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          noAuthAccount++;
          continue;
        }
        throw err;
      }

      if (!authUser.emailVerified) {
        await admin.auth().updateUser(authUser.uid, { emailVerified: true });
        console.log(`  ✅ Fixed: ${email}`);
        fixed++;
      } else {
        alreadyOk++;
      }
    } catch (err) {
      console.error(`  ❌ Error for ${email}:`, err.message);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total users:          ${snapshot.size}`);
  console.log(`Fixed (was false):    ${fixed}`);
  console.log(`Already verified:     ${alreadyOk}`);
  console.log(`No Auth account:      ${noAuthAccount}`);
  console.log(`Errors:               ${errors}`);
}

fixAll().then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
