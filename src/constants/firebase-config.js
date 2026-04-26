const envConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const fallbackConfig = {
  apiKey: 'AIzaSyAej377YaX224k6xYNdTTJtfmuQ6t5fuGs',
  authDomain: 'connecthub-1873e.firebaseapp.com',
  projectId: 'connecthub-1873e',
  storageBucket: 'connecthub-1873e.firebasestorage.app',
  messagingSenderId: '202550618623',
  appId: '1:202550618623:web:b50f6f3b55341dc4081fca',
};

const hasFullEnvConfig = Object.values(envConfig).every(Boolean);

const normalizeStorageBucket = (bucket, projectId) => {
  if (!bucket) {
    return bucket;
  }

  // Firebase projects created recently may use *.firebasestorage.app instead of *.appspot.com
  if (bucket.endsWith('.appspot.com') && projectId) {
    return `${projectId}.firebasestorage.app`;
  }

  return bucket;
};

const resolvedEnvConfig = {
  ...envConfig,
  storageBucket: normalizeStorageBucket(envConfig.storageBucket, envConfig.projectId),
};

export const firebaseConfig = hasFullEnvConfig ? resolvedEnvConfig : fallbackConfig;