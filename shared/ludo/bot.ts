// لاعب آلي للودو: يرمي النرد، ثم يقيّم كل حجر يمكن تحريكه —
// الأكل أولاً، ثم الوصول للوسط، ثم الإخراج من البيت، ثم الهروب من الخطر والخانات الآمنة، ثم التقدم.
import { type LudoAction, type LudoState, FINISH, LAST_TRACK, absPos, capturesAt, controlledOwner, moveOptions, SAFE, onTrack } from './engine';
import { danger } from './labels';

export function ludoBotAction(s: LudoState, seat: number): LudoAction | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll', seat };
  const options = moveOptions(s, seat);
  if (!options.length) return null;
  const owner = controlledOwner(s, seat);
  let best = options[0], bestScore = -Infinity;
  for (const o of options) {
    const i = o.token;
    const from = s.tokens[owner][i];
    const to = from === -1 ? 0 : from + o.die;
    let score = 0;
    score += capturesAt(s, owner, to).length * 100;
    if (to === FINISH) score += 80;
    if (from === -1) score += 60;
    if (to > LAST_TRACK && from <= LAST_TRACK) score += 40;
    if (onTrack(from) && danger(s, owner, from)) score += 30;
    if (onTrack(to) && SAFE.has(absPos(owner, to))) score += 20;
    if (onTrack(to) && danger(s, owner, to)) score -= 35;
    score += to / 10;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return { type: 'move', seat, token: best.token, die: best.die };
}
