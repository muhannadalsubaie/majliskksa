import { Capacitor } from '@capacitor/core';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { type Auth, getAuth, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export interface FirebaseServices { app: FirebaseApp; auth: Auth; db: Firestore }

let pending: Promise<FirebaseServices> | null = null;

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId);
}

/**
 * يهيّئ Firebase مرة واحدة وينتظر جاهزية المصادقة (الاستدعاءات المتزامنة تنتظر نفس التهيئة).
 * يرمي خطأ إن فشل، لتعرض شاشة البداية زر إعادة المحاولة.
 */
export function connectFirebase(): Promise<FirebaseServices> {
  if (!pending) {
    pending = init().catch((e) => {
      pending = null; // نسمح بإعادة المحاولة
      throw e;
    });
  }
  return pending;
}

async function init(): Promise<FirebaseServices> {
  if (!isFirebaseConfigured()) throw new Error('not-configured');
  const app = initializeApp(config);
  // داخل تطبيق الجوال: getAuth يحاول تحميل إطار الويب الخاص بالنوافذ المنبثقة فيعلق،
  // لذلك نهيّئ المصادقة بتخزين محلي فقط (البريد وكلمة المرور تعمل، وGoogle بإضافة أصلية)
  const auth = Capacitor.isNativePlatform()
    ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
    : getAuth(app);
  await withTimeout(auth.authStateReady(), 15_000);
  return { app, auth, db: getFirestore(app) };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
