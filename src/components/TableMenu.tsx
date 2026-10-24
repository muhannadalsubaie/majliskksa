import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../../shared/baloot/cards';
import { teamOf } from '../../shared/baloot/cards';
import { COINS } from '../../shared/economy';
import type { TableView } from '../../shared/table';
import { announce } from '../services/announcer';
import type { ClientMessage } from '../services/tables';
import { watchRewardedAd } from '../services/ads';
import { type Friend, inviteFriend, listFriends, socialError } from '../services/social';

interface Props {
  view: TableView;
  uid: string;
  send: (m: ClientMessage) => void;
  onLeave: () => void;
  onClose: () => void;
}

type Page = 'main' | 'players' | 'invite' | { replace: Seat };

/** قائمة الطاولة: اللاعبون، دعوة صديق، مشاهدة إعلان، مغادرة */
export function TableMenu({ view, uid, send, onLeave, onClose }: Props) {
  const [page, setPage] = useState<Page>('main');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isOwner = view.ownerUid === uid;
  const me = view.mySeat ?? 0;

  // ننقل التركيز للعنوان عند فتح أي صفحة حتى يقرأها قارئ الشاشة
  useEffect(() => { titleRef.current?.focus(); }, [page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seatLabel = (i: Seat) => {
    const s = view.seats[i];
    if (!s) return 'مقعد فارغ';
    const tags = [
      i === view.mySeat ? 'أنت' : '',
      s.isBot ? 'روبوت' : '',
      view.mySeat !== null && i !== view.mySeat && teamOf(i) === teamOf(me) ? 'شريكك' : '',
    ].filter(Boolean);
    return `${s.username}${tags.length ? ` (${tags.join('، ')})` : ''}`;
  };

  // صفحة الدعوة: قائمة الأصدقاء مع حالة الاتصال (تُحدَّث كل 10 ثوانٍ)
  useEffect(() => {
    if (page !== 'invite') return;
    const load = () => listFriends().then((r) => setFriends(r.friends)).catch(() => setFriends([]));
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [page]);

  const invite = async (f: Friend) => {
    setBusy(f.uid);
    try {
      await inviteFriend(view.id, f.uid);
      announce(`أُرسلت الدعوة إلى ${f.username}`);
    } catch (e) {
      announce(socialError(e));
    } finally {
      setBusy('');
    }
  };

  let body;
  if (page === 'main') {
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>القائمة</h2>
        <div className="stack">
          <button className="secondary" onClick={() => setPage('players')}>اللاعبون</button>
          {isOwner && (
            <button className="secondary" onClick={() => setPage('invite')}>دعوة صديق</button>
          )}
          <button className="secondary" onClick={() => void watchRewardedAd()}>
            مشاهدة إعلان (+{COINS.watchAdReward} 🪙)
          </button>
          <button className="danger" onClick={onLeave}>مغادرة الطاولة</button>
          <button className="secondary" onClick={onClose}>إغلاق القائمة</button>
        </div>
      </>
    );
  } else if (page === 'invite') {
    const sorted = [...(friends ?? [])].sort((a, b) => Number(!!b.online) - Number(!!a.online));
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>دعوة صديق</h2>
        <p className="note">كل دعوة بعملة ({COINS.inviteFriend} 🪙)، ويدخل صديقك مجاناً.</p>
        {friends === null && <p role="status">جارٍ التحميل…</p>}
        {friends?.length === 0 && <p>لا يوجد أصدقاء بعد. أضفهم من شاشة الأصدقاء في القائمة الرئيسية.</p>}
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {sorted.map((f) => (
            <li key={f.uid} className="seat-row">
              <span>{f.username}، {f.online ? 'متصل' : 'غير متصل'}</span>
              {f.online && (
                <button onClick={() => invite(f)} disabled={busy === f.uid} aria-label={`دعوة ${f.username}`}>دعوة</button>
              )}
            </li>
          ))}
        </ul>
        <button className="secondary back-btn" onClick={() => setPage('main')}>رجوع</button>
      </>
    );
  } else if (page === 'players') {
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>اللاعبون</h2>
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {([0, 1, 2, 3] as Seat[]).map((i) => (
            <li key={i} className="seat-row">
              <span>{seatLabel(i)}</span>
              {isOwner && i !== view.mySeat && (
                <button className="secondary" onClick={() => setPage({ replace: i })} aria-label={`استبدال ${view.seats[i]?.username ?? 'المقعد الفارغ'}`}>
                  استبدال
                </button>
              )}
            </li>
          ))}
        </ul>
        <h3 style={{ fontSize: 17, margin: '8px 0 0' }}>المشاهدون</h3>
        {view.spectators.length
          ? <ul className="stack" style={{ margin: 0 }}>{view.spectators.map((s) => <li key={s.uid}>{s.username}</li>)}</ul>
          : <p className="note">لا يوجد مشاهدون</p>}
        <button className="secondary back-btn" onClick={() => setPage('main')}>رجوع</button>
      </>
    );
  } else {
    const seat = page.replace;
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>من يجلس مكان {view.seats[seat]?.username ?? 'المقعد الفارغ'}؟</h2>
        {view.spectators.length ? (
          <div className="stack">
            {view.spectators.map((s) => (
              <button key={s.uid} onClick={() => { send({ type: 'replace', seat, uid: s.uid }); setPage('players'); }}>
                {s.username}
              </button>
            ))}
          </div>
        ) : (
          <p>لا يوجد مشاهدون للاستبدال. ادعُ صديقاً أولاً، وبعد دخوله يظهر هنا.</p>
        )}
        <button className="secondary back-btn" onClick={() => setPage('players')}>رجوع</button>
      </>
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        {body}
      </div>
    </div>
  );
}
