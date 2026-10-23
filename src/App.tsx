import { useEffect, useRef, useState } from 'react';
import { mountAnnouncer } from './services/announcer';
import type { ScreenName } from './state/navigation';
import { SplashScreen } from './screens/SplashScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Placeholder } from './screens/Placeholder';
import { VoiceButton } from './components/VoiceButton';

const TITLES: Record<ScreenName, string> = {
  splash: 'مجلسك', auth: 'تسجيل الدخول', menu: 'القائمة الرئيسية', createTable: 'إنشاء طاولة',
  joinTable: 'الانضمام إلى طاولة', table: 'الطاولة', friends: 'الأصدقاء', settings: 'الإعدادات',
};

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('splash');
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (liveRef.current) mountAnnouncer(liveRef.current); }, []);
  useEffect(() => { document.title = `${TITLES[screen]} — مجلسك`; }, [screen]);

  let content;
  switch (screen) {
    case 'splash': content = <SplashScreen navigate={setScreen} />; break;
    case 'menu': content = <MainMenuScreen navigate={setScreen} coins={15} />; break;
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
