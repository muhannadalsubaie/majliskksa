import { useEffect, useRef, useState } from 'react';
import { joinVoice, leaveVoice, useVoice } from '../services/voice';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Switch } from './Switch';
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

type Page = 'main' | 'players' | 'invite' | 'settings' | 'stop' | { replace: Seat } | { member: string } | { confirm: 'kick' | 'ban'; uid: string };

/** قائمة الطاولة: اللاعبون، دعوة صديق، مشاهدة إعلان، مغادرة */
export function TableMenu({ view, uid, send, onLeave, onClose }: Props) {
  const [page, setPage] = useState<Page>('main');
  const voice = useVoice();
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
      s.away ? 'انقطع اتصاله' : '',
      view.mySeat !== null && i !== view.mySeat && teamOf(i) === teamOf(me) ? 'شريكك' : '',
    ].filter(Boolean);
    return `${s.username}${tags.length ? ` (${tags.join('، ')})` : ''}`;
  };

  const memberLabel = (u: string) =>
    view.seats[view.seatUids.indexOf(u)]?.username ?? view.spectators.find((s) => s.uid === u)?.username ?? 'هذا الشخص';

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
          {isOwner ? (
            <Switch
              label="طاولة خاصة"
              checked={view.isPrivate}
              onChange={(on) => send({ type: 'setPrivate', isPrivate: on })}
              description={view.isPrivate ? 'تظهر مقفلة في قائمة الطاولات، والدخول بالدعوة فقط.' : 'عامة: تظهر في قائمة الطاولات ويدخلها أي لاعب.'}
            />
          ) : (
            <p className="note" style={{ margin: 0 }}>{view.isPrivate ? 'طاولة خاصة: الدخول بالدعوة فقط' : 'طاولة عامة'}</p>
          )}
          <button className="secondary" onClick={() => setPage('players')}>اللاعبون</button>
          {isOwner && (
            <button className="secondary" onClick={() => setPage('invite')}>دعوة صديق</button>
          )}
          <button className="secondary" onClick={() => void watchRewardedAd()}>
            مشاهدة إعلان (+{COINS.watchAdReward} 🪙)
          </button>
          <button
            className="secondary"
            onClick={() => { void (voice.joined ? leaveVoice() : joinVoice(view.id, uid)); onClose(); }}
            disabled={voice.busy}
          >
            {voice.joined ? 'مغادرة المحادثة الصوتية' : 'الانضمام للمحادثة الصوتية'}
          </button>
          <button className="secondary" onClick={() => setPage('settings')}>الإعدادات</button>
          {isOwner && (view.game || view.seats.some(Boolean)) && (
            <button className="danger" onClick={() => setPage('stop')}>إيقاف اللعبة</button>
          )}
          <button className="danger" onClick={onLeave}>مغادرة الطاولة</button>
          <button className="secondary" onClick={onClose}>إغلاق القائمة</button>
        </div>
      </>
    );
  } else if (page === 'stop') {
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>إيقاف اللعبة</h2>
        <p>إيقاف نهائي: تُلغى المباراة وترجع النتيجة صفر صفر، ويصبح الجميع مشاهدين والمقاعد فارغة. بعدها تختار أنت من يلعب من صفحة اللاعبين.</p>
        <div className="actions">
          <button className="danger" onClick={() => { send({ type: 'stop' }); onClose(); }}>إيقاف اللعبة</button>
          <button className="secondary" onClick={() => setPage('main')}>إلغاء</button>
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
  } else if (page === 'settings') {
    // الإعدادات داخل الطاولة: نفس شاشة الإعدادات، والرجوع يعيدك للقائمة دون مغادرة اللعب
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1} className="sr-only">إعدادات</h2>
        <SettingsScreen navigate={() => setPage('main')} onClose={() => setPage('main')} />
      </>
    );
  } else if (page === 'players') {
    // المالك يضغط على أي حاضر (غيره) فتظهر خياراته: كتم، طرد، حظر، استبدال
    const canManage = (u: string | undefined) => isOwner && !!u && u !== uid && !u.startsWith('bot-');
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>اللاعبون</h2>
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {([0, 1, 2, 3] as Seat[]).map((i) => {
            const u = view.seatUids[i];
            const muted = view.voiceBlocked?.includes(u) ? '، مكتوم' : '';
            return (
              <li key={i} className="seat-row">
                {canManage(u)
                  ? <button className="secondary member-btn" onClick={() => setPage({ member: u })}>{seatLabel(i)}{muted}</button>
                  : <span>{seatLabel(i)}</span>}
                {isOwner && i !== view.mySeat && !canManage(u) && (
                  <button className="secondary" onClick={() => setPage({ replace: i })} aria-label={`استبدال ${view.seats[i]?.username ?? 'المقعد الفارغ'}`}>
                    استبدال
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <h3 style={{ fontSize: 17, margin: '8px 0 0' }}>المشاهدون</h3>
        {view.spectators.length ? (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {view.spectators.map((s) => (
              <li key={s.uid}>
                {canManage(s.uid)
                  ? <button className="secondary member-btn" onClick={() => setPage({ member: s.uid })}>{s.username} (مشاهد){view.voiceBlocked?.includes(s.uid) ? '، مكتوم' : ''}</button>
                  : <span>{s.username}{s.uid === uid ? ' (أنت)' : ''}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="note">لا يوجد مشاهدون</p>}
        {isOwner && <p className="note" style={{ margin: 0 }}>اضغط على أي شخص لكتمه أو طرده أو حظره.</p>}
        <button className="secondary back-btn" onClick={() => setPage('main')}>رجوع</button>
      </>
    );
  } else if ('member' in page) {
    // خيارات المالك لشخص واحد
    const u = page.member;
    const seat = view.seatUids.indexOf(u);
    const name = seat >= 0 ? view.seats[seat]?.username : view.spectators.find((s) => s.uid === u)?.username;
    const blocked = view.voiceBlocked?.includes(u) ?? false;
    body = !name ? (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>لم يعد على الطاولة</h2>
        <button className="secondary back-btn" onClick={() => setPage('players')}>رجوع</button>
      </>
    ) : (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>{name}</h2>
        <div className="stack">
          <button className="secondary" onClick={() => { send({ type: 'voiceBlock', uid: u, blocked: !blocked }); setPage('players'); }}>
            {blocked ? 'إلغاء الكتم في المحادثة الصوتية' : 'كتم في المحادثة الصوتية'}
          </button>
          {!blocked && <p className="note" style={{ margin: 0 }}>يبقى مكتوماً حتى تلغي الكتم، أو يغادر الطاولة ويعود.</p>}
          <button className="danger" onClick={() => setPage({ confirm: 'kick', uid: u })}>طرد من الطاولة</button>
          <button className="danger" onClick={() => setPage({ confirm: 'ban', uid: u })}>حظر من الطاولة</button>
          {seat >= 0 && view.seats[seat]?.away && (
            <button className="secondary" onClick={() => { send({ type: 'botNow', seat: seat as Seat }); setPage('players'); }}>روبوت مكانه الآن</button>
          )}
          {seat >= 0 && (
            <button className="secondary" onClick={() => setPage({ replace: seat as Seat })}>استبداله بمشاهد</button>
          )}
        </div>
        <button className="secondary back-btn" onClick={() => setPage('players')}>رجوع</button>
      </>
    );
  } else if ('confirm' in page) {
    const name = memberLabel(page.uid);
    const ban = page.confirm === 'ban';
    body = (
      <>
        <h2 id="menu-title" ref={titleRef} tabIndex={-1}>{ban ? `حظر ${name}؟` : `طرد ${name}؟`}</h2>
        <p style={{ margin: 0 }}>
          {ban
            ? 'سيخرج من الطاولة، ولن يستطيع دخول هذه الطاولة ولا أي طاولة تملكها.'
            : 'سيخرج من الطاولة. يستطيع دخول أي طاولة أخرى فوراً، والعودة لهذه الطاولة بعد ساعة.'}
          {view.game && view.game.phase !== 'matchOver' && view.seatUids.includes(page.uid) ? ' يحل روبوت مكانه في اللعب.' : ''}
        </p>
        <div className="actions">
          <button className="danger" onClick={() => { send({ type: ban ? 'ban' : 'kick', uid: page.uid }); setPage('players'); }}>{ban ? 'حظر' : 'طرد'}</button>
          <button className="secondary" onClick={() => setPage({ member: page.uid })}>إلغاء</button>
        </div>
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
