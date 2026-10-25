import type { Navigate } from '../state/navigation';
import type { Profile } from '../services/profile';
import { watchRewardedAd } from '../services/ads';

export function MainMenuScreen({ navigate, profile }: { navigate: Navigate; profile: Profile | null }) {
  const coins = profile?.coins ?? null;
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
        <button className="secondary" onClick={() => navigate('shop')}>شراء عملات 🪙</button>
        <button className="secondary" aria-label="مشاهدة إعلان للحصول على عملتين" onClick={() => void watchRewardedAd()}>مشاهدة إعلان (+2 🪙)</button>
        <button className="secondary" onClick={() => navigate('settings')}>الإعدادات</button>
      </nav>
    </main>
  );
}
