// نصوص لودو لقارئ الشاشة والإعلانات.
import {
  type LudoState, type Progress, type TokenRef, FINISH, LAST_TRACK, SAFE, absPos, capturesAt, controlledOwner, isSafeSpot, onTrack, teamOf,
} from './engine';

export const COLOR_NAMES = ['الأحمر', 'الأزرق', 'الأصفر', 'الأخضر'];

const NUM = ['', 'واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة'];
export const rollName = (n: number) => NUM[n] ?? String(n);

/** "حجرك 2" أو "حجر سالم 3" */
export function tokenName(r: TokenRef, names: string[], me: number): string {
  return r.owner === me ? `حجرك ${r.index + 1}` : `حجر ${names[r.owner]} ${r.index + 1}`;
}

/** هل الحجر في أمان: خانة آمنة، أو في خطر (خصم خلفه قريب)، أو في أمان (ما فيه خصم يقدر يوصله) */
export function safetyText(s: LudoState, owner: number, p: Progress): string {
  if (p === -1 || p === FINISH) return '';
  if (p > LAST_TRACK) return 'في أمان';
  if (SAFE.has(absPos(owner, p))) return 'في خانة آمنة';
  // قطعتين أو أكثر من نفس اللون على خانة = حاجز ما ينأكل
  if (s.tokens[owner].filter((q) => q === p).length >= 2) return 'في حاجز، ما ينأكل';
  return danger(s, owner, p) ? 'في خطر، خصم خلفه قريب' : 'في أمان';
}

/**
 * رقم الخانة: خانات المسار مرقّمة من 1 إلى 52 باتجاه اللعب، ثابتة للجميع (نفس الأرقام المرسومة
 * على اللوحة عند كل لاعب)، فكل اللاعبين يسمعون نفس الرقم لنفس الخانة.
 */
export function squareNumber(owner: number, p: Progress, _me: number): number {
  return absPos(owner, p) + 1;
}

/** مكان الحجر برقم الخانة، و"منطقة أمان" بس لو كان على خانة أمان من خانات اللوحة */
export function squareText(_s: LudoState, owner: number, p: Progress, me: number): string {
  if (p === -1) return 'في البيت';
  if (p === FINISH) return 'وصل المنزل';
  if (p > LAST_TRACK) return `في ${owner === me ? 'ممر المنزل' : 'ممر منزله'}، الخانة ${p - LAST_TRACK} من 6`;
  return `في الخانة ${squareNumber(owner, p, me)}${SAFE.has(absPos(owner, p)) ? '، منطقة أمان' : ''}`;
}

/** رقم المكان في إعلان الحركة: رقم الخانة، أو ممر المنزل، أو المنزل */
function spotText(owner: number, p: Progress, me: number): string {
  if (p === -1) return 'البيت';
  if (p === FINISH) return 'المنزل';
  if (p > LAST_TRACK) return `ممر المنزل ${p - LAST_TRACK}`;
  return String(squareNumber(owner, p, me));
}

/**
 * إعلانات اللودو تُكتب مرة للجميع بعلامات ⟦…⟧، وتُكمَّل لكل واحد قبل ما توصله:
 * أرقام الخانات من خانة بدايته (نفس أرقام لوحته)، و"أنت" بدل اسمه.
 *   ⟦v|مقعد|نص لك|نص لغيرك (%n = اسمه)⟧  ⟦sq|المالك|المكان⟧  ⟦tok|المالك|رقم الحجر⟧  ⟦team|الفريق⟧
 */
export function personalize(text: string, names: string[], me: number): string {
  if (!text.includes('⟦')) return text;
  return text.replace(/⟦([^⟧]*)⟧/g, (_m, body: string) => {
    const [k, a, b, c] = body.split('|');
    const x = Number(a);
    switch (k) {
      case 'v': return x === me ? b : (c ?? '').replace('%n', names[x] ?? '');
      case 'sq': return spotText(x, Number(b) as Progress, me);
      case 'tok': return tokenName({ owner: x, index: Number(b) }, names, me);
      case 'team': return me >= 0 && teamOf(me) === x ? 'فاز فريقك!' : `فاز فريق ${names[x] ?? ''} و${names[x + 2] ?? ''}`;
      default: return '';
    }
  });
}

/** أين الحجر (ومع الحالة: هل هو في أمان) */
export function placeText(owner: number, p: Progress, s?: LudoState): string {
  if (p === -1) return 'في البيت';
  if (p === FINISH) return 'وصل المنزل';
  if (p > LAST_TRACK) return `في ممر المنزل، باقي ${FINISH - p} للمنزل`;
  const safety = s ? safetyText(s, owner, p) : SAFE.has(absPos(owner, p)) ? 'خانة آمنة' : '';
  if (p === 0) return `على خانة البداية${safety ? `، ${safety}` : ''}`;
  return `على المسار، باقي ${FINISH - p} للمنزل${safety ? `، ${safety}` : ''}`;
}

/** نص خيار تحريك حجر (زر لقارئ الشاشة): أين يصل وماذا يحدث */
export function optionText(s: LudoState, seat: number, index: number, names: string[], die?: number): string {
  const owner = controlledOwner(s, seat);
  const from = s.tokens[owner][index];
  const roll = die ?? s.dice ?? 0;
  const to = from === -1 ? 0 : from + roll;
  const who = owner === seat ? `حجرك ${index + 1}` : `حجر ${names[owner]} ${index + 1}`;
  const parts = [from === -1 ? `${who}: يطلع من البيت` : `${who}: يتقدم ${rollName(roll)}، من ${spotText(owner, from, seat)} إلى ${spotText(owner, to, seat)}`];
  const caps = capturesAt(s, owner, to);
  if (caps.length) parts.push(`يأكل ${caps.map((c) => tokenName(c, names, seat)).join(' و')}`);
  if (to === FINISH) parts.push('ويصل المنزل');
  else if (to > LAST_TRACK && from <= LAST_TRACK) parts.push('ويدخل ممر المنزل');
  else if (onTrack(to) && SAFE.has(absPos(owner, to))) parts.push('منطقة أمان');
  else if (onTrack(to) && danger(s, owner, to)) parts.push('تحذير: خصم خلفه قريب');
  return parts.join('، ');
}

/** هل يوجد حجر خصم خلف هذه الخانة بمسافة 1 إلى 6 (يستطيع أكله)؟ */
export function danger(s: LudoState, owner: number, p: Progress): boolean {
  if (isSafeSpot(owner, p)) return false;
  const sq = absPos(owner, p);
  return s.seats.some((o) => o !== owner && !(s.rules.teams && teamOf(o) === teamOf(owner)) &&
    s.tokens[o].some((q) => onTrack(q) && ((sq - absPos(o, q) + 52) % 52) >= 1 && ((sq - absPos(o, q) + 52) % 52) <= 6 && q + ((sq - absPos(o, q) + 52) % 52) <= LAST_TRACK));
}

/**
 * إعلان آخر حركة للجميع (بعلامات تُكمَّل لكل واحد بـ personalize):
 * "أنت تحركت من 5 إلى 8"، "سالم تحرك من 26 إلى 29"، و"منطقة أمان" بس لو وقف على خانة أمان.
 * withRoll = false: الرمية أُعلنت قبل الحركة (اللعب على الطاولة)، فلا نكررها
 */
export function moveAnnouncement(s: LudoState, _names: string[], _me: number, withRoll = true): string[] {
  const r = s.lastMove;
  if (!r) return [];
  const seat = r.seat;
  const who = (meText: string, otherText: string) => `⟦v|${seat}|${meText}|${otherText}⟧`;
  const roll = rollName(r.roll);
  if (r.threeSixes) return [who('رميت ستة ثالثة، ضاع دورك', '%n رمى ستة ثالثة، ضاع الدور')];
  if (r.rollAgain) return [who('رميت ستة، ارمِ مرة ثانية', '%n رمى ستة، ويرمي مرة ثانية')];
  if (!r.token) {
    return [who(`رميت ${roll}، ما عندك حركة`, `%n رمى ${roll}، لا حركة`) + (r.extraTurn ? who('، وترمي مرة أخرى', '، ويرمي مرة أخرى') : '')];
  }
  const { owner } = r.token;
  // تلعب بأحجار شريكك بعد ما خلصت أحجارك
  const other = owner !== seat ? ` ⟦tok|${owner}|${r.token.index}⟧` : '';
  let line: string;
  if (r.from === -1) {
    line = withRoll
      ? who(`رميت ستة، وطلّعت${other ? ` ${other.trim()}` : ' حجر'}`, `%n رمى ستة، وطلّع${other ? ` ${other.trim()}` : ' حجر'}`)
      : who(`أنت طلّعت${other ? ` ${other.trim()}` : ' حجر'}`, `%n طلّع${other ? ` ${other.trim()}` : ' حجر'}`);
    line += ` إلى ⟦sq|${owner}|0⟧`;
  } else {
    const path = `من ⟦sq|${owner}|${r.from}⟧ إلى ⟦sq|${owner}|${r.to}⟧`;
    line = withRoll
      ? who(`رميت ${roll}، و${other ? `حرّكت${other}` : 'تحركت'}`, `%n رمى ${roll}، و${other ? `حرّك${other}` : 'تحرك'}`) + ` ${path}`
      : who(`أنت ${other ? `حرّكت${other}` : 'تحركت'}`, `%n ${other ? `حرّك${other}` : 'تحرك'}`) + ` ${path}`;
  }
  const out = [line];
  for (const c of r.captured) out.push(who('أكلت', '%n أكل') + ` ⟦tok|${c.owner}|${c.index}⟧، ورجع للبيت`);
  // "منطقة أمان" بس على خانات الأمان المرسومة في اللوحة
  if (!r.finished && r.to !== null && onTrack(r.to) && SAFE.has(absPos(owner, r.to))) out.push('في منطقة أمان');
  if (s.phase === 'over' && s.winner !== null) {
    out.push(s.rules.teams ? `⟦team|${s.winner}⟧` : `⟦v|${s.winner}|فزت!|فاز %n⟧`);
  } else if (r.extraTurn) out.push(who('ترمي مرة أخرى', '%n يرمي مرة أخرى'));
  return out;
}

/** ملخص اللوحة: أحجار كل لاعب وأماكنها */
export function boardSummary(s: LudoState, names: string[], me: number): string {
  return s.seats.map((o) => {
    const who = o === me ? 'أحجارك' : `أحجار ${names[o]}`;
    return `${who}: ${s.tokens[o].map((p, i) => `${i + 1} ${squareText(s, o, p, me)}`).join('، ')}`;
  }).join('. ');
}
