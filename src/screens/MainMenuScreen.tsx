import type { Navigate } from '../state/navigation';

export function MainMenuScreen({ navigate, coins }: { navigate: Navigate; coins: number }) {
  return (
    <main className="screen" aria-labelledby="menu-title">
      <header className="topbar">
        <h1 id="menu-title">مجلسك</h1>
        {/* الصفحة RTL، لذا نهاية الصف = أعلى اليسار */}
        <span className="coins" aria-label={`رصيدك ${coins} عملة`}>🪙 {coins}</span>
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
