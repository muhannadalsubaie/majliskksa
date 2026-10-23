import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

// يجب أن تطابق المنطقة المستخدمة في functions/src/index.ts
export const FUNCTIONS_REGION = 'europe-west1';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export interface FirebaseServices { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions }

let services: FirebaseServices | null = null;

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId);
}

/** يهيّئ Firebase وينتظر جاهزية المصادقة. يرمي خطأ إن فشل، لتعرض شاشة البداية زر إعادة المحاولة. */
export async function connectFirebase(): Promise<FirebaseServices> {
  if (services) return services;
  if (!isFirebaseConfigured()) throw new Error('not-configured');
  const app = initializeApp(config);
  const auth = getAuth(app);
  await auth.authStateReady();
  services = { app, auth, db: getFirestore(app), functions: getFunctions(app, FUNCTIONS_REGION) };
  return services;
}
