import { type Card, type GameMode, type Rank, type Seat, type Suit, type Team, nextSeat, teamOf } from './cards';

export type ProjectKind = 'sira' | 'fifty' | 'hundred' | 'hundredFifty' | 'fourHundred';

export const PROJECT_ABNAT: Record<ProjectKind, number> = {
  sira: 20,
  fifty: 50,
  hundred: 100,
  hundredFifty: 150, // لم يعد يُستخدم (الأربعة أولاد صارت مية) — باقٍ لصكات قديمة محفوظة فقط
  fourHundred: 400, // أربع إكك في الصن (وفي الحكم مية)
};

export const PROJECT_NAMES: Record<ProjectKind, string> = {
  sira: 'سرا', fifty: 'خمسين', hundred: 'مية', hundredFifty: 'مية وخمسين', fourHundred: 'أربعمية',
};

export const BALOOT_ABNAT = 10;

export interface Project {
  kind: ProjectKind;
  cards: Card[];
  /** أعلى ورقة في المشروع (للمفاضلة بين مشروعين متساويين) */
  topRank: Rank;
}

// ترتيب التسلسل الطبيعي للمشاريع (بغض النظر عن الحكم)
const SEQ_ORDER: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
const seqIndex = (r: Rank) => SEQ_ORDER.indexOf(r);

const SEQ_KIND: Record<number, ProjectKind> = { 3: 'sira', 4: 'fifty', 5: 'hundred' };

function candidates(hand: Card[], mode: GameMode): Project[] {
  const out: Project[] = [];
  const suits = [...new Set(hand.map((c) => c.suit))] as Suit[];
  for (const suit of suits) {
    const idx = hand.filter((c) => c.suit === suit).map((c) => seqIndex(c.rank)).sort((a, b) => a - b);
    // كل تسلسل فرعي بطول 3 أو 4 أو 5 داخل سلاسل متتالية
    for (let start = 0; start < idx.length; start++) {
      let end = start;
      while (end + 1 < idx.length && idx[end + 1] === idx[end] + 1) end++;
      for (let len = 3; len <= 5; len++) {
        for (let i = start; i + len - 1 <= end; i++) {
          const ranks = idx.slice(i, i + len).map((n) => SEQ_ORDER[n]);
          out.push({ kind: SEQ_KIND[len], cards: ranks.map((rank) => ({ suit, rank })), topRank: ranks[0] });
        }
      }
      start = end;
    }
  }
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  for (const [rank, cards] of byRank) {
    if (cards.length !== 4) continue;
    let kind: ProjectKind | null = null;
    // أربع إكك: أربعمية في الصن، ومية في الحكم
    if (rank === 'A') kind = mode === 'sun' ? 'fourHundred' : 'hundred';
    // أربعة أولاد أو شياب أو بنات أو عشرات: مية (في الحكم والصن)
    else if (rank === 'J' || rank === 'K' || rank === 'Q' || rank === '10') kind = 'hundred';
    if (kind) out.push({ kind, cards, topRank: rank });
  }
  return out;
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`;

/** أفضل مجموعة مشاريع غير متداخلة في يد اللاعب (أعلى مجموع أبناط). */
export function findProjects(hand: Card[], mode: GameMode): Project[] {
  const cands = candidates(hand, mode);
  let best: Project[] = [];
  let bestValue = 0;
  const search = (from: number, used: Set<string>, chosen: Project[], value: number) => {
    if (value > bestValue) { bestValue = value; best = [...chosen]; }
    for (let i = from; i < cands.length; i++) {
      const keys = cands[i].cards.map(cardKey);
      if (keys.some((k) => used.has(k))) continue;
      keys.forEach((k) => used.add(k));
      chosen.push(cands[i]);
      search(i + 1, used, chosen, value + PROJECT_ABNAT[cands[i].kind]);
      chosen.pop();
      keys.forEach((k) => used.delete(k));
    }
  };
  search(0, new Set(), [], 0);
  return best;
}

/** أبناط المشروع حسب نوع اللعب: السرا في الصن 40 (4 نقاط)، وفي الحكم 20 (نقطتان) */
export function projectValue(kind: ProjectKind, mode: GameMode = 'hokm'): number {
  return kind === 'sira' && mode === 'sun' ? 40 : PROJECT_ABNAT[kind];
}

export function projectsAbnat(projects: Project[], mode: GameMode = 'hokm'): number {
  return projects.reduce((s, p) => s + projectValue(p.kind, mode), 0);
}

/** مقارنة مشروعين: موجب إذا a أقوى. */
export function compareProjects(a: Project, b: Project): number {
  const byValue = PROJECT_ABNAT[a.kind] - PROJECT_ABNAT[b.kind];
  if (byValue !== 0) return byValue;
  return seqIndex(b.topRank) - seqIndex(a.topRank);
}

export interface DeclaredProjects { seat: Seat; projects: Project[] }

export interface ProjectResolution {
  /** الفريق صاحب المشروع الأقوى — تُحتسب مشاريعه كلها وتُلغى مشاريع الخصم */
  winningTeam: Team | null;
  abnat: [number, number];
}

/**
 * المشروع الأقوى يلغي الأضعف بين الفريقين.
 * عند التساوي التام يفوز الأسبق في ترتيب اللعب (بدءاً من firstSeat).
 */
export function resolveProjects(declared: DeclaredProjects[], firstSeat: Seat, mode: GameMode = 'hokm'): ProjectResolution {
  const order = (s: Seat) => [0, 1, 2, 3].findIndex((n) => nextSeat(firstSeat, n) === s);
  let bestSeat: Seat | null = null;
  let bestProject: Project | null = null;
  for (const d of declared) {
    for (const p of d.projects) {
      const cmp = bestProject ? compareProjects(p, bestProject) : 1;
      if (cmp > 0 || (cmp === 0 && bestSeat !== null && order(d.seat) < order(bestSeat))) {
        bestProject = p;
        bestSeat = d.seat;
      }
    }
  }
  const abnat: [number, number] = [0, 0];
  if (bestSeat === null) return { winningTeam: null, abnat };
  const winningTeam = teamOf(bestSeat);
  for (const d of declared) {
    if (teamOf(d.seat) === winningTeam) abnat[winningTeam] += projectsAbnat(d.projects, mode);
  }
  return { winningTeam, abnat };
}

export function hasBaloot(hand: Card[], trump: Suit | null): boolean {
  if (!trump) return false;
  return hand.some((c) => c.suit === trump && c.rank === 'K') && hand.some((c) => c.suit === trump && c.rank === 'Q');
}
