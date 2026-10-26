// مؤثرات اللعبة الصوتية: تسجيلات حقيقية لورق اللعب (حزمة Kenney "Casino Audio"، رخصة CC0)
// في public/sounds — خلط وتوزيع الورق، رمي الورقة، القطع بالحكم، والمشاريع والبلوت.
// تحترم "كتم عام لجميع الأصوات" في الإعدادات، وصوتها معتدل حتى لا يغطي قارئ الشاشة.
import { isMuted } from './preferences';

const FILES = [
  'card1', 'card2', 'card3', 'card4',
  'slide1', 'slide2', 'slide3', 'slide4',
  'shove1', 'shove2', 'shove3', 'shove4',
  'shuffle', 'fan', 'chips1', 'chips2', 'collide',
  // طرق على طاولة خشب وفنجان قهوة (Kenney "Impact Sounds"، CC0) — للمزايدة
  'knock1', 'knock2', 'knock3', 'knock4', 'tap1', 'cup1', 'cup2',
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
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/${name}.mp3?v=3`); // ?v= يتغير مع تحديث الملفات حتى لا تبقى نسخة قديمة مخزنة
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

function play(name: SoundName, { at = 0, gain = 0.8, rate = 1, vary = true } = {}): boolean {
  const ac = audio();
  const buf = buffers.get(name);
  if (!ac || !buf) return false;
  const src = ac.createBufferSource();
  src.buffer = buf;
  // اختلاف بسيط في الطبقة بين كل مرة حتى لا يبدو الصوت مكرراً
  src.playbackRate.value = rate * (vary ? 0.95 + Math.random() * 0.1 : 1);
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ac.destination);
  src.start(ac.currentTime + at);
  return true;
}

// صوت المزايدة يُشغَّل فوراً عند ضغطة المشتري، ثم يصل التحديث من الخادم: لا نكرره
const recent = new Map<string, number>();
function once(kind: string): boolean {
  const now = Date.now();
  if (now - (recent.get(kind) ?? 0) < 2500) return false;
  recent.set(kind, now);
  return true;
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

  // ===== المزايدة: أصوات طاولة حقيقية — ورقة تُضرب على الطاولة وطرقات بالأصابع =====

  /** شراء حكم: ضربة ورقة قوية على الطاولة ثم طرقة واحدة */
  hokm() {
    if (!once('hokm')) return;
    play(pick(['shove1', 'shove2', 'shove3', 'shove4'] as const), { gain: 1, rate: 0.9 });
    if (!play('knock1', { at: 0.12, gain: 1 })) tone(196, { at: 0.12, dur: 0.25, gain: 0.25 });
  },

  /** صن (أو أشكل): فرد الورق ثم ضربة على الطاولة وطرقتان سريعتان */
  sun() {
    if (!once('sun')) return;
    play('fan', { gain: 0.7 });
    play(pick(['shove1', 'shove3'] as const), { at: 0.22, gain: 1 });
    play('knock2', { at: 0.34, gain: 1 });
    play('knock3', { at: 0.46, gain: 0.9 });
  },

  /** تأكيد الحكم: نقرة خفيفة بالإصبع */
  confirmHokm() {
    if (!once('confirm')) return;
    if (!play('tap1', { gain: 0.9 })) play('card1', { gain: 0.8 });
  },

  /** دبل/ثري/فور: طرقات على الطاولة بعدد المستوى، أقوى مع كل مستوى */
  double(level: number) {
    if (!once(`double${level}`)) return;
    const knocks = Math.min(level, 4);
    const names = ['knock1', 'knock2', 'knock3', 'knock4'] as const;
    for (let i = 0; i < knocks; i++) {
      play(names[i % names.length], { at: i * 0.22, gain: Math.min(1, 0.75 + level * 0.07) });
    }
  },

  /** قهوة: ثلاث طرقات ثم صوت الفنجان */
  gahwa() {
    if (!once('gahwa')) return;
    (['knock1', 'knock2', 'knock3'] as const).forEach((n, i) => play(n, { at: i * 0.2, gain: 1 }));
    play('cup1', { at: 0.7, gain: 0.9 });
    play('cup2', { at: 0.95, gain: 0.7 });
  },
};
