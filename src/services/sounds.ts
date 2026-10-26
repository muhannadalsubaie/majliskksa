// مؤثرات اللعبة الصوتية: تسجيلات حقيقية لورق اللعب (حزمة Kenney "Casino Audio"، رخصة CC0)
// في public/sounds — خلط وتوزيع الورق، رمي الورقة، القطع بالحكم، والمشاريع والبلوت.
// تحترم "كتم عام لجميع الأصوات" في الإعدادات، وصوتها معتدل حتى لا يغطي قارئ الشاشة.
import { isMuted } from './preferences';

const FILES = [
  'card1', 'card2', 'card3', 'card4',
  'slide1', 'slide2', 'slide3', 'slide4',
  'shove1', 'shove2', 'shove3', 'shove4',
  'shuffle', 'fan', 'chips1', 'chips2', 'collide',
] as const;
type SoundName = (typeof FILES)[number];

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let loading: Promise<void> | null = null;

function audio(): AudioContext | null {
  if (isMuted()) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    void load();
    return ctx;
  } catch {
    return null;
  }
}

/** تحميل الأصوات مرة واحدة (صغيرة: ~200 كيلوبايت كلها) */
function load(): Promise<void> {
  if (loading || !ctx) return loading ?? Promise.resolve();
  const ac = ctx;
  loading = Promise.all(FILES.map(async (name) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/${name}.mp3`);
      buffers.set(name, await ac.decodeAudioData(await res.arrayBuffer()));
    } catch { /* صوت ناقص لا يوقف اللعبة */ }
  })).then(() => {});
  return loading;
}

// المتصفح لا يسمح بالصوت قبل أول لمسة: نجهّز المحرك ونحمّل الأصوات عندها
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function play(name: SoundName, { at = 0, gain = 0.8, rate = 1 } = {}) {
  const ac = audio();
  const buf = buffers.get(name);
  if (!ac || !buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  // اختلاف بسيط في الطبقة بين كل مرة حتى لا يبدو الصوت مكرراً
  src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ac.destination);
  src.start(ac.currentTime + at);
}

/** نغمة صناعية قصيرة (للمزايدة): طبقة ترن ثم تخفت بنعومة */
function tone(freq: number, { at = 0, dur = 0.35, gain = 0.25, type = 'sine' as OscillatorType } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export const sounds = {
  /** تحميل مبكر عند دخول الطاولة حتى لا يفوتنا أول صوت */
  preload() { audio(); },

  /** توزيع: خلط الورق في بداية الصكة، ثم انزلاق الأوراق للاعبين */
  deal(newHand: boolean) {
    if (newHand) {
      play('shuffle', { gain: 0.7 });
      for (let i = 0; i < 4; i++) play(pick(['slide1', 'slide2', 'slide3', 'slide4'] as const), { at: 1.1 + i * 0.12, gain: 0.6 });
    } else {
      for (let i = 0; i < 4; i++) play(pick(['slide1', 'slide2', 'slide3', 'slide4'] as const), { at: i * 0.12, gain: 0.6 });
    }
  },

  /** رمي ورقة على الطاولة */
  card() {
    play(pick(['card1', 'card2', 'card3', 'card4'] as const));
  },

  /** القطع بالحكم: ضربة ورقة أقوى على الطاولة */
  cut() {
    play(pick(['shove1', 'shove2', 'shove3', 'shove4'] as const), { gain: 1 });
    play(pick(['card1', 'card3'] as const), { at: 0.02, gain: 1, rate: 0.85 });
  },

  /** إعلان مشروع: فرد الأوراق ثم صوت الفيش */
  project() {
    play('fan', { gain: 0.6 });
    play('chips1', { at: 0.25, gain: 0.7 });
  },

  /** بلوت */
  baloot() {
    play('collide', { gain: 0.7 });
    play('chips2', { at: 0.15, gain: 0.7 });
  },

  // ===== المزايدة: صوت مميز لكل نوع حتى تعرفه بالسمع =====

  /** شراء حكم: رصّة فيش ونغمتان منخفضتان */
  hokm() {
    play('chips1', { gain: 0.8 });
    tone(392, { at: 0.05, dur: 0.3 });
    tone(523, { at: 0.18, dur: 0.45 });
  },

  /** صن (أو أشكل): نغمات صاعدة مشرقة */
  sun() {
    play('chips2', { gain: 0.7 });
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: 0.04 + i * 0.09, dur: 0.5, gain: 0.2, type: 'triangle' }));
  },

  /** تأكيد الحكم بعد أن قال الجميع بس */
  confirmHokm() {
    tone(523, { dur: 0.25, gain: 0.2 });
    tone(784, { at: 0.12, dur: 0.4, gain: 0.2 });
  },

  /** دبل/ثري/فور: طرقات قوية على الطاولة، تزيد وترتفع مع كل مستوى */
  double(level: number) {
    const knocks = Math.min(level, 4);
    for (let i = 0; i < knocks; i++) {
      play(pick(['shove1', 'shove2', 'shove3', 'shove4'] as const), { at: i * 0.16, gain: 1, rate: 0.8 });
    }
    play('collide', { at: knocks * 0.16, gain: 0.8 });
    tone(220 * 2 ** ((level - 2) / 4), { at: knocks * 0.16, dur: 0.6, gain: 0.22, type: 'sawtooth' });
  },

  /** قهوة: طرقات ثم نغمة طويلة */
  gahwa() {
    for (let i = 0; i < 3; i++) play(pick(['shove1', 'shove2', 'shove3', 'shove4'] as const), { at: i * 0.14, gain: 1, rate: 0.75 });
    play('collide', { at: 0.45, gain: 0.9 });
    [262, 330, 392, 523].forEach((f) => tone(f, { at: 0.5, dur: 1.2, gain: 0.12, type: 'triangle' }));
  },
};
