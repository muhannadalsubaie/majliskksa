import { useEffect, useRef, useState } from 'react';
import { type Card, type Seat, SUIT_NAMES, SUIT_SYMBOLS, SUITS, cardId, cardLabel, teamOf } from '../../shared/baloot/cards';
import type { Bid } from '../../shared/baloot/game';
import { COINS } from '../../shared/economy';
import type { GameView } from '../../shared/table';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TableMenu } from '../components/TableMenu';
import { SeatsLobby } from '../components/SeatsLobby';
import { VoiceButton } from '../components/VoiceButton';
import { announce } from '../services/announcer';
import { useTable } from '../services/tables';
import { TWO_FINGER_LEFT, isScreenReaderOn } from '../services/screenReader';
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

export function TableScreen({ tableId, uid, navigate }: { tableId: string; uid: string; navigate: Navigate }) {
  const { view, connected, closed, send } = useTable(tableId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  /** الأوراق الموجودة على الطاولة الآن ومن لعب كل ورقة، بالترتيب */
  const trickSummary = (): string => {
    if (!g || g.trick.length === 0) return 'لا توجد أوراق على الطاولة';
    return g.trick.map((p) => `${name(p.seat)}: ${cardLabel(p.card)}`).join('، ');
  };
  const readTrickRef = useRef(() => {});
  readTrickRef.current = () => announce(trickSummary());

  // إيماءة: سحب بإصبعين من اليمين لليسار = قراءة ما على الطاولة ومن لعبه.
  // قارئ التطبيق المدمج يرسلها كحدث، وبدونه نرصد الإصبعين هنا مباشرة.
  useEffect(() => {
    const onTwo = () => readTrickRef.current();
    window.addEventListener(TWO_FINGER_LEFT, onTwo);
    let two: { x: number; y: number; t: number } | null = null;
    let last = { x: 0, y: 0 };
    const mid = (e: TouchEvent) => ({
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
    });
    const onStart = (e: TouchEvent) => {
      if (isScreenReaderOn()) return;
      if (e.touches.length === 2) { last = mid(e); two = { ...last, t: performance.now() }; }
      else if (e.touches.length > 2) two = null;
    };
    const onMove = (e: TouchEvent) => { if (two && e.touches.length === 2) last = mid(e); };
    const onEnd = (e: TouchEvent) => {
      if (!two || e.touches.length > 0) return;
      const dx = last.x - two.x;
      const dy = last.y - two.y;
      if (dx < -60 && Math.abs(dy) < Math.abs(dx) * 0.6 && performance.now() - two.t < 800) readTrickRef.current();
      two = null;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener(TWO_FINGER_LEFT, onTwo);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
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
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
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
        <button className="secondary" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">القائمة</button>
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
                      {r === 2 ? ' (شريكك)' : ''}
                    </span>
                    <span className="sr-only">، </span>
                    <span className="note">{g.handCounts[seat]} أوراق</span>
                  </p>
                </div>
              );
            })}
            {/* وسط الطاولة: الأوراق تنزل من جهة لاعبها، وتُقرأ بترتيب لعبها */}
            <div className="trick-area" role="group" aria-label="وسط الطاولة">
              {g.phase === 'bidding' && g.qaba && (
                <div className="trick-slot qaba-slot">
                  <SpokenCard text={`ورقة الأرض: ${cardLabel(g.qaba)}`} card={g.qaba} caption="ورقة الأرض" />
                </div>
              )}
              {g.trick.map((p) => (
                <div key={`${g.trickNo}-${p.seat}`} className={`trick-slot from-${rel(p.seat)}`}>
                  <SpokenCard
                    text={p.seat === mySeat ? `أنت لعبت ${cardLabel(p.card)}` : `${name(p.seat)} لعب ${cardLabel(p.card)}`}
                    card={p.card}
                  />
                </div>
              ))}
            </div>
          </section>

          <p role="status" className="turn-line">
            {g.phase === 'matchOver'
              ? (g.outcome.status === 'won' ? (g.outcome.winner === myTeam ? '🎉 فاز فريقك!' : 'فاز الفريق الآخر') : '')
              : myTurn ? 'دورك' : g.phase === 'doubling' ? 'بانتظار قرار الدبل' : `دور ${name(g.turn)}`}
          </p>

          {/* أزرار المزايدة */}
          {g.actions.bids.length > 0 && (
            <div className="action-row" role="group" aria-label="المزايدة">
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

          {g.actions.canBaloot && (
            <div className="action-row">
              <button onClick={() => act({ type: 'declareBaloot' })}>بلوت</button>
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
                      disabled={!legal}
                      aria-label={cardLabel(c)}
                      onClick={() => act({ type: 'play', card: c })}
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

      <VoiceButton channelName={`table-${tableId.slice(0, 16)}`} />

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

