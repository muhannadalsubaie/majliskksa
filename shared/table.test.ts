import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { HAND_TOTAL, SUN_ABNAT_MULTIPLIER } from './baloot/cards';
import { BOT_NAMES, addBot, addInvite, assignSeat, join, leave, replaceSeat, vacateSeat, newTable, nextAutoStep, runAutoStep, start, stopGame, kick, setVoiceBlocked, isVoiceBlocked, memberName, TableError, viewFor, type TableData } from './table';

const owner = { uid: 'u1', username: 'مهند' };

function botsTable(seed: number): TableData {
  let t = newTable('t1', owner, false, 0);
  t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
  // المالك نفسه يصبح روبوتاً للمحاكاة الكاملة
  t = { ...t, seats: t.seats.map((m, i) => (i === 0 ? { uid: 'bot-x', username: 'روبوت', isBot: true } : m)) };
  return start(t, seededRng(seed));
}

describe('table', () => {
  it('join: seats first, then spectators; charged on every entry', () => {
    let t = newTable('t1', owner, false, 0);
    const r1 = join(t, { uid: 'u2', username: 'أحمد' });
    expect(r1.charge).toBe(true);
    t = r1.table;
    expect(t.seats[1]?.username).toBe('أحمد');
    expect(join(t, { uid: 'u2', username: 'أحمد' }).charge).toBe(false);
    t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(1));
    t = join(t, { uid: 'u5', username: 'سعد' }).table;
    expect(t.spectators.map((m) => m.username)).toEqual(['سعد']);
    // المشاهد يغادر ويعود: تنخصم عملة مرة ثانية
    t = leave(t, 'u5').table;
    expect(join(t, { uid: 'u5', username: 'سعد' }).charge).toBe(true);
    // المالك السابق (بعد ما انتقلت الملكية وغادر) يدفع لما يرجع، 
    t = join(t, { uid: 'u5', username: 'سعد' }).table;
    const handed = { ...t, ownerUid: 'u2' };
    const gone = leave(handed, owner.uid).table;
    expect(join(gone, owner).charge).toBe(true);
  });

  it('bots get distinct random Arabic names', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let t = newTable('t1', owner, false, 0);
      const rng = seededRng(seed);
      t = addBot(t, 1, rng); t = addBot(t, 2, rng); t = addBot(t, 3, rng);
      const names = t.seats.slice(1).map((m) => m!.username);
      expect(new Set(names).size).toBe(3);
      expect(names.every((n) => BOT_NAMES.includes(n))).toBe(true);
    }
  });

  it('private tables need an invite; an invite is free for the guest and single-use', () => {
    let t = newTable('t1', owner, true, 0);
    expect(() => join(t, { uid: 'u2', username: 'أحمد' })).toThrow(TableError);
    t = addInvite(t, 'abc');
    const r = join(t, { uid: 'u2', username: 'أحمد' }, 'abc');
    expect(r.charge).toBe(false);
    expect(r.table.seats[1]?.username).toBe('أحمد');
    expect(() => join(r.table, { uid: 'u3', username: 'سعد' }, 'abc')).toThrow(TableError);
  });

  it('invite coin is charged to the inviter only when the guest actually joins', () => {
    let t = newTable('t1', owner, true, 0);
    t = addInvite(t, 'inv', undefined, owner.uid);
    expect(join(t, { uid: 'u2', username: 'أحمد' }, 'inv').invitedBy).toBe(owner.uid);
    expect(join(t, { uid: owner.uid, username: owner.username }, 'inv').invitedBy).toBeUndefined();
    const pub = newTable('t2', owner, false, 0);
    expect(join(pub, { uid: 'u2', username: 'أحمد' }).invitedBy).toBeUndefined();
  });

  it('rejected join request: no entry to the private table for half an hour, unless invited or the table is public', () => {
    let t = newTable('t1', owner, true, 0);
    t = { ...t, paid: [...t.paid, 'u2'], joinRequests: { u2: { name: 'أحمد', at: 1000, status: 'rejected' } } };
    const u2 = { uid: 'u2', username: 'أحمد' };
    expect(() => join(t, u2, undefined, 1000 + 29 * 60_000)).toThrow('join-rejected');
    expect(join(addInvite(t, 'inv'), u2, 'inv', 1000 + 60_000).table.seats[1]?.uid).toBe('u2');
    expect(join({ ...t, isPrivate: false }, u2, undefined, 1000 + 60_000).table.seats[1]?.uid).toBe('u2');
    expect(join(t, u2, undefined, 1000 + 31 * 60_000).table.seats[1]?.uid).toBe('u2');
  });

  it('owner replaces a bot with a spectator mid-game; replaced human becomes a spectator', () => {
    let t = newTable('t1', owner, false, 0);
    t = join(t, { uid: 'u2', username: 'أحمد' }).table;
    t = addBot(t, 2, seededRng(1)); t = addBot(t, 3, seededRng(2));
    t = start(t, seededRng(3));
    t = join(t, { uid: 'u5', username: 'سعد' }).table; // مشاهد
    const hand = t.game!.hands[2];
    t = replaceSeat(t, 2, 'u5');
    expect(t.seats[2]).toMatchObject({ uid: 'u5', username: 'سعد', isBot: false });
    expect(viewFor(t, 'u5').game!.myHand).toEqual(hand); // يأخذ أوراق المقعد
    expect(t.spectators).toEqual([]);
    t = join(t, { uid: 'u6', username: 'خالد' }).table;
    t = replaceSeat(t, 1, 'u6');
    expect(t.seats[1]?.username).toBe('خالد');
    expect(t.spectators.map((m) => m.username)).toEqual(['أحمد']);
    expect(() => replaceSeat(t, 1, 'nobody')).toThrow(TableError);
  });

  it('invite can reserve a seat', () => {
    let t = newTable('t1', owner, false, 0);
    t = addInvite(t, 'x', 3);
    t = join(t, { uid: 'u2', username: 'أحمد' }, 'x').table;
    expect(t.seats[3]?.username).toBe('أحمد');
    expect(t.seats[1]).toBeNull();
  });

  it('owner arranges teams: swap seated players, vacate, and spectate himself', () => {
    let t = newTable('t1', owner, false, 0);
    t = join(t, { uid: 'u2', username: 'أحمد' }).table; // seat 1 (opponent)
    t = join(t, { uid: 'u3', username: 'سعد' }).table; // seat 2 (partner)
    // أحمد يصبح شريك المالك
    t = assignSeat(t, 2, 'u2');
    expect(t.seats[2]?.username).toBe('أحمد');
    expect(t.seats[1]?.username).toBe('سعد');
    // المالك يصبح مشاهداً ويضع غيره مكانه
    t = vacateSeat(t, 0);
    expect(t.seats[0]).toBeNull();
    expect(t.spectators.map((m) => m.uid)).toEqual(['u1']);
    t = join(t, { uid: 'u4', username: 'خالد' }).table; // يأخذ مقعد 0 الفارغ
    t = addBot(t, 3, seededRng(1));
    t = start(t, seededRng(2));
    expect(viewFor(t, 'u1').mySeat).toBeNull(); // المالك مشاهد
    expect(() => assignSeat(t, 1, 'u2')).toThrow(TableError); // لا تبديل أثناء اللعب
    expect(() => vacateSeat(t, 1)).toThrow(TableError);
  });

  it('cannot start until 4 seats are filled', () => {
    const t = newTable('t1', owner, false, 0);
    expect(() => start(t, seededRng(1))).toThrow(TableError);
  });

  it('player leaving mid-game is replaced by a bot', () => {
    let t = newTable('t1', owner, false, 0);
    t = join(t, { uid: 'u2', username: 'أحمد' }).table;
    t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(2));
    const r = leave(t, 'u2');
    expect(r.botReplaced).toBe(true);
    expect(r.table.seats[1]?.isBot).toBe(true);
  });

  it('view hides other hands', () => {
    let t = newTable('t1', owner, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(3));
    const v = viewFor(t, 'u1');
    expect(v.mySeat).toBe(0);
    expect(v.game!.myHand).toHaveLength(5);
    expect(v.game!.handCounts).toEqual([5, 5, 5, 5]);
    expect(JSON.stringify(v)).not.toContain('"hands"');
    const spectator = viewFor(t, 'someone-else');
    expect(spectator.game!.myHand).toEqual([]);
    expect(spectator.game!.actions.legal).toEqual([]);
  });

  it('four bots play full matches to the end', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seededRng(seed);
      let t = botsTable(seed);
      let steps = 0;
      const events: string[] = [];
      let hands = 0;
      while (t.game!.phase !== 'matchOver') {
        const step = nextAutoStep(t, rng);
        expect(step, `seed ${seed}: stuck at ${t.game!.phase}`).not.toBeNull();
        const r = runAutoStep(t, step!, rng);
        if (r.table.game!.lastHand && !t.game!.lastHand) {
          const g = r.table.game!;
          const total = (g.cardAbnat[0] + g.cardAbnat[1]) * (g.contract!.mode === 'sun' ? SUN_ABNAT_MULTIPLIER : 1);
          expect(total).toBe(HAND_TOTAL[g.contract!.mode]);
          hands++;
          const rec = r.table.history!.at(-1)!;
          expect(r.table.history).toHaveLength(hands);
          expect(rec.points).toEqual(g.lastHand!.points);
          // يُنطق النقاط والفائز والخاسر فقط، والأبناط في السجل
          expect(r.events.some((e) => e.includes('بنط'))).toBe(false);
          expect(r.events.some((e) => e.includes(`نتيجة الصكة:`) && e.includes(String(rec.points[0])))).toBe(true);
          expect(r.events.some((e) => /وخسر|كبوت لـ|نجح المشتري/.test(e))).toBe(false);
        }
        t = r.table;
        events.push(...r.events);
        if (++steps > 20000) throw new Error(`seed ${seed}: too many steps`);
      }
      expect(events.at(-1)).toMatch(/^انتهت المباراة — فاز/);
      expect(events.some((e) => /الموزع\. ورقة الأرض: /.test(e))).toBe(true);
      expect(events.some((e) => / اشترى (حكم|صن)/.test(e))).toBe(true);
      // الدبل يُعلن قبل مقفل/مفتوح
      const i = events.findIndex((e) => / اشترى دبل$/.test(e));
      // (في الصن ما فيه مقفل/مفتوح: يبدأ اللعب بعده مباشرة)
      if (i >= 0) expect(events[i + 1]).toMatch(/^(مقفل|مفتوح|وُزّعت|القرار)|^[^:]+: /);
    }
  });

  it('stopGame: score back to zero, seats empty, humans become spectators, bots removed', () => {
    const rng = seededRng(5);
    let t = botsTable(5);
    t = { ...t, seats: t.seats.map((m, i) => (i === 2 ? { uid: 'u2', username: 'سالم', isBot: false } : m)) };
    t = { ...t, spectators: [{ uid: 'u3', username: 'فهد', isBot: false }] };
    for (let n = 0; n < 200; n++) {
      const step = nextAutoStep(t, rng);
      if (!step) break; // دور اللاعب البشري
      t = runAutoStep(t, step, rng).table;
    }
    expect(t.game).not.toBeNull();
    const s = stopGame(t);
    expect(s.game).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.seats).toEqual([null, null, null, null]);
    expect(s.spectators.map((m) => m.uid).sort()).toEqual(['u2', 'u3']);
    // بعدها يجلس المالك من يريد
    const seated = assignSeat(s, 1, 'u2');
    expect(seated.seats[1]?.uid).toBe('u2');
  });

  it('bots wait for the human whose turn it is', () => {
    let t = newTable('t1', owner, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(4)); // dealer 0 → seat 1 bids first (bot)
    const rng = seededRng(4);
    let guard = 0;
    while (t.game!.turn !== 0 || t.game!.phase !== 'bidding') {
      const step = nextAutoStep(t, rng);
      if (!step) break;
      t = runAutoStep(t, step, rng).table;
      if (++guard > 50) break;
    }
    if (t.game!.phase === 'bidding' && t.game!.turn === 0) expect(nextAutoStep(t, rng)).toBeNull();
  });
});

describe('owner moderation', () => {
  it('kick removes, ban also blocks rejoining, voice block mutes', () => {
    let t = newTable('t1', owner, false, 0);
    t = join(t, { uid: 'u2', username: 'سالم' }).table;
    t = join(t, { uid: 'u3', username: 'فهد' }).table;
    // كتم في المحادثة الصوتية
    t = { ...t, voice: { u2: { sessionId: 's', muted: false, mic: true } } };
    const muted = setVoiceBlocked(t, 'u2', true);
    expect(isVoiceBlocked(muted, 'u2')).toBe(true);
    expect(muted.voice!.u2.muted).toBe(true);
    expect(isVoiceBlocked(setVoiceBlocked(muted, 'u2', false), 'u2')).toBe(false);
    // طرد: يخرج، ولا يعود لنفس الطاولة إلا بعد ساعة
    const kicked = kick(t, 'u2', false, Math.random, 1000).table;
    expect(memberName(kicked, 'u2')).toBeNull();
    expect(() => join(kicked, { uid: 'u2', username: 'سالم' }, undefined, 1000 + 59 * 60_000)).toThrow(TableError);
    expect(memberName(join(kicked, { uid: 'u2', username: 'سالم' }, undefined, 1000 + 60 * 60_000).table, 'u2')).toBe('سالم');
    // الكتم يزول إذا غادر وعاد
    const left = leave(muted, 'u2').table;
    expect(isVoiceBlocked(join(left, { uid: 'u2', username: 'سالم' }).table, 'u2')).toBe(false);
    // حظر: لا يعود
    const banned = kick(t, 'u3', true).table;
    expect(() => join(banned, { uid: 'u3', username: 'فهد' })).toThrow(TableError);
    // لا يُطرد المالك
    expect(() => kick(t, owner.uid, false)).toThrow(TableError);
  });
});

it('each match has its own log: a new match starts an empty log', () => {
  const t = botsTable(21);
  expect(t.matchNo).toBe(1);
  const played = { ...t, history: [{ match: 1 } as never], game: { ...t.game!, phase: 'matchOver' as const } };
  const next = start(played, seededRng(1));
  expect(next.matchNo).toBe(2);
  expect(next.history).toEqual([]);
  // الإيقاف الكامل يمسح السجل
  expect(stopGame(next).history).toEqual([]);
});
