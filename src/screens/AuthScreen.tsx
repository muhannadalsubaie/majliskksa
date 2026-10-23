import { useState, type FormEvent } from 'react';
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup,
} from 'firebase/auth';
import { USERNAME_ERRORS, validateUsername } from '../../shared/username';
import { UsernameField } from '../components/UsernameField';
import { connectFirebase } from '../services/firebase';
import { announce } from '../services/announcer';
import { api, apiPublic } from '../services/api';
import type { Navigate } from '../state/navigation';

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة',
  'auth/invalid-email': 'البريد الإلكتروني غير صالح',
  'auth/email-already-in-use': 'هذا البريد مسجّل مسبقاً، سجّل الدخول بدلاً من ذلك',
  'auth/weak-password': 'كلمة المرور قصيرة — 6 أحرف على الأقل',
  'auth/missing-password': 'أدخل كلمة المرور',
  'auth/too-many-requests': 'محاولات كثيرة، حاول بعد قليل',
  'auth/popup-closed-by-user': 'تم إغلاق نافذة Google',
  'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت',
  ...USERNAME_ERRORS,
};

const message = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  return ERRORS[err.code ?? ''] ?? ERRORS[err.message ?? ''] ?? 'حدث خطأ، حاول مرة أخرى';
};

export function AuthScreen({ navigate }: { navigate: Navigate }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      const msg = message(e);
      setError(msg);
      announce(msg);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { auth } = await connectFirebase();
      if (mode === 'signup') {
        const invalid = validateUsername(name);
        if (invalid) throw { code: invalid };
        // فحص مبدئي قبل إنشاء الحساب؛ الحجز الفعلي الذرّي يتم بعده في الخادم
        const check = await apiPublic<{ available: boolean; error?: string }>('/username/available', { username: name });
        if (!check.available) throw { code: check.error ?? 'taken' };
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        // إن فشل الحجز هنا (سباق نادر) تظهر شاشة اختيار الاسم تلقائياً
        await api(cred.user, '/profile/username', { username: name }).catch(() => {});
        announce(`أهلاً ${name.trim()}، حصلت على 15 عملة ترحيبية`);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        announce('تم تسجيل الدخول');
      }
      navigate('menu');
    });
  };

  const google = () => run(async () => {
    const { auth } = await connectFirebase();
    // ملاحظة: داخل تطبيق الجوال (Capacitor) سنستبدل النافذة المنبثقة بإضافة دخول أصلية
    await signInWithPopup(auth, new GoogleAuthProvider());
    announce('تم تسجيل الدخول');
    navigate('menu');
  });

  const resetPassword = () => run(async () => {
    if (!email.trim()) throw { code: 'auth/invalid-email' };
    const { auth } = await connectFirebase();
    await sendPasswordResetEmail(auth, email.trim());
    announce('أرسلنا رابط استعادة كلمة المرور إلى بريدك');
    setError('أرسلنا رابط استعادة كلمة المرور إلى بريدك');
  });

  const isSignup = mode === 'signup';

  return (
    <main className="screen" aria-labelledby="auth-title">
      <img src="/icon.png" alt="" className="app-logo" width={120} height={120} style={{ alignSelf: 'center' }} />
      <h1 id="auth-title" style={{ textAlign: 'center' }}>{isSignup ? 'حساب جديد' : 'تسجيل الدخول'}</h1>

      <form className="stack" onSubmit={submit} noValidate>
        {isSignup && (
          <UsernameField value={name} onChange={setName} />
        )}
        <label className="stack" style={{ gap: 6 }}>
          البريد الإلكتروني
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          كلمة المرور
          <input
            type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={6} required
          />
        </label>

        {error && <p role="alert" style={{ color: 'var(--gold-soft)', margin: 0 }}>{error}</p>}

        <button type="submit" disabled={busy}>{isSignup ? 'إنشاء الحساب (+15 🪙)' : 'دخول'}</button>
      </form>

      <button className="secondary" onClick={google} disabled={busy}>الدخول بحساب Google</button>

      <button className="secondary" onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }} disabled={busy}>
        {isSignup ? 'عندي حساب — تسجيل الدخول' : 'ما عندي حساب — حساب جديد'}
      </button>
      {!isSignup && (
        <button className="secondary" onClick={resetPassword} disabled={busy}>نسيت كلمة المرور</button>
      )}
    </main>
  );
}
