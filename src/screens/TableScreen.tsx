import { useEffect, useRef, useState } from 'react';
import { type Card, type Seat, SUIT_NAMES, SUIT_SYMBOLS, SUITS, cardId, cardLabel, teamOf } from '../../shared/baloot/cards';
import type { Bid } from '../../shared/baloot/game';
import { COINS } from '../../shared/economy';
import type { GameView } from '../../shared/table';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

function bidLabel(b: Bid): string {
  switch (b.type) {
    case 'pass': return 'بس';
    case 'sun': return 'صن';
    case 'ashkal': return 'أشكل';
    case 'secondHokm': return 'حكم ثاني';
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
  const { view, connected, log, send } = useTable(tableId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [lockChoice, setLockChoice] = useState(false);
  const [showLog, setShowLog] = useState(false);
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

  /** وصف الأكلة الحالية: من لعب ماذا وبالترتيب، ومن الأعلى حالياً */
  const trickSummary = (): string => {
    if (!g) return 'المباراة لم تبدأ بعد';
    if (g.phase === 'bidding') return g.qaba ? `المزايدة جارية. ورقة الأرض: ${cardLabel(g.qaba)}` : 'المزايدة جارية';
    if (g.trick.length === 0) {
      if (!g.lastTrick) return 'لا توجد أوراق على الطاولة';
      const prev = g.lastTrick.cards.map((p) => `${name(p.seat)}: ${cardLabel(p.card)}`).join('، ');
      return `لا توجد أوراق على الطاولة. الأكلة السابقة لـ${name(g.lastTrick.winner)}: ${prev}`;
    }
    return g.trick.map((p) => `${name(p.seat)}: ${cardLabel(p.card)}`).join('، ');
  };
  const readTrick = () => announce(trickSummary());
  const readTrickRef = useRef(readTrick);
  readTrickRef.current = readTrick;

  // إيماءة سحب من اليمين لليسار لقراءة ما على الطاولة:
  // - مع قارئ التطبيق المدمج: سحب بإصبعين
  // - بدونه (ومع TalkBack الذي يمرر سحب الإصبعين للتطبيق كسحبة واحدة): أي سحبة أفقية سريعة
  useEffect(() => {
    const onTwo = () => readTrickRef.current();
    window.addEventListener(TWO_FINGER_LEFT, onTwo);
    let startPt: { x: number; y: number; t: number } | null = null;
    const onStart = (e: TouchEvent) => {
      if (isScreenReaderOn()) return;
      const t = e.touches[0];
      startPt = { x: t.clientX, y: t.clientY, t: performance.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!startPt || isScreenReaderOn()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startPt.x;
      const dy = t.clientY - startPt.y;
      if (dx < -70 && Math.abs(dy) < 60 && performance.now() - startPt.t < 700) readTrickRef.current();
      startPt = null;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener(TWO_FINGER_LEFT, onTwo);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  const act = (action: Record<string, unknown>) => send({ type: 'action', action });
  const leaveTable = () => { send({ type: 'leave' }); navigate('menu'); };

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
        <button className="secondary" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>سجل اللعب</button>
        <h1 id="table-title" className="sr-only">الطاولة</h1>
        {g && <button className="secondary" onClick={readTrick}>وش على الطاولة؟</button>}
        <button className="secondary" onClick={() => setConfirmLeave(true)}>مغادرة</button>
      </header>

      {!connected && <p role="status" className="note">انقطع الاتصال — جارٍ إعادة المحاولة…</p>}

      {g && (
        <section aria-label="النقاط" className="scores">
          <span>لنا <strong>{scoreUs}</strong></span>
          <span className="note">من 152</span>
          <span>لهم <strong>{scoreThem}</strong></span>
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

      {showLog && (
        <section aria-labelledby="log-title" className="log">
          <h2 id="log-title" style={{ fontSize: 17 }}>سجل اللعب</h2>
          <ol>{[...log].reverse().slice(0, 25).map((e, i) => <li key={i}>{e}</li>)}</ol>
        </section>
      )}

      {/* ───── قبل بدء المباراة: المقاعد ───── */}
      {!g && (
        <section aria-labelledby="seats-title" className="stack">
          <h2 id="seats-title">المقاعد</h2>
          {view.seats.map((s, i) => (
            <div key={i} className="seat-row">
              <span>
                {i === me ? 'أنت' : s ? s.username : 'مقعد فارغ'}
                {i !== me && s && teamOf(i as Seat) === myTeam ? ' (شريكك)' : ''}
              </span>
              {!s && isOwner && (
                <button className="secondary" onClick={() => send({ type: 'addBot', seat: i })}>
                  إضافة روبوت ({COINS.addBot} 🪙)
                </button>
              )}
            </div>
          ))}
          {view.spectators.length > 0 && <p className="note">المشاهدون: {view.spectators.join('، ')}</p>}
          {isOwner
            ? <button onClick={() => send({ type: 'start' })} disabled={!view.seats.every(Boolean)}>بدء المباراة</button>
            : <p role="status">بانتظار مالك الطاولة لبدء المباراة</p>}
        </section>
      )}

      {/* ───── اللعب ───── */}
      {g && (
        <>
          <section aria-label="اللاعبون والأكلة الحالية" className="board">
            {([2, 1, 3] as const).map((r) => {
              const seat = ((me + r) % 4) as Seat;
              const played = g.trick.find((p) => p.seat === seat);
              return (
                <div key={r} className={`player pos-${r}${g.turn === seat && g.phase !== 'matchOver' ? ' turn' : ''}`}>
                  <span className="player-name">{name(seat)}{r === 2 ? ' (شريكك)' : ''}</span>
                  <span className="note">{g.handCounts[seat]} أوراق</span>
                  {played && <span aria-label={`لعب ${cardLabel(played.card)}`}><CardFace card={played.card} /></span>}
                </div>
              );
            })}
            <div className="center-area">
              {g.phase === 'bidding' && g.qaba && (
                <div aria-label={`القبلة ${cardLabel(g.qaba)}`}><span className="note">القبلة</span><CardFace card={g.qaba} /></div>
              )}
              {g.trick.find((p) => p.seat === me) && (
                <div aria-label={`ورقتك ${cardLabel(g.trick.find((p) => p.seat === me)!.card)}`}>
                  <CardFace card={g.trick.find((p) => p.seat === me)!.card} />
                </div>
              )}
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

          {(g.actions.canProject || g.actions.canBaloot) && (
            <div className="action-row">
              {g.actions.canProject && <button onClick={() => act({ type: 'declareProject' })}>مشروع</button>}
              {g.actions.canBaloot && <button onClick={() => act({ type: 'declareBaloot' })}>بلوت</button>}
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

      {confirmLeave && (
        <ConfirmDialog
          title="مغادرة الطاولة"
          message={g && g.phase !== 'matchOver' && mySeat !== null ? 'المباراة جارية — سيحل روبوت مكانك. هل تريد المغادرة؟' : 'هل تريد مغادرة الطاولة؟'}
          confirmLabel="مغادرة"
          onConfirm={leaveTable}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </main>
  );
}

