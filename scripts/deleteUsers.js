const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

// ADMIN LOGIN ACCOUNT — do not change this to support email
const KEEP = ['oseiwusumaroni@gmail.com', 'bhounce1000@gmail.com'];

const DELETE_EMAILS = [
  'adjeiboateng066@gmail.com',
  'amosopoku671@gmail.com',
  'connecthub-otp-test-176790@gmx.dev',
  'connecthub-otp-test-3@gmx.dev',
  'connecthub-otp-test-4@gmx.dev',
  'connecthub-otp-test-7@gmx.dev',
  'e2e-customer@connecthub-test.local',
  'e2e-provider@connecthub-test.local',
  'e2e-test-customer-001',
  'e2e-test-provider-001',
  'evaabekah705@gmail.com',
  'kofiwusu843@gmail.com',
  'provider-test-8@gmx.dev',
  'qa.connecthub.20260427.2331@example.com',
  'test2@gmail.com',
  'testcustomer0429@mailinator.com',
  'testprovider0429@mailinator.com',
  'thecuriosityhub1000@gmal.com'
];

const COLLECTIONS_TO_CLEAN = [
  'users', 'wallets', 'jobs', 'transactions',
  'withdrawals', 'notifications', 'ratings', 'otps', 'kyc'
];

const deleteUserData = async (uid, email) => {
  for (const col of COLLECTIONS_TO_CLEAN) {
    try {
      const docRef = db.collection(col).doc(uid);
      await docRef.delete();
    } catch (e) {}

    // Also delete by userId or customerId or providerId field
    try {
      const q = await db.collection(col)
        .where('userId', '==', uid).get();
      for (const doc of q.docs) await doc.ref.delete();
    } catch (e) {}

    try {
      const q = await db.collection(col)
        .where('customerId', '==', uid).get();
      for (const doc of q.docs) await doc.ref.delete();
    } catch (e) {}

    try {
      const q = await db.collection(col)
        .where('providerId', '==', uid).get();
      for (const doc of q.docs) await doc.ref.delete();
    } catch (e) {}
  }
};

const run = async () => {
  let deleted = 0;
  for (const email of DELETE_EMAILS) {
    try {
      const user = await auth.getUserByEmail(email);
      await deleteUserData(user.uid, email);
      await auth.deleteUser(user.uid);
      console.log(`✅ Deleted: ${email}`);
      deleted++;
    } catch (e) {
      console.log(`⚠️ Not found or already deleted: ${email}`);
    }
  }
  console.log(`\nDone. ${deleted} users deleted.`);
  process.exit(0);
};

run();
