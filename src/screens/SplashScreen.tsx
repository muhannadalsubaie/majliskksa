import { useCallback, useEffect, useState } from 'react';
import { connectFirebase } from '../services/firebase';
import type { Navigate } from '../state/navigation';

type Status = 'loading' | 'error' | 'not-configured';

export function SplashScreen({ navigate }: { navigate: Navigate }) {
  const [status, setStatus] = useState<Status>('loading');

  const connect = useCallback(async () => {
    setStatus('loading');
    try {
      const { auth } = await connectFirebase();
      navigate(auth.currentUser ? 'menu' : 'auth');
    } catch (e) {
      setStatus((e as Error).message === 'not-configured' ? 'not-configured' : 'error');
    }
  }, [navigate]);

  useEffect(() => { void connect(); }, [connect]);

  return (
    <main className="screen center" aria-labelledby="splash-title">
      <img src="/icon.png" alt="" className="app-logo" width={160} height={160} />
      <h1 id="splash-title" className="sr-only">مجلسك</h1>
      {status === 'loading' && (
        <>
          <div className="spinner" role="progressbar" aria-label="جارٍ التحميل" />
          <p role="status">جارٍ الاتصال بالخادم…</p>
        </>
      )}
      {status !== 'loading' && (
        <div className="stack">
          <p role="alert">
            {status === 'not-configured'
              ? 'لم يتم إعداد Firebase بعد (ملف .env.local).'
              : 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.'}
          </p>
          <button onClick={connect}>إعادة المحاولة</button>
          {import.meta.env.DEV && (
            <button className="secondary" onClick={() => navigate('menu')}>متابعة بدون خادم (وضع التطوير)</button>
          )}
        </div>
      )}
    </main>
  );
}
