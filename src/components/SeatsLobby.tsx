import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../../shared/baloot/cards';
import { COINS } from '../../shared/economy';
import type { TableView } from '../../shared/table';
import { announce } from '../services/announcer';
import { type Friend, inviteFriend, listFriends, socialError } from '../services/social';
import type { ClientMessage } from '../services/tables';

interface Props { view: TableView; uid: string; send: (m: ClientMessage) => void }

type Panel = null | { invite: Seat } | { change: Seat };

const TEAMS: { title: string; seats: Seat[] }[] = [
  { title: 'الفريق الأول', seats: [0, 2] },
  { title: 'الفريق الثاني', seats: [1, 3] },
];

/**
 * شاشة المقاعد قبل بدء المباراة: مقسّمة بالفريقين.
 * مالك الطاولة: يدعو صديقاً لمقعد فارغ أو يضيف روبوتاً، ويغيّر من يجلس في كل مقعد
 * (تبادل بين الجالسين أو إجلاس مشاهد)، ويُخلي أي مقعد — بما فيه مقعده ليصبح مشاهداً.
 */
export function SeatsLobby({ view, uid, send }: Props) {
  const isOwner = view.ownerUid === uid;
  const [panel, setPanel] = useState<Panel>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);
  useEffect(() => {
    if (!panel || !('invite' in panel)) return;
    const load = () => listFriends().then((r) => setFriends(r.friends)).catch(() => setFriends([]));
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [panel]);

  const occupantLabel = (i: Seat) => {
    const s = view.seats[i];
    if (!s) return 'فارغ';
    const tags = [i === view.mySeat ? 'أنت' : '', s.isBot ? 'روبوت' : ''].filter(Boolean);
    return `${s.username}${tags.length ? ` (${tags.join('، ')})` : ''}`;
  };

  const invite = async (f: Friend, seat: Seat) => {
    setBusy(f.uid);
    try {
      await inviteFriend(view.id, f.uid, seat);
      announce(`أُرسلت الدعوة إلى ${f.username} للمقعد ${seat + 1}`);
      setPanel(null);
    } catch (e) {
      announce(socialError(e));
    } finally {
      setBusy('');
    }
  };

  // كل الموجودين الذين يمكن وضعهم في مقعد: الجالسون في مقاعد أخرى (بشر أو روبوتات) والمشاهدون
  const candidates = (seat: Seat) => [
    ...view.seats.map((s, i) => ({ s, i: i as Seat })).filter(({ s, i }) => s && i !== seat)
      .map(({ i }) => ({ uid: seatUid(i), label: `${occupantLabel(i)} — من المقعد ${i + 1}` })),
    ...view.spectators.map((m) => ({ uid: m.uid, label: `${m.username}${m.uid === uid ? ' (أنت)' : ''} — مشاهد` })),
  ].filter((c) => c.uid);

  // معرّف الجالس في مقعد (من قائمة المقاعد الخاصة بالمالك)
  const seatUid = (i: Seat) => view.seatUids[i] ?? '';

  return (
    <section aria-labelledby="seats-title" className="stack">
      <h2 id="seats-title">المقاعد</h2>
      {TEAMS.map((team) => (
        <div key={team.title} className="stack" role="group" aria-labelledby={`team-${team.seats[0]}`}>
          <h3 id={`team-${team.seats[0]}`} style={{ margin: '4px 0 0', fontSize: 17 }}>{team.title}</h3>
          {team.seats.map((i) => (
            <div key={i} className="seat-row">
              <span>المقعد {i + 1}: {occupantLabel(i)}</span>
              {isOwner && (
                <span className="seat-actions">
                  {!view.seats[i] ? (
                    <>
                      <button className="secondary" onClick={() => setPanel({ invite: i })} aria-label={`دعوة صديق للمقعد ${i + 1}`}>دعوة صديق</button>
                      <button className="secondary" onClick={() => send({ type: 'addBot', seat: i })} aria-label={`إضافة روبوت في المقعد ${i + 1}، ${COINS.addBot} عملة`}>روبوت ({COINS.addBot} 🪙)</button>
                    </>
                  ) : (
                    <button className="secondary" onClick={() => setPanel({ change: i })} aria-label={`تغيير المقعد ${i + 1}`}>تغيير</button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}

      {view.spectators.length > 0 && (
        <p className="note" style={{ fontSize: 15 }}>المشاهدون: {view.spectators.map((s) => (s.uid === uid ? `${s.username} (أنت)` : s.username)).join('، ')}</p>
      )}

      {isOwner
        ? <button onClick={() => send({ type: 'start' })} disabled={!view.seats.every(Boolean)}>بدء المباراة</button>
        : <p role="status">بانتظار مالك الطاولة لبدء المباراة</p>}

      {panel && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="seat-panel-title">
            {'invite' in panel ? (
              <>
                <h2 id="seat-panel-title" ref={titleRef} tabIndex={-1}>دعوة صديق للمقعد {panel.invite + 1}</h2>
                <p className="note">كل دعوة بعملة ({COINS.inviteFriend} 🪙)، ويدخل صديقك مجاناً ويجلس في هذا المقعد.</p>
                {friends === null && <p role="status">جارٍ التحميل…</p>}
                {friends?.length === 0 && <p>لا يوجد أصدقاء بعد. أضفهم من شاشة الأصدقاء، أو أضف روبوتاً.</p>}
                <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {[...(friends ?? [])].sort((a, b) => Number(!!b.online) - Number(!!a.online)).map((f) => (
                    <li key={f.uid} className="seat-row">
                      <span>{f.username}، {f.online ? 'متصل' : 'غير متصل'}</span>
                      {f.online && <button onClick={() => invite(f, panel.invite)} disabled={busy === f.uid} aria-label={`دعوة ${f.username}`}>دعوة</button>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 id="seat-panel-title" ref={titleRef} tabIndex={-1}>المقعد {panel.change + 1}: {occupantLabel(panel.change)}</h2>
                <p className="note">اختر من يجلس في هذا المقعد. إن كان جالساً في مقعد آخر يتبادلان.</p>
                <div className="stack">
                  {candidates(panel.change).map((c) => (
                    <button key={c.uid} className="secondary" onClick={() => { send({ type: 'replace', seat: panel.change, uid: c.uid }); setPanel(null); }}>
                      {c.label}
                    </button>
                  ))}
                  {candidates(panel.change).length === 0 && <p>لا يوجد أحد آخر في الطاولة.</p>}
                  <button className="danger" onClick={() => { send({ type: 'vacate', seat: panel.change }); setPanel(null); }}>
                    {view.seats[panel.change]?.isBot ? 'إزالة الروبوت' : panel.change === view.mySeat ? 'أخلِ مقعدي وأصبح مشاهداً' : 'إخلاء المقعد (يصبح مشاهداً)'}
                  </button>
                </div>
              </>
            )}
            <button className="secondary" onClick={() => setPanel(null)}>رجوع</button>
          </div>
        </div>
      )}
    </section>
  );
}
