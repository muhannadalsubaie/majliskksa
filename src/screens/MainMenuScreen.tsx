import { useEffect, useRef, useState } from 'react';
import type { Navigate } from '../state/navigation';
import type { Profile } from '../services/profile';
import { watchRewardedAd } from '../services/ads';

export function MainMenuScreen({ navigate, profile }: { navigate: Navigate; profile: Profile | null }) {
  const coins = profile?.coins ?? null;
  // "الحصول على عملات": نافذة باختيارين — شراء، أو مشاهدة إعلان
  const [getCoins, setGetCoins] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!getCoins) return;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getCoins]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setGetCoins(false); setTimeout(() => triggerRef.current?.focus(), 0); };
  return (
    <main className="screen" aria-labelledby="menu-title">
      <header className="topbar">
        <div>
          <h1 id="menu-title" style={{ marginBottom: 2 }}>مجلسك</h1>
          {profile?.username && <span style={{ color: 'var(--text-dim)' }}>أهلاً {profile.username}</span>}
        </div>
        {/* الصفحة RTL، لذا نهاية الصف = أعلى اليسار */}
        {profile?.unlimited
          ? <span className="coins" aria-label="رصيدك عملات لا محدودة، حساب المطوّر">🪙 ∞</span>
          : <span className="coins" aria-label={coins === null ? 'الرصيد غير متاح بعد' : `رصيدك ${coins} عملة`}>🪙 {coins ?? '…'}</span>}
      </header>
      {/* شعار التطبيق في المنتصف، والقائمة في أسفل الشاشة */}
      <div className="menu-logo">
        <img src="/icon.png" alt="" aria-hidden="true" />
      </div>
      <nav className="stack menu-nav" aria-label="القائمة الرئيسية">
        <button onClick={() => navigate('createTable')}>إنشاء طاولة</button>
        <button onClick={() => navigate('joinTable')}>انضمام إلى طاولة</button>
        <button className="secondary" onClick={() => navigate('friends')}>الأصدقاء</button>
        <button ref={triggerRef} className="secondary" aria-haspopup="dialog" onClick={() => setGetCoins(true)}>الحصول على عملات 🪙</button>
        <button className="secondary" onClick={() => navigate('settings')}>الإعدادات</button>
      </nav>

      {getCoins && (
        <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="coins-title">
            <h2 id="coins-title">الحصول على عملات</h2>
            <button ref={firstRef} onClick={() => { setGetCoins(false); navigate('shop'); }}>شراء عملات</button>
            <button aria-label="مشاهدة إعلان للحصول على عملتين" onClick={() => { close(); void watchRewardedAd(); }}>
              مشاهدة إعلان (+2 🪙)
            </button>
            <button className="secondary" onClick={close}>إلغاء</button>
          </div>
        </div>
      )}
    </main>
  );
}
