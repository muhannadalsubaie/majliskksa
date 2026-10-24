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
  useEffect(() => () => disposeVoice(), []);

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

  const others = view.voice.filter((m) => m.uid !== uid);
  const label = voice.busy ? 'المحادثة الصوتية: جارٍ الانضمام'
    : !voice.joined ? 'المحادثة الصوتية: غير منضم. اضغط مطولاً للانضمام'
      : voice.muted ? 'المحادثة الصوتية: الميكروفون مكتوم. اضغط لفتحه، أو مطولاً للمغادرة'
        : 'المحادثة الصوتية: الميكروفون مفتوح. اضغط للكتم، أو مطولاً للمغادرة';

  return (
    <div className="voice-dock">
      {others.length > 0 && (
        <p className="voice-people">
          في المحادثة: {others.map((m) => `${m.username}${m.muted ? ' (مكتوم)' : ''}`).join('، ')}
        </p>
      )}
      <button
        className={`voice-btn ${!voice.joined ? 'off' : voice.muted ? 'muted' : ''}`}
        aria-label={label}
        aria-pressed={voice.joined && !voice.muted}
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
        {voice.joined && !voice.muted ? '🎙️' : '🔇'}
      </button>
    </div>
  );
}
