import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../../shared/baloot/cards';
import { teamOf } from '../../shared/baloot/cards';
import { COINS } from '../../shared/economy';
import type { TableView } from '../../shared/table';
import { announce } from '../services/announcer';
import { API_ERRORS, type ClientMessage, createInvite, inviteLink } from '../services/tables';

interface Props {
  view: TableView;
  uid: string;
  send: (m: ClientMessage) => void;
  onLeave: () => void;
  onClose: () => void;
}

type Page = 'main' | 'players' | { replace: Seat };

/** قائمة الطاولة: اللاعبون، دعوة صديق، مشاهدة إعلان، مغادرة */
export function TableMenu({ view, uid, send, onLeave, onClose }: Props) {
  const [page, setPage] = useState<Page>('main');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
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

  const invite = async () => {
    setBusy(true);
    try {
      const url = inviteLink(view.id, await createInvite(view.id));
      setLink(url);
      if (navigator.share) {
        await navigator.share({ title: 'مجلسك', text: 'تعال العب معي بلوت في مجلسك', url }).catch(() => {});
      } else {
        await navigator.clipboard?.writeText(url).then(() => announce('تم نسخ رابط الدعوة')).catch(() => {});
      }
    } catch (e) {
      announce(API_ERRORS[(e as Error).message] ?? 'تعذّر إنشاء الدعوة');
    } finally {
      setBusy(false);
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
            <button className="secondary" onClick={invite} disabled={busy}>دعوة صديق ({COINS.inviteFriend} 🪙)</button>
          )}
          {link && (
            <p className="note" style={{ wordBreak: 'break-all' }}>
              رابط الدعوة (صالح لشخص واحد): <span dir="ltr">{link}</span>
            </p>
          )}
          <button className="secondary" onClick={() => announce('مشاهدة الإعلانات تتوفر في تطبيق الجوال قريباً')}>
            مشاهدة إعلان (+{COINS.watchAdReward} 🪙)
          </button>
          <button className="danger" onClick={onLeave}>مغادرة الطاولة</button>
          <button className="secondary" onClick={onClose}>إغلاق القائمة</button>
        </div>
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
        <button className="secondary" onClick={() => setPage('main')}>رجوع</button>
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
        <button className="secondary" onClick={() => setPage('players')}>رجوع</button>
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
