import { useCallback, useEffect, useRef, useState } from 'react';
import { type Card, type Seat, SUIT_NAMES, SUIT_SYMBOLS, SUITS, cardId, cardLabel, teamOf } from '../../shared/baloot/cards';
import type { Bid } from '../../shared/baloot/game';
import { COINS } from '../../shared/economy';
import type { GameView } from '../../shared/table';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TableMenu } from '../components/TableMenu';
import { HistoryDialog } from '../components/HistoryDialog';
import { TABLE_BACK } from '../services/backButton';
import { isSystemReaderOn } from '../services/nativeA11y';
import { SeatsLobby } from '../components/SeatsLobby';
import { VoiceButton } from '../components/VoiceButton';
import { announce } from '../services/announcer';
import { sounds } from '../services/sounds';
import { useTable } from '../services/tables';
import { type SwipeDir, TWO_FINGER, isScreenReaderOn, swipeDir } from '../services/screenReader';
import type { Navigate } from '../state/navigation';

const RANK_SHORT: Record<string, string> = { A: 'A', K: 'K', Q: 'Q', J: 'J', '10': '10', '9': '9', '8': '8', '7': '7' };
const isRed = (c: Card) => c.suit === 'H' || c.suit === 'D';

function CardFace({ card }: { card: Card }) {
  return (
    <span className={`card-face${isRed(card) ? ' red' : ''}`} aria-hidden="true">
      <span>{RANK_SHORT[card.rank]}</span><span>{SUIT_SYMBOLS[card.suit]}</span>
    </span>
  );
}

/**
 * ورقة معروضة على الطاولة: نص حقيقي يقرؤه TalkBack وVoiceOver وقارئ التطبيق
 * عند الوقوف عليها (aria-label على عنصر عادي يتجاهله أغلب القرّاء)، والرسم مخفي عنهم.
 */
function SpokenCard({ text, card, caption }: { text: string; card: Card; caption?: string }) {
  return (
    <p className="spoken-card">
      <span className="sr-only">{text}</span>
      {caption && <span className="note" aria-hidden="true">{caption}</span>}
      <CardFace card={card} />
    </p>
  );
}

function bidLabel(b: Bid): string {
  switch (b.type) {
    case 'pass': return 'بس';
    case 'sun': return 'صن';
    case 'ashkal': return 'أشكل';
    case 'secondHokm': return 'حكم ثاني';
    case 'qablak': return 'قبلك';
    case 'confirmHokm': return 'تأكيد الحكم';
    case 'hokm': return `حكم ${SUIT_NAMES[b.suit]} ${SUIT_SYMBOLS[b.suit]}`;
  }
}

const levelLabel = (g: GameView) => {
  if (g.doubling.gahwa) return 'قهوة';
  return ({ 1: '', 2: 'دبل', 3: 'ثري', 4: 'فور' } as const)[g.doubling.level];
};

/** ترتيب الأوراق في اليد: حسب اللون ثم الرتبة */
const RANK_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
const sortHand = (hand: Card[]) =>
  [...hand].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));

/** كم تبقى الأكلة المكتملة ظاهرة قبل أن تذهب لصاحبها */
const TRICK_HOLD_MS = 1200;

export function TableScreen({ tableId, uid, navigate }: { tableId: string; uid: string; navigate: Navigate }) {
  const { view, connected, closed, send } = useTable(tableId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const [lockChoice, setLockChoice] = useState(false);
  const wasMyTurn = useRef(false);

  const g = view?.game ?? null;
  const mySeat = view?.mySeat ?? null;
  const me: Seat = mySeat ?? 0;
  const name = (s: Seat) => view?.seats[s]?.username ?? `مقعد ${s + 1}`;
  const rel = (s: Seat) => ((s - me + 4) % 4) as 0 | 1 | 2 | 3;

  const myTurn = Boolean(g && mySeat !== null && (
    g.actions.bids.length > 0 || g.actions.double !== null || g.actions.canPassDouble || g.actions.legal.length > 0
  ));

  // إعلان "دورك" مرة واحدة عند بداية الدور
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) announce('دورك');
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  useEffect(() => { if (!g || g.actions.double === null) setLockChoice(false); }, [g]);

  // بعد آخر ورقة في الأكلة: نبقي الأوراق الأربع ظاهرة لحظة قبل أن تذهب لصاحبها
  // (ما لم تبدأ الأكلة التالية قبل ذلك)
  const [heldTrick, setHeldTrick] = useState<number | null>(null);
  const lastTrickNo = useRef<number | null>(null);
  useEffect(() => {
    if (!g) return;
    const prev = lastTrickNo.current;
    lastTrickNo.current = g.trickNo;
    if (prev !== null && g.trickNo === prev + 1 && g.lastTrick && g.trick.length === 0) {
      setHeldTrick(g.trickNo);
      const t = setTimeout(() => setHeldTrick(null), TRICK_HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [g?.trickNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownTrick = g && heldTrick === g.trickNo && g.trick.length === 0 && g.lastTrick ? g.lastTrick.cards : g?.trick ?? [];

  // المؤثرات الصوتية: نقارن الحالة الجديدة بالسابقة لنعرف ما حدث
  const prevGame = useRef<GameView | null>(null);
  useEffect(() => { sounds.preload(); }, []);
  useEffect(() => {
    const prev = prevGame.current;
    prevGame.current = g;
    if (!g || !prev) return;
    const total = (x: GameView) => x.handCounts.reduce((a, b) => a + b, 0);
    if (total(g) > total(prev)) sounds.deal(total(g) - total(prev) > 12);
    // الورقة الجديدة: آخر ورقة في الأكلة الحالية، أو الرابعة إن اكتملت الأكلة للتو
    let played: { card: Card; lead: Card } | null = null;
    if (g.trickNo === prev.trickNo && g.trick.length > prev.trick.length) {
      played = { card: g.trick[g.trick.length - 1].card, lead: g.trick[0].card };
    } else if (g.trickNo === prev.trickNo + 1 && g.lastTrick) {
      played = { card: g.lastTrick.cards[3].card, lead: g.lastTrick.cards[0].card };
    }
    if (played) {
      const trump = g.contract?.mode === 'hokm' ? g.contract.trump : null;
      const isCut = trump !== null && played.card.suit === trump && played.lead.suit !== trump;
      if (isCut) sounds.cut(); else sounds.card();
    }
    if (g.declared.length > prev.declared.length) sounds.project();
    if (g.balootSeat !== null && prev.balootSeat === null) sounds.baloot();
    // المزايدة
    if (g.hokmBid && (!prev.hokmBid || prev.hokmBid.seat !== g.hokmBid.seat || prev.hokmBid.suit !== g.hokmBid.suit)) sounds.hokm();
    if (g.contract && !prev.contract) {
      if (g.contract.mode === 'sun') sounds.sun();
      // الحكم المشترى من قبل (سمعنا صوته): الآن تأكّد
      else if (prev.hokmBid) sounds.confirmHokm();
    }
    if (g.doubling.gahwa && !prev.doubling.gahwa) sounds.gahwa();
    else if (g.doubling.level > prev.doubling.level) sounds.double(g.doubling.level);
  }, [g]);

  /** الأوراق الموجودة على الطاولة الآن ومن لعب كل ورقة، بالترتيب */
  const trickSummary = (): string => {
    if (shownTrick.length === 0) return 'لا توجد أوراق على الطاولة';
    return shownTrick.map((p) => `${name(p.seat)}: ${cardLabel(p.card)}`).join('، ');
  };
  const teamWord = (s: Seat) => (mySeat === null ? `فريق ${name(s)}` : teamOf(s) === teamOf(me) ? 'فريقك' : 'الخصم');

  /** نوع اللعب: من اشترى، وعلى ماذا (صن أو حكم وأي شكل)، والدبل */
  const contractSummary = (): string => {
    if (!g) return 'لم تبدأ المباراة بعد';
    const c = g.contract;
    if (!c) {
      const ground = g.qaba ? `، ورقة الأرض ${cardLabel(g.qaba)}` : '';
      return `لم يشترِ أحد بعد، المزايدة في الجولة ${g.bidRound === 1 ? 'الأولى' : 'الثانية'}${ground}`;
    }
    const mode = c.mode === 'sun' ? 'صن' : `حكم ${SUIT_NAMES[c.trump!]}`;
    const parts = [c.buyer === mySeat ? `أنت اشتريت ${mode}` : `${name(c.buyer)} اشترى ${mode}، ${teamWord(c.buyer)}`];
    if (c.qabaTo !== c.buyer) parts.push(`القبلة لـ${c.qabaTo === mySeat ? 'ك' : name(c.qabaTo)}`);
    const d = g.doubling;
    if (d.gahwa) parts.push('قهوة');
    else if (d.level > 1) {
      const label = ({ 2: 'دبل', 3: 'ثري', 4: 'فور' } as const)[d.level as 2 | 3 | 4];
      parts.push(`${label}${c.mode === 'hokm' ? (d.locked ? ' مقفل' : ' مفتوح') : ''}`);
    } else parts.push('بدون دبل');
    return parts.join('، ');
  };

  /** المشاريع المعلنة ومن أعلنها (وأوراقها بعد الأكلة الأولى) */
  const projectsSummary = (): string => {
    if (!g) return 'لم تبدأ المباراة بعد';
    const lines = g.declared.map((d) => {
      const who = d.seat === mySeat ? 'أنت' : name(d.seat);
      const items = d.kinds.map((k, i) => (d.cards?.[i] ? `${k}: ${d.cards[i]}` : k));
      return `${who}: ${items.join('، و')}${d.cancelled ? '، ملغى' : ''}`;
    });
    if (g.balootSeat !== null) lines.push(`${g.balootSeat === mySeat ? 'أنت' : name(g.balootSeat)}: بلوت`);
    if (!lines.length) return 'لا توجد مشاريع معلنة';
    if (g.projects?.winningTeam != null && g.declared.length) {
      lines.push(`المشاريع المحتسبة لـ${mySeat === null ? `فريق ${name(g.projects.winningTeam as Seat)}` : g.projects.winningTeam === teamOf(me) ? 'فريقك' : 'الخصم'}`);
    }
    return lines.join('. ');
  };

  const readTrickRef = useRef((_dir: SwipeDir) => {});
  readTrickRef.current = (dir: SwipeDir) => {
    if (dir === 'left') announce(trickSummary());
    else if (dir === 'right') announce(contractSummary());
    else if (dir === 'up') announce(projectsSummary());
  };

  // إيماءات بإصبعين: من اليمين لليسار = أوراق الطاولة ومن لعبها، من اليسار لليمين = نوع اللعب
  // ومن اشترى، ومن تحت لفوق = المشاريع المعلنة.
  // قارئ التطبيق المدمج يرسلها كحدث، وبدونه نرصد الإصبعين هنا مباشرة.
  useEffect(() => {
    const onTwo = (e: Event) => readTrickRef.current((e as CustomEvent<SwipeDir>).detail);
    window.addEventListener(TWO_FINGER, onTwo);
    let two: { x: number; y: number; t: number } | null = null;
    let last = { x: 0, y: 0 };
    // متوسط مواقع الأصابع على الشاشة
    const mid = (e: TouchEvent) => {
      const pts = Array.from(e.touches);
      return {
        x: pts.reduce((a, p) => a + p.clientX, 0) / pts.length,
        y: pts.reduce((a, p) => a + p.clientY, 0) / pts.length,
      };
    };
    // مع TalkBack: النظام يستهلك إيماءات الإصبع الواحد، ويمرر سحب الإصبعين للتطبيق
    // (أحياناً كإصبع واحد في المنتصف)، فأي سحب يصلنا وقتها هو سحب بإصبعين
    const fingersOk = (n: number) => n === 2 || (n === 1 && isSystemReaderOn());
    const onStart = (e: TouchEvent) => {
      if (isScreenReaderOn()) return;
      if (fingersOk(e.touches.length)) { last = mid(e); two = { ...last, t: performance.now() }; }
      else if (e.touches.length > 2) two = null;
    };
    const onMove = (e: TouchEvent) => { if (two && fingersOk(e.touches.length)) last = mid(e); };
    const onEnd = (e: TouchEvent) => {
      if (!two || e.touches.length > 0) return;
      const dir = performance.now() - two.t < 1200 ? swipeDir(last.x - two.x, last.y - two.y) : null;
      if (dir) readTrickRef.current(dir);
      two = null;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener(TWO_FINGER, onTwo);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // زر الرجوع في الجهاز يفتح قائمة الطاولة (ومنها المغادرة) بدل الخروج المفاجئ
  useEffect(() => {
    const onBack = () => setMenuOpen(true);
    window.addEventListener(TABLE_BACK, onBack);
    return () => window.removeEventListener(TABLE_BACK, onBack);
  }, []);

  const act = (action: Record<string, unknown>) => send({ type: 'action', action });
  const leaveTable = () => { send({ type: 'leave' }); navigate('menu'); };

  if (closed) {
    return (
      <main className="screen center" aria-labelledby="table-closed">
        <h1 id="table-closed">أُغلقت الطاولة</h1>
        <p>لم يبق أحد على الطاولة، فأُغلقت تلقائياً.</p>
        <button onClick={() => navigate('menu')}>العودة للقائمة الرئيسية</button>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="screen center" aria-labelledby="table-loading">
        <h1 id="table-loading" className="sr-only">الطاولة</h1>
        <div className="spinner" role="progressbar" aria-label="جارٍ الاتصال بالطاولة" />
        <p role="status">{connected ? 'جارٍ التحميل…' : 'جارٍ الاتصال بالطاولة…'}</p>
        <button className="secondary back-btn" onClick={() => navigate('menu')}>رجوع</button>
      </main>
    );
  }

  const isOwner = view.ownerUid === uid;
  const myTeam = teamOf(me);
  const scoreUs = g ? g.scores[myTeam] : 0;
  const scoreThem = g ? g.scores[(1 - myTeam) as 0 | 1] : 0;

  return (
    <main className="screen table-screen" aria-labelledby="table-title">
      <header className="topbar">
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">القائمة</button>
          <button className="secondary" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">السجل</button>
        </span>
        <h1 id="table-title" className="sr-only">الطاولة</h1>
      </header>

      {!connected && <p role="status" className="note">انقطع الاتصال — جارٍ إعادة المحاولة…</p>}

      {g && (
        <section className="scores" aria-labelledby="score-text">
          {/* جملة واحدة كاملة لقارئ الشاشة */}
          <p id="score-text" className="sr-only">النقاط: لنا {scoreUs}، لهم {scoreThem}. الفوز عند 152</p>
          <div className="score-box us" aria-hidden="true"><span className="score-label">لنا</span><strong>{scoreUs}</strong></div>
          <div className="score-goal" aria-hidden="true">152</div>
          <div className="score-box them" aria-hidden="true"><span className="score-label">لهم</span><strong>{scoreThem}</strong></div>
        </section>
      )}

      {g?.contract && (
        <p className="status-line" aria-label="حالة اللعب">
          {g.contract.mode === 'sun' ? 'صن' : `حكم ${SUIT_NAMES[g.contract.trump!]} ${SUIT_SYMBOLS[g.contract.trump!]}`}
          {' — '}{name(g.contract.buyer)}
          {levelLabel(g) && ` — ${levelLabel(g)}`}
          {g.contract.mode === 'hokm' && g.doubling.level > 1 && !g.doubling.gahwa && (g.doubling.locked ? ' (مقفل)' : ' (مفتوح)')}
        </p>
      )}


      {/* ───── قبل بدء المباراة: المقاعد ───── */}
      {!g && <SeatsLobby view={view} uid={uid} send={send} />}

      {/* ───── اللعب ───── */}
      {g && (
        <>
          <section aria-label="الطاولة" className="board">
            {([2, 1, 3] as const).map((r) => {
              const seat = ((me + r) % 4) as Seat;
              return (
                <div key={r} className={`player pos-${r}${g.turn === seat && g.phase !== 'matchOver' ? ' turn' : ''}`}>
                  <p className="player-info">
                    <span className="player-name">
                      {name(seat)}
                      {view.seats[seat]?.isBot ? ' (روبوت)' : ''}
                      {view.seats[seat]?.away ? ' (انقطع الاتصال)' : ''}
                      {r === 2 ? ' (شريكك)' : ''}
                    </span>
                    <span className="sr-only">، </span>
                    <span className="note">{g.handCounts[seat]} أوراق</span>
                  </p>
                </div>
              );
            })}
            {/* وسط الطاولة: الأوراق تنزل من جهة لاعبها، وتُقرأ بترتيب لعبها */}
            {/* مع TalkBack/VoiceOver لا تصل إيماءة الإصبعين للتطبيق: الوصول لهذه المجموعة يقرأ
                كل الأوراق ومن لعبها، والنقر مرتين عليها يعيد قراءتها */}
            <div
              className="trick-area"
              role="group"
              aria-label={shownTrick.length ? `وسط الطاولة: ${trickSummary()}` : 'وسط الطاولة: لا توجد أوراق'}
              onClick={() => readTrickRef.current('left')}
            >
              {(g.phase === 'bidding' || g.phase === 'doubling') && g.qaba && (
                <div className="trick-slot qaba-slot">
                  <SpokenCard text={`ورقة الأرض: ${cardLabel(g.qaba)}`} card={g.qaba} caption="ورقة الأرض" />
                </div>
              )}
              {shownTrick.map((p) => (
                <div key={`${heldTrick !== null && g.trick.length === 0 ? g.trickNo - 1 : g.trickNo}-${p.seat}`} className={`trick-slot from-${rel(p.seat)}`}>
                  <SpokenCard
                    text={p.seat === mySeat ? `أنت لعبت ${cardLabel(p.card)}` : `${name(p.seat)} لعب ${cardLabel(p.card)}`}
                    card={p.card}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ليس منطقة حية: "دورك" يُعلن مرة واحدة، وتحديثها مع كل ورقة كان يقطع إعلانات اللعب */}
          <p className="turn-line" tabIndex={-1}>
            {g.phase === 'matchOver'
              ? (g.outcome.status === 'won' ? (g.outcome.winner === myTeam ? '🎉 فاز فريقك!' : 'فاز الفريق الآخر') : '')
              : myTurn ? 'دورك' : g.phase === 'doubling' ? (g.doubling.awaitingSeat != null ? `بانتظار قرار ${name(g.doubling.awaitingSeat)} في الدبل` : 'بانتظار قرار الدبل') : `دور ${name(g.turn)}`}
          </p>

          {/* أزرار المزايدة */}
          {g.actions.bids.length > 0 && (
            <div className="action-row bid-row" role="group" aria-label="المزايدة">
              {g.actions.bids.map((b) => (
                <button key={bidLabel(b)} className={b.type === 'pass' ? 'secondary' : ''} onClick={() => act({ type: 'bid', bid: b })}>
                  {bidLabel(b)}
                </button>
              ))}
            </div>
          )}

          {/* الدبل */}
          {(g.actions.double || g.actions.canPassDouble) && (
            <div className="action-row" role="group" aria-label="الدبل">
              {g.actions.double && !lockChoice && (
                <button onClick={() => (g.actions.double!.needsLockChoice ? setLockChoice(true) : act({ type: 'double' }))}>
                  {g.actions.double.label}
                </button>
              )}
              {lockChoice && (
                <>
                  <button onClick={() => act({ type: 'double', locked: true })}>{g.actions.double?.label} مقفل</button>
                  <button onClick={() => act({ type: 'double', locked: false })}>{g.actions.double?.label} مفتوح</button>
                </>
              )}
              {g.actions.canPassDouble && <button className="secondary" onClick={() => act({ type: 'doublePass' })}>تمرير</button>}
            </div>
          )}


          {g.phase === 'matchOver' && isOwner && (
            <button onClick={() => send({ type: 'start' })}>مباراة جديدة</button>
          )}

          {/* يد اللاعب */}
          {mySeat !== null && (
            <section aria-labelledby="hand-title">
              <h2 id="hand-title" className="sr-only">أوراقك</h2>
              <div className="hand">
                {sortHand(g.myHand).map((c) => {
                  const legal = g.actions.legal.some((l) => l.suit === c.suit && l.rank === c.rank);
                  return (
                    <button
                      key={cardId(c)}
                      className="card-btn"
                      // aria-disabled بدل disabled: تبقى الورقة قابلة للتركيز، فلا يقفز مؤشر
                      // قارئ الشاشة لأعلى الصفحة عندما ينتهي دورك
                      aria-disabled={!legal}
                      aria-label={cardLabel(c)}
                      onClick={() => { if (legal) act({ type: 'play', card: c }); }}
                    >
                      <CardFace card={c} />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {mySeat === null && <p className="note">أنت تشاهد هذه الطاولة.</p>}
        </>
      )}

      <VoiceButton view={view} uid={uid} />

      {historyOpen && <HistoryDialog history={view?.history ?? []} onClose={closeHistory} />}
      {menuOpen && !confirmLeave && (
        <TableMenu
          view={view}
          uid={uid}
          send={send}
          onLeave={() => setConfirmLeave(true)}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {confirmLeave && (
        <ConfirmDialog
          title="مغادرة الطاولة"
          message={g && g.phase !== 'matchOver' && mySeat !== null ? 'المباراة جارية — سيحل روبوت مكانك. هل تريد المغادرة؟' : 'هل تريد مغادرة الطاولة؟'}
          confirmLabel="مغادرة"
          onConfirm={leaveTable}
          onCancel={() => { setConfirmLeave(false); setMenuOpen(false); }}
        />
      )}
    </main>
  );
}

