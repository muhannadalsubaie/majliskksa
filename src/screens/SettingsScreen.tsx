import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Switch } from '../components/Switch';
import { isMuted, setMuted } from '../services/preferences';
import { connectFirebase } from '../services/firebase';
import { ANNOUNCE_PACES, type AnnouncePace, announce, getAnnouncePace, isSpeechEnabled, setAnnouncePace, setSpeechEnabled } from '../services/announcer';
import { deleteMyAccount } from '../services/tables';
import { SITE_URL } from '../services/api';
import { isScreenReaderSettingOn, setScreenReader } from '../services/screenReader';
import { isSystemReaderOn } from '../services/nativeA11y';
import { RATE_MAX, RATE_MIN, RATE_STEP, getSpeechRate, setSpeechRate, speak } from '../services/speech';
import type { Navigate } from '../state/navigation';

/**
 * الإعدادات. تُفتح من القائمة الرئيسية كشاشة، أو من قائمة الطاولة (onClose) دون مغادرة الطاولة —
 * وهناك نُخفي قسم الحساب (الخروج وحذف الحساب) لأنه يُخرجك من اللعبة.
 */
export function SettingsScreen({ navigate, onClose }: { navigate: Navigate; onClose?: () => void }) {
  const embedded = Boolean(onClose);
  const Root = embedded ? 'div' : 'main';
  const [speech, setSpeech] = useState(isSpeechEnabled());
  const [reader, setReader] = useState(isScreenReaderSettingOn());
  const [muted, setMutedState] = useState(isMuted());
  const [rate, setRate] = useState(getSpeechRate());
  const [pace, setPace] = useState<AnnouncePace>(getAnnouncePace());

  const changeRate = (delta: number) => {
    const r = setSpeechRate(rate + delta);
    setRate(r);
    speak(`السرعة ${formatRate(r)}`, true);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Root className={embedded ? 'stack' : 'screen'} aria-labelledby="settings-title">
      <header className="topbar">
        <h1 id="settings-title">الإعدادات</h1>
        <button className="secondary back-btn" onClick={() => (onClose ? onClose() : navigate('menu'))}>رجوع</button>
      </header>

      <section aria-labelledby="sec-sound" className="stack">
        <h2 id="sec-sound">الصوت</h2>
        <Switch
          label="كتم عام لجميع الأصوات"
          checked={muted}
          onChange={(on) => { setMutedState(on); setMuted(on); }}
          description="يكتم مؤثرات اللعبة (التوزيع، رمي الورق، القطع، المشاريع). النطق وقارئ الشاشة لهما إعدادات منفصلة."
        />
      </section>

      <section aria-labelledby="sec-reader" className="stack">
        <h2 id="sec-reader">قارئ الشاشة المدمج</h2>
        <Switch
          label="تفعيل قارئ الشاشة المدمج"
          checked={reader}
          onChange={(on) => { setReader(on); setScreenReader(on); }}
          description={isSystemReaderOn()
            ? 'TalkBack أو VoiceOver يعمل الآن، لذلك القارئ المدمج متوقف تلقائياً. أحداث اللعبة تُعلن عبر قارئك مباشرة.'
            : 'مغلق افتراضياً. لمن لا يستخدم TalkBack أو VoiceOver: المس أي عنصر لسماعه، والمس مرتين لتفعيله، واسحب يميناً أو يساراً للتنقل، وإصبعين للتمرير. وفي الطاولة اسحب بإصبعين: من اليمين لليسار لأوراق الطاولة، ومن اليسار لليمين لنوع اللعب ومن اشترى، ومن تحت لفوق للمشاريع.'}
        />
        {reader && (
          <>
            <h3 id="rate-title" style={{ margin: '6px 0 0', fontSize: 17 }}>سرعة النطق</h3>
            <div className="rate-row" role="group" aria-labelledby="rate-title">
              <button className="secondary" onClick={() => changeRate(-RATE_STEP)} disabled={rate <= RATE_MIN}>أبطأ</button>
              <output aria-live="polite" aria-label={`السرعة الحالية ${formatRate(rate)}`}>{formatRate(rate)}</output>
              <button className="secondary" onClick={() => changeRate(RATE_STEP)} disabled={rate >= RATE_MAX}>أسرع</button>
            </div>
            <button className="secondary" onClick={() => speak('هذا مثال على سرعة النطق في مجلسك', true)}>تجربة النطق</button>
          </>
        )}
      </section>

      <section aria-labelledby="sec-speech" className="stack">
        <h2 id="sec-speech">نطق الأحداث</h2>
        <h3 id="pace-title" style={{ margin: '6px 0 0', fontSize: 17 }}>سرعة إعلانات اللعب</h3>
        <p className="note" style={{ margin: 0 }}>
          كم ينتظر التطبيق بين إعلان وآخر حتى لا يقطع قارئ الشاشة جملته. جرّب بزر "تجربة الإعلانات": إن انقطعت جملة قبل أن تكتمل اختر سرعة أبطأ، وإن كان الانتظار طويلاً اختر أسرع.
        </p>
        <div className="rate-row" role="radiogroup" aria-labelledby="pace-title" style={{ flexWrap: 'wrap' }}>
          {ANNOUNCE_PACES.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={pace === p.id}
              className={pace === p.id ? '' : 'secondary'}
              onClick={() => { setPace(p.id); setAnnouncePace(p.id); announce(`سرعة الإعلانات ${p.label}`); }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* أربع حركات متتالية كما في اللعب: إن انقطع أي منها اختر سرعة أبطأ */}
        <button className="secondary" onClick={() => {
          // كل حركة تصل بعد الأخرى بلحظة، كما يلعب الروبوتات
          ['سالم رمى 10 شريا', 'فهد رمى الإكه شريا', 'علي رمى 7 شريا', 'يوسف رمى 8 شريا', 'الأكلة لسالم، دور سالم']
            .forEach((m, i) => setTimeout(() => announce(m), i * 600));
        }}>تجربة الإعلانات</button>
        <Switch
          label="نطق أحداث اللعبة بصوت التطبيق"
          checked={speech}
          onChange={(on) => { setSpeech(on); setSpeechEnabled(on); }}
          description="لمن لا يستخدم أي قارئ شاشة. مع TalkBack أو VoiceOver اتركه مغلقاً: قارئك ينطق الأحداث تلقائياً."
        />
      </section>

      {!embedded && (
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
        <a className="note" href={`${SITE_URL}/privacy.html`} target="_blank" rel="noopener">سياسة الخصوصية</a>
      </section>
      )}

      {/* شكر وحقوق في آخر الصفحة بخط صغير: رخصة صور الكروت (LGPL) تشترط ذكرها مع رابط المصدر والرخصة */}
      <footer className="credits">
        <p>
          صور الكروت: SVG-cards لديفيد بيلو (David Bellot)، رخصة LGPL-2.1 —{' '}
          <a href="https://github.com/htdebeer/SVG-cards" target="_blank" rel="noopener">المصدر</a>،{' '}
          <a href={`${SITE_URL}/cards/LICENSE-svg-cards.txt`} target="_blank" rel="noopener">الرخصة</a>
        </p>
        <p>المؤثرات الصوتية: Kenney، رخصة CC0</p>
      </footer>

      {confirmDelete && (
        <ConfirmDialog
          title="حذف الحساب"
          message="سيتم حذف حسابك نهائياً: اسم المستخدم، والعملات، وقائمة الأصدقاء، وبيانات الدخول. لا يمكن التراجع عن هذا الإجراء."
          confirmLabel="حذف نهائياً"
          danger
          onConfirm={async () => {
            setConfirmDelete(false);
            announce('جارٍ حذف الحساب…');
            try {
              await deleteMyAccount();
              try { await signOut((await connectFirebase()).auth); } catch { /* الحساب حُذف أصلاً */ }
              announce('تم حذف حسابك نهائياً');
              navigate('auth');
            } catch {
              announce('تعذّر حذف الحساب الآن، حاول مرة أخرى');
            }
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Root>
  );
}

function formatRate(r: number) {
  return `${r.toLocaleString('ar-SA', { maximumFractionDigits: 2 })}×`;
}
