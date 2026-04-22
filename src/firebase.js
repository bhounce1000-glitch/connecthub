import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAej377YaX224k6xYNdTTJtfmuQ6t5fuGs",
  authDomain: "connecthub-1873e.firebaseapp.com",
  projectId: "connecthub-1873e",
  storageBucket: "connecthub-1873e.appspot.com",
  messagingSenderId: "202550618623",
  appId: "1:202550618623:web:b50f6f3b55341dc4081fca"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);