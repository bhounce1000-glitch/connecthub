import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// 🔑 Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyAej377YaX224k6xYNdTTJtfmuQ6t5fuGs",
  authDomain: "connecthub-1873e.firebaseapp.com",
  projectId: "connecthub-1873e",
  storageBucket: "connecthub-1873e.appspot.com",
  messagingSenderId: "202550618623",
  appId: "1:202550618623:web:b50f6f3b55341dc4081fca"
};

// 🔥 Initialize Firebase
const app = initializeApp(firebaseConfig);

// 🔥 Export ONLY auth
export const auth = getAuth(app);