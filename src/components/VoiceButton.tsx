import { useRef, useState } from 'react';
import VivoxVoice from '../plugins/vivox-voice-plugin';
import { announce } from '../services/announcer';

const LONG_PRESS_MS = 600;

/**
 * زر المحادثة الصوتية — متاح للاعبين والمشاهدين.
 * ضغطة عادية: تشغيل/كتم الميكروفون. ضغطة طويلة: انضمام/مغادرة.
 * لوحة المفاتيح: Enter = كتم/فتح، Shift+Enter = انضمام/مغادرة.
 * لا انضمام تلقائي، ويبدأ الميكروفون مكتوماً (استماع فقط).
 */
export function VoiceButton({ channelName }: { channelName: string }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const toggleJoin = async () => {
    if (joined) {
      await VivoxVoice.leaveChannel();
      setJoined(false);
      announce('غادرت المحادثة الصوتية');
    } else {
      // TODO: جلب التوكن من Cloud Function (getVivoxJoinToken) بدلاً من قيمة فارغة
      await VivoxVoice.joinChannel({ token: '', channelName });
      await VivoxVoice.setMicrophoneMuted({ muted: true });
      setJoined(true);
      setMuted(true);
      announce('انضممت للمحادثة الصوتية، الميكروفون مكتوم');
    }
  };

  const toggleMute = async () => {
    if (!joined) { announce('اضغط مطولاً للانضمام إلى المحادثة الصوتية'); return; }
    const next = !muted;
    await VivoxVoice.setMicrophoneMuted({ muted: next });
    setMuted(next);
    announce(next ? 'تم كتم الميكروفون' : 'الميكروفون مفتوح');
  };

  const onDown = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => { longPressed.current = true; void toggleJoin(); }, LONG_PRESS_MS);
  };
  const onUp = () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!longPressed.current) void toggleMute();
  };

  const label = !joined
    ? 'المحادثة الصوتية: غير منضم. اضغط مطولاً للانضمام'
    : muted ? 'المحادثة الصوتية: الميكروفون مكتوم. اضغط لفتحه، أو مطولاً للمغادرة'
      : 'المحادثة الصوتية: الميكروفون مفتوح. اضغط للكتم، أو مطولاً للمغادرة';

  return (
    <button
      className={`voice-btn ${!joined ? 'off' : muted ? 'muted' : ''}`}
      aria-label={label}
      aria-pressed={joined && !muted}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={() => timer.current && window.clearTimeout(timer.current)}
      onClick={(e) => { if (e.detail === 0) void toggleMute(); /* تفعيل من لوحة المفاتيح */ }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void toggleJoin(); } }}
    >
      {joined && !muted ? '🎙️' : '🔇'}
    </button>
  );
}
