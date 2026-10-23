import { useEffect, useRef, useState } from 'react';
import { mountAnnouncer } from './services/announcer';
import type { ScreenName } from './state/navigation';
import { SplashScreen } from './screens/SplashScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ChooseUsernameScreen } from './screens/ChooseUsernameScreen';
import { useProfile } from './services/profile';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Placeholder } from './screens/Placeholder';
import { CreateTableScreen } from './screens/CreateTableScreen';
import { JoinTableScreen } from './screens/JoinTableScreen';
import { TableScreen } from './screens/TableScreen';
import { API_ERRORS, joinTable } from './services/tables';
import { announce } from './services/announcer';

const TITLES: Record<ScreenName, string> = {
  splash: 'مجلسك', auth: 'تسجيل الدخول', menu: 'القائمة الرئيسية', createTable: 'إنشاء طاولة',
  joinTable: 'الانضمام إلى طاولة', table: 'الطاولة', friends: 'الأصدقاء', settings: 'الإعدادات',
};

export default function App() {
  const [screen, setScreen] = useState<ScreenName>(() => {
    // للتطوير فقط: فتح شاشة مباشرة عبر ?screen=settings
    const dev = import.meta.env.DEV ? new URLSearchParams(location.search).get('screen') : null;
    return (dev as ScreenName | null) ?? 'splash';
  });
  const liveRef = useRef<HTMLDivElement>(null);
  const [tableId, setTableId] = useState<string | null>(() => (import.meta.env.DEV ? new URLSearchParams(location.search).get('table') : null));
  const { user, profile } = useProfile();
  const openTable = (id: string) => { setTableId(id); setScreen('table'); };

  // رابط دعوة (?join=...&invite=...): نحفظه حتى يكتمل تسجيل الدخول واختيار الاسم ثم ننضم
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const id = q.get('join');
    if (id && /^[0-9a-f]{64}$/.test(id)) {
      try { sessionStorage.setItem('majlisk.pendingJoin', JSON.stringify({ id, invite: q.get('invite') ?? undefined })); } catch { /* ignore */ }
      history.replaceState(null, '', location.pathname);
    }
  }, []);
  useEffect(() => {
    if (!user || !profile?.username || screen === 'splash' || screen === 'table') return;
    let pending: { id: string; invite?: string } | null = null;
    try { pending = JSON.parse(sessionStorage.getItem('majlisk.pendingJoin') ?? 'null'); } catch { /* ignore */ }
    if (!pending) return;
    try { sessionStorage.removeItem('majlisk.pendingJoin'); } catch { /* ignore */ }
    joinTable(pending.id, pending.invite)
      .then(() => { announce('تم قبول الدعوة'); openTable(pending!.id); })
      .catch((e) => announce(API_ERRORS[(e as Error).message] ?? 'تعذّر الانضمام للطاولة'));
  }, [user, profile?.username, screen]);
  const wasSignedIn = useRef(false);
  // أي حساب مسجّل بلا اسم مستخدم يجب أن يختار اسماً قبل أي شاشة أخرى
  const needsUsername = Boolean(user && profile?.loaded && !profile.username && screen !== 'splash');

  useEffect(() => { if (liveRef.current) mountAnnouncer(liveRef.current); }, []);
  // بعد تسجيل الخروج من أي شاشة نعود لشاشة الدخول
  useEffect(() => { if (!user && screen !== 'splash' && screen !== 'auth' && profile === null && wasSignedIn.current) setScreen('auth'); if (user) wasSignedIn.current = true; }, [user, screen, profile]);
  useEffect(() => { document.title = `${TITLES[screen]} — مجلسك`; }, [screen]);

  let content;
  if (needsUsername) content = <ChooseUsernameScreen />;
  else switch (screen) {
    case 'splash': content = <SplashScreen navigate={setScreen} />; break;
    case 'auth': content = <AuthScreen navigate={setScreen} />; break;
    case 'menu': content = <MainMenuScreen navigate={setScreen} profile={profile} />; break;
    case 'settings': content = <SettingsScreen navigate={setScreen} />; break;
    case 'createTable': content = <CreateTableScreen navigate={setScreen} openTable={openTable} coins={profile?.unlimited ? Infinity : profile?.coins ?? null} />; break;
    case 'joinTable': content = <JoinTableScreen navigate={setScreen} openTable={openTable} />; break;
    case 'table': {
      const devUser = import.meta.env.DEV ? new URLSearchParams(location.search).get('devUser') : null;
      const uid = devUser ?? user?.uid ?? '';
      content = tableId ? <TableScreen tableId={tableId} uid={uid} navigate={setScreen} /> : <Placeholder title={TITLES.table} navigate={setScreen} />;
      break;
    }
    default: content = <Placeholder title={TITLES[screen]} navigate={setScreen} />;
  }

  return (
    <>
      {content}
      <div ref={liveRef} className="sr-only" role="log" aria-live="polite" aria-relevant="additions" aria-label="إعلانات اللعبة" />
    </>
  );
}
