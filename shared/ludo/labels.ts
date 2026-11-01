// نصوص لودو لقارئ الشاشة والإعلانات.
import {
  type LudoState, type Progress, type TokenRef, FINISH, LAST_TRACK, SAFE, STARTS, absPos, capturesAt, controlledOwner, isSafeSpot, onTrack, teamOf,
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
 * رقم الخانة لقارئ الشاشة: خانات المسار مرقّمة من 0 (خانة بدايتك) إلى 51 باتجاه اللعب،
 * فتعرف بُعد كل حجر عن غيره. (للمشاهد: من خانة بداية اللاعب الأول)
 */
export function squareNumber(owner: number, p: Progress, me: number): number {
  const base = STARTS[me >= 0 ? me : 0];
  return (absPos(owner, p) - base + 52) % 52;
}

/** مكان الحجر برقم الخانة، وهل هو في أمان */
export function squareText(s: LudoState, owner: number, p: Progress, me: number): string {
  if (p === -1) return 'في البيت';
  if (p === FINISH) return 'وصل المنزل';
  if (p > LAST_TRACK) return `في ${owner === me ? 'ممر المنزل' : 'ممر منزله'}، الخانة ${p - LAST_TRACK} من 6`;
  const safety = safetyText(s, owner, p);
  return `في الخانة ${squareNumber(owner, p, me)}${safety ? `، ${safety}` : ''}`;
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
export function optionText(s: LudoState, seat: number, index: number, names: string[]): string {
  const owner = controlledOwner(s, seat);
  const from = s.tokens[owner][index];
  const roll = s.dice ?? 0;
  const to = from === -1 ? 0 : from + roll;
  const who = owner === seat ? `حجرك ${index + 1}` : `حجر ${names[owner]} ${index + 1}`;
  const parts = [from === -1 ? `${who}: يطلع من البيت` : `${who}: يتقدم ${rollName(roll)}`];
  const caps = capturesAt(s, owner, to);
  if (caps.length) parts.push(`يأكل ${caps.map((c) => tokenName(c, names, seat)).join(' و')}`);
  if (to === FINISH) parts.push('ويصل المنزل');
  else if (to > LAST_TRACK && from <= LAST_TRACK) parts.push('ويدخل ممر المنزل');
  else if (onTrack(to) && to > 0 && SAFE.has(absPos(owner, to))) parts.push('إلى خانة آمنة');
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

/** إعلان آخر حركة للجميع */
/** withRoll = false: الرمية أُعلنت قبل الحركة (اللعب على الطاولة)، فلا نكررها */
export function moveAnnouncement(s: LudoState, names: string[], me: number, withRoll = true): string[] {
  const r = s.lastMove;
  if (!r) return [];
  const who = r.seat === me ? 'أنت' : names[r.seat];
  if (r.threeSixes) return [`${who} رمى ستة ثالثة، ضاع الدور`];
  if (!r.token) return [`${who} رمى ${rollName(r.roll)}، لا حركة${r.extraTurn ? '، ويرمي مرة أخرى' : ''}`];
  const t = tokenName(r.token, names, me);
  const step = r.finished ? 'وصل المنزل' : `يتقدم ${rollName(r.roll)}`;
  const out = withRoll
    ? [r.from === -1 ? `${who} رمى ستة، وطلّع ${t}` : `${who} رمى ${rollName(r.roll)}، ${t} ${step}`]
    : [r.from === -1 ? `${who} طلّع ${r.token.owner === r.seat && r.seat !== me ? `حجره ${r.token.index + 1}` : t}` : `${t} ${step}`];
  for (const c of r.captured) out.push(`أكل ${tokenName(c, names, me)}، ورجع للبيت`);
  // بعد الحركة: هل الحجر في أمان؟
  if (!r.finished && r.to !== null) {
    const safety = safetyText(s, r.token.owner, r.to);
    if (safety) out.push(`${t} ${safety}`);
  }
  if (s.phase === 'over' && s.winner !== null) {
    if (s.rules.teams) out.push(teamOf(me) === s.winner ? 'فاز فريقك!' : `فاز فريق ${names[s.winner]} و${names[s.winner + 2]}`);
    else out.push(s.winner === me ? 'فزت!' : `فاز ${names[s.winner]}`);
  } else if (r.extraTurn) out.push(`${r.seat === me ? 'ترمي' : 'يرمي'} مرة أخرى`);
  return out;
}

/** ملخص اللوحة: أحجار كل لاعب وأماكنها */
export function boardSummary(s: LudoState, names: string[], me: number): string {
  return s.seats.map((o) => {
    const who = o === me ? 'أحجارك' : `أحجار ${names[o]}`;
    return `${who}: ${s.tokens[o].map((p, i) => `${i + 1} ${squareText(s, o, p, me)}`).join('، ')}`;
  }).join('. ');
}
