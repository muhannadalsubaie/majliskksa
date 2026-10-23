import type { Navigate } from '../state/navigation';
import type { Profile } from '../services/profile';

export function MainMenuScreen({ navigate, profile }: { navigate: Navigate; profile: Profile | null }) {
  const coins = profile?.coins ?? null;
  return (
    <main className="screen" aria-labelledby="menu-title">
      <header className="topbar">
        <div>
          <h1 id="menu-title" style={{ marginBottom: 2 }}>مجلسك</h1>
          {profile?.displayName && <span style={{ color: 'var(--text-dim)' }}>أهلاً {profile.displayName}</span>}
        </div>
        {/* الصفحة RTL، لذا نهاية الصف = أعلى اليسار */}
        <span className="coins" aria-label={coins === null ? 'الرصيد غير متاح بعد' : `رصيدك ${coins} عملة`}>🪙 {coins ?? '…'}</span>
      </header>
      <nav className="stack" aria-label="القائمة الرئيسية">
        <button onClick={() => navigate('createTable')}>إنشاء طاولة</button>
        <button onClick={() => navigate('joinTable')}>انضمام إلى طاولة</button>
        <button className="secondary" onClick={() => navigate('friends')}>الأصدقاء المتصلون</button>
        <button className="secondary" aria-label="مشاهدة إعلان للحصول على عملتين">مشاهدة إعلان (+2 🪙)</button>
        <button className="secondary" onClick={() => navigate('settings')}>الإعدادات</button>
      </nav>
    </main>
  );
}
