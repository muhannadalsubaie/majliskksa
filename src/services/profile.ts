import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { connectFirebase, isFirebaseConfigured } from './firebase';
import { API_URL, api } from './api';

export interface Profile {
  /** اسم المستخدم الفريد — فارغ إن لم يختره اللاعب بعد */
  username: string;
  /** null حتى يُنشئ الخادم ملف اللاعب (مع الرصيد الترحيبي) */
  coins: number | null;
  /** هل وُجد ملف اللاعب في قاعدة البيانات */
  loaded: boolean;
}

/** المستخدم الحالي ورصيده — يُقرأ مباشرة من Firestore (الكتابة من الخادم فقط). */
export function useProfile(): { user: User | null; profile: Profile | null } {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    let unsubDoc: (() => void) | undefined;
    let unsubAuth: (() => void) | undefined;
    let cancelled = false;
    void connectFirebase().then(({ auth, db }) => {
      if (cancelled) return;
      unsubAuth = onAuthStateChanged(auth, (u) => {
        setUser(u);
        unsubDoc?.();
        unsubDoc = undefined;
        if (!u) { setProfile(null); return; }
        setProfile({ username: '', coins: null, loaded: false });
        // الخادم ينشئ ملف اللاعب مع 15 عملة ترحيبية عند أول دخول (لا يتكرر)
        if (API_URL) void api(u, '/profile/ensure').catch(() => {});
        unsubDoc = onSnapshot(doc(db, 'users', u.uid), (snap) => {
          const data = snap.data();
          setProfile({ username: String(data?.username ?? ''), coins: data ? Number(data.coins) : null, loaded: snap.exists() });
        }, () => { /* قبل نشر قواعد/دوال الخادم قد تفشل القراءة — نبقي الرصيد مجهولاً */ });
      });
    }).catch(() => {});
    return () => { cancelled = true; unsubDoc?.(); unsubAuth?.(); };
  }, []);

  return { user, profile };
}
