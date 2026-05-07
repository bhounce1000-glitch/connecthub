/* eslint-disable no-console */
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function fixUser(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  console.log('Fixing user:', normalizedEmail);

  let authUser;
  try {
    authUser = await admin.auth().getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error('ERROR: No Firebase Auth account found for', normalizedEmail);
      process.exit(1);
    }
    throw err;
  }

  console.log('Firebase Auth UID:', authUser.uid);
  console.log('emailVerified before:', authUser.emailVerified);

  if (!authUser.emailVerified) {
    await admin.auth().updateUser(authUser.uid, { emailVerified: true });
    console.log('✅ emailVerified set to true');
  } else {
    console.log('ℹ️  emailVerified was already true');
  }

  const userRef = db.collection('users').doc(normalizedEmail);
  const userSnap = await userRef.get();

  if (userSnap.exists) {
    const data = userSnap.data();
    console.log('Firestore document found. kycStatus:', data.kycStatus, '| banned:', data.banned);
  } else {
    console.warn('WARNING: No Firestore document found for', normalizedEmail, '— creating one');
    await userRef.set({
      email: normalizedEmail,
      displayName: '',
      role: 'customer',
      kycStatus: 'verified',
      walletBalance: 0,
      createdAt: new Date().toISOString(),
      onboardingDone: true,
    });
    console.log('✅ Firestore document created');
  }

  console.log('\n✅ Done. User', normalizedEmail, 'can now log in.');
}

fixUser('oseiwusumaroni@gmail.com').then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
