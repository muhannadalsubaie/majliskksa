import { useEffect, useRef } from 'react';
import type { TableView } from '../../shared/table';
import { announce } from '../services/announcer';
import { disposeVoice, joinVoice, leaveVoice, setVoiceMuted, syncVoice, useVoice } from '../services/voice';

const LONG_PRESS_MS = 600;

/**
 * زر المحادثة الصوتية — متاح للاعبين والمشاهدين.
 * ضغطة عادية: تشغيل/كتم الميكروفون. ضغطة طويلة: انضمام/مغادرة.
 * مع TalkBack: النقر مرتين = ضغطة، والنقر مرتين مع الإبقاء = ضغطة طويلة.
 * لوحة المفاتيح: Enter = كتم/فتح، Shift+Enter = انضمام/مغادرة.
 * لا انضمام تلقائي، ويبدأ الميكروفون مكتوماً (استماع فقط).
 */
export function VoiceButton({ view, uid }: { view: TableView; uid: string }) {
  const voice = useVoice();
  const timer = useRef<number | null>(null);
  const handled = useRef(false);

  // أصوات المنضمين تتبع حالة الطاولة
  useEffect(() => { void syncVoice(view.voice); }, [view.voice]);
  // كل من يدخل الطاولة ينضم تلقائياً مستمعاً، وميكروفونه مقفل حتى يفتحه بنفسه
  useEffect(() => {
    void joinVoice(view.id, uid, 'auto');
    return () => disposeVoice();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleJoin = () => {
    if (voice.busy) return;
    if (voice.joined) void leaveVoice();
    else void joinVoice(view.id, uid);
  };

  const toggleMute = () => {
    if (!voice.joined) { announce('اضغط مطولاً للانضمام إلى المحادثة الصوتية'); return; }
    void setVoiceMuted(!voice.muted);
  };

  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const onDown = () => {
    handled.current = false;
    clear();
    timer.current = window.setTimeout(() => { handled.current = true; toggleJoin(); }, LONG_PRESS_MS);
  };

  // الكل ينضم تلقائياً، فنعرض فقط من فتح ميكروفونه
  const others = view.voice.filter((m) => m.uid !== uid && m.mic && !m.muted);
  // الحالة نصاً واضحاً (يُكتب على الزر ويُقرأ)، ومعها تلميح بما تفعله الضغطة
  const status = voice.busy ? 'جارٍ الاتصال بالمحادثة الصوتية'
    : !voice.joined ? 'أنت خارج المحادثة الصوتية'
      : voice.muted ? 'الميكروفون مغلق' : 'الميكروفون مفتوح';
  const hint = voice.busy ? ''
    : !voice.joined ? 'اضغط مطولاً للانضمام'
      : voice.muted ? 'اضغط لفتحه، أو مطولاً للخروج من المحادثة' : 'اضغط لإغلاقه، أو مطولاً للخروج من المحادثة';
  const label = hint ? `${status}، ${hint}` : status;

  return (
    <div className="voice-dock">
      {others.length > 0 && (
        <p className="voice-people">
          الميكروفون مفتوح عند: {others.map((m) => m.username).join('، ')}
        </p>
      )}
      <button
        className={`voice-btn ${!voice.joined ? 'off' : voice.muted ? 'muted' : ''}`}
        aria-label={label}
        disabled={voice.busy}
        onPointerDown={onDown}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onClick={() => {
          // الضغطة الطويلة نُفذت بالفعل: نتجاهل النقرة التي تليها
          if (handled.current) { handled.current = false; return; }
          clear();
          toggleMute();
        }}
        onContextMenu={(e) => {
          // الضغط المطوّل من TalkBack (أو المتصفح) يصل كقائمة سياق
          e.preventDefault();
          clear();
          if (!handled.current) {
            handled.current = true;
            toggleJoin();
            window.setTimeout(() => { handled.current = false; }, 800);
          }
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); toggleJoin(); } }}
      >
        {status}
      </button>
    </div>
  );
}
