// مؤثرات اللعبة الصوتية — مولّدة بالكامل بـ Web Audio (بلا ملفات صوت ولا حقوق):
// توزيع الورق، رمي الورقة، القطع بالحكم، والمشاريع والبلوت.
// تحترم "كتم عام لجميع الأصوات" في الإعدادات، وصوتها هادئ حتى لا يغطي قارئ الشاشة.
import { isMuted } from './preferences';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (isMuted()) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// المتصفح لا يسمح بالصوت قبل أول لمسة: نجهّز المحرك عندها
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** نفثة ضجيج مرشّحة: صوت ورق يحتك/ينزل على الطاولة */
function flick(ac: AudioContext, at: number, { freq = 2600, q = 0.9, gain = 0.35, dur = 0.07 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at, Math.random() * 0.3, dur + 0.02);
}

function tone(ac: AudioContext, at: number, freq: number, { dur = 0.35, gain = 0.12, type = 'sine' as OscillatorType, endFreq = 0 } = {}) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export const sounds = {
  /** توزيع: سلسلة نقرات ورق سريعة */
  deal(cards = 8) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    for (let i = 0; i < cards; i++) flick(ac, t + i * 0.065, { freq: 2200 + Math.random() * 900, gain: 0.22, dur: 0.05 });
  },

  /** رمي ورقة على الطاولة */
  card() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    flick(ac, t, { freq: 1800, q: 0.7, gain: 0.4, dur: 0.09 });
    tone(ac, t, 180, { dur: 0.06, gain: 0.05, endFreq: 90 });
  },

  /** القطع بالحكم: ضربة أقوى مع خبطة منخفضة */
  cut() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    flick(ac, t, { freq: 1400, q: 0.6, gain: 0.6, dur: 0.12 });
    tone(ac, t, 140, { dur: 0.22, gain: 0.3, type: 'triangle', endFreq: 55 });
    flick(ac, t + 0.03, { freq: 3200, q: 1.2, gain: 0.18, dur: 0.06 });
  },

  /** إعلان مشروع: رنين صاعد */
  project() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => tone(ac, t + i * 0.09, f, { dur: 0.5, gain: 0.1 }));
  },

  /** بلوت: نغمتان مميزتان */
  baloot() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, t, 880, { dur: 0.3, gain: 0.1, type: 'triangle' });
    tone(ac, t + 0.14, 1174.66, { dur: 0.45, gain: 0.1, type: 'triangle' });
  },
};
