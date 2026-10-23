import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Switch } from '../components/Switch';
import { isMuted, setMuted } from '../services/preferences';
import { connectFirebase } from '../services/firebase';
import { isSpeechEnabled, setSpeechEnabled } from '../services/announcer';
import { isScreenReaderOn, setScreenReader } from '../services/screenReader';
import { RATE_MAX, RATE_MIN, RATE_STEP, getSpeechRate, setSpeechRate, speak } from '../services/speech';
import type { Navigate } from '../state/navigation';

export function SettingsScreen({ navigate }: { navigate: Navigate }) {
  const [speech, setSpeech] = useState(isSpeechEnabled());
  const [reader, setReader] = useState(isScreenReaderOn());
  const [muted, setMutedState] = useState(isMuted());
  const [rate, setRate] = useState(getSpeechRate());

  const changeRate = (delta: number) => {
    const r = setSpeechRate(rate + delta);
    setRate(r);
    speak(`السرعة ${formatRate(r)}`, true);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="screen" aria-labelledby="settings-title">
      <header className="topbar">
        <h1 id="settings-title">الإعدادات</h1>
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
      </header>

      <section aria-labelledby="sec-sound" className="stack">
        <h2 id="sec-sound">الصوت</h2>
        <Switch
          label="كتم عام لجميع الأصوات"
          checked={muted}
          onChange={(on) => { setMutedState(on); setMuted(on); }}
          description="يكتم مؤثرات اللعبة. النطق وقارئ الشاشة لهما إعدادات منفصلة."
        />
      </section>

      <section aria-labelledby="sec-a11y" className="stack">
        <h2 id="sec-a11y">إمكانية الوصول</h2>
        <Switch
          label="نطق أحداث اللعبة بصوت التطبيق"
          checked={speech}
          onChange={(on) => { setSpeech(on); setSpeechEnabled(on); }}
          description="لمن لا يستخدم قارئ شاشة. مع TalkBack أو VoiceOver اتركه مغلقاً: قارئك ينطق الأحداث تلقائياً."
        />

        <Switch
          label="قارئ الشاشة المدمج"
          checked={reader}
          onChange={(on) => { setReader(on); setScreenReader(on); }}
          description="المس أي عنصر لسماعه، والمس مرتين لتفعيله، واسحب يميناً أو يساراً للتنقل، وإصبعين للتمرير. إذا كنت تستخدم TalkBack أو VoiceOver فاترك هذا الخيار مغلقاً."
        />

        <h3 id="rate-title" style={{ margin: '6px 0 0', fontSize: 17 }}>سرعة النطق</h3>
        <div className="rate-row" role="group" aria-labelledby="rate-title">
          <button className="secondary" onClick={() => changeRate(-RATE_STEP)} disabled={rate <= RATE_MIN}>أبطأ</button>
          <output aria-live="polite" aria-label={`السرعة الحالية ${formatRate(rate)}`}>{formatRate(rate)}</output>
          <button className="secondary" onClick={() => changeRate(RATE_STEP)} disabled={rate >= RATE_MAX}>أسرع</button>
        </div>
        <button className="secondary" onClick={() => speak('هذا مثال على سرعة النطق في مجلسك', true)}>تجربة النطق</button>
      </section>

      <section aria-labelledby="sec-account" className="stack">
        <h2 id="sec-account">الحساب</h2>
        <button
          className="secondary"
          onClick={async () => {
            try { await signOut((await connectFirebase()).auth); } catch { /* وضع التطوير بدون خادم */ }
            navigate('auth');
          }}
        >تسجيل الخروج</button>
        <button className="danger" onClick={() => setConfirmDelete(true)}>حذف الحساب</button>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="حذف الحساب"
          message="سيتم حذف حسابك وجميع عملاتك نهائياً. لا يمكن التراجع عن هذا الإجراء."
          confirmLabel="حذف نهائياً"
          danger
          onConfirm={() => setConfirmDelete(false) /* TODO: Cloud Function deleteAccount */}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </main>
  );
}

function formatRate(r: number) {
  return `${r.toLocaleString('ar-SA', { maximumFractionDigits: 2 })}×`;
}
