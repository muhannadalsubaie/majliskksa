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
import { VoiceButton } from './components/VoiceButton';

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
  const wasSignedIn = useRef(false);
  const { user, profile } = useProfile();
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
    case 'table':
      content = <><Placeholder title={TITLES.table} navigate={setScreen} /><VoiceButton channelName="dev-table" /></>;
      break;
    default: content = <Placeholder title={TITLES[screen]} navigate={setScreen} />;
  }

  return (
    <>
      {content}
      <div ref={liveRef} className="sr-only" aria-live="assertive" aria-atomic="true" />
    </>
  );
}
