import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { announce } from '../services/announcer';
import { type Friend, type HubState, listBans, listFriends, removeFriend, requestFriend, respondFriend, socialError, unbanUser } from '../services/social';
import type { Navigate } from '../state/navigation';

type Tab = 'friends' | 'requests' | 'bans';
const TABS: Tab[] = ['friends', 'requests', 'bans'];

/** أيقونة شخص مع علامة زائد */
function AddPersonIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  );
}

/** الأصدقاء: تبويب للقائمة مع حالة الاتصال، وتبويب للطلبات الواردة، وزر إضافة صديق في الأعلى */
export function FriendsScreen({ navigate, hub }: { navigate: Navigate; hub: HubState }) {
  const [name, setName] = useState('');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [toRemove, setToRemove] = useState<Friend | null>(null);
  const [tab, setTab] = useState<Tab>('friends');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = { friends: useRef<HTMLButtonElement>(null), requests: useRef<HTMLButtonElement>(null), bans: useRef<HTMLButtonElement>(null) };
  const [bans, setBans] = useState<{ uid: string; username: string }[] | null>(null);

  // نافذة الإضافة: التركيز على الحقل، وEscape (أو زر الرجوع في الجهاز) يغلقها
  useEffect(() => {
    if (!adding) return;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setAdding(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding]);

  // الأسهم تنقل بين التبويبين
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // في الصفحة العربية: السهم الأيسر للتبويب التالي
    const step = e.key === 'ArrowLeft' ? 1 : -1;
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    tabRefs[next].current?.focus();
  };

  useEffect(() => {
    if (tab !== 'bans') return;
    listBans().then((r) => setBans(r.bans)).catch(() => setBans([]));
  }, [tab]);

  const refresh = useCallback(() => {
    listFriends().then((s) => setFriends(s.friends)).catch(() => setFriends([]));
  }, []);

  // تحديث القائمة عند أي تغيير في المركز، وكل 20 ثانية لحالة الاتصال
  useEffect(() => { refresh(); }, [refresh, hub.friends.length]);
  useEffect(() => { const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, [refresh]);

  const say = (text: string) => { setMessage(text); announce(text); };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await requestFriend(name.trim());
      say(r.friends ? `أصبحت أنت و${name.trim()} أصدقاء` : `أُرسل طلب الصداقة إلى ${name.trim()}`);
      setName('');
      setAdding(false);
      refresh();
    } catch (err) {
      say(socialError(err));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (f: Friend, accept: boolean) => {
    try {
      await respondFriend(f.uid, accept);
      say(accept ? `أصبحت أنت و${f.username} أصدقاء` : `رُفض طلب ${f.username}`);
      refresh();
    } catch (err) {
      say(socialError(err));
    }
  };

  const online = friends?.filter((f) => f.online) ?? [];
  const offline = friends?.filter((f) => !f.online) ?? [];

  return (
    <main className="screen" aria-labelledby="friends-title">
      <header className="topbar">
        <h1 id="friends-title">الأصدقاء</h1>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary icon-btn" onClick={() => setAdding(true)}>
            <AddPersonIcon />
            <span>إضافة صديق</span>
          </button>
          <button className="secondary back-btn" onClick={() => navigate('menu')}>رجوع</button>
        </span>
      </header>

      {message && <p role="status" style={{ margin: 0, color: 'var(--gold-soft)' }}>{message}</p>}

      <div className="tabs" role="tablist" aria-label="الأصدقاء والطلبات والمحظورون">
        <button
          ref={tabRefs.friends} role="tab" id="tab-friends" aria-controls="panel-friends"
          aria-selected={tab === 'friends'} tabIndex={tab === 'friends' ? 0 : -1}
          onClick={() => setTab('friends')} onKeyDown={onTabKey}
        >
          الأصدقاء{friends ? ` (${friends.length})` : ''}
        </button>
        <button
          ref={tabRefs.requests} role="tab" id="tab-requests" aria-controls="panel-requests"
          aria-selected={tab === 'requests'} tabIndex={tab === 'requests' ? 0 : -1}
          onClick={() => setTab('requests')} onKeyDown={onTabKey}
        >
          طلبات الصداقة
          {hub.requests.length > 0 && <span className="badge"> {hub.requests.length}</span>}
        </button>
        <button
          ref={tabRefs.bans} role="tab" id="tab-bans" aria-controls="panel-bans"
          aria-selected={tab === 'bans'} tabIndex={tab === 'bans' ? 0 : -1}
          onClick={() => setTab('bans')} onKeyDown={onTabKey}
        >
          المحظورون
        </button>
      </div>

      {tab === 'friends' ? (
        <section id="panel-friends" role="tabpanel" aria-labelledby="tab-friends" className="stack">
          {friends === null && <p role="status">جارٍ التحميل…</p>}
          {friends?.length === 0 && <p className="note">لا يوجد أصدقاء بعد — اضغط "إضافة صديق" في الأعلى وأضفه باسم المستخدم.</p>}
          {[...online, ...offline].map((f) => (
            <div key={f.uid} className="seat-row">
              <span>
                <span aria-hidden="true">{f.online ? '🟢 ' : '⚪ '}</span>
                {f.username}، {f.online ? 'متصل' : 'غير متصل'}
              </span>
              <button className="secondary" onClick={() => setToRemove(f)} aria-label={`حذف ${f.username} من الأصدقاء`}>حذف</button>
            </div>
          ))}
        </section>
      ) : tab === 'bans' ? (
        <section id="panel-bans" role="tabpanel" aria-labelledby="tab-bans" className="stack">
          <p className="note" style={{ margin: 0 }}>من حظرتهم لا يستطيعون دخول أي طاولة تملكها.</p>
          {bans === null && <p role="status">جارٍ التحميل…</p>}
          {bans?.length === 0 && <p className="note">لا يوجد محظورون.</p>}
          {bans?.map((b) => (
            <div key={b.uid} className="seat-row">
              <span>{b.username}</span>
              <button className="secondary" aria-label={`رفع الحظر عن ${b.username}`} onClick={async () => {
                try {
                  await unbanUser(b.uid);
                  setBans((list) => list?.filter((x) => x.uid !== b.uid) ?? null);
                  announce(`رُفع الحظر عن ${b.username}`);
                } catch (e) { announce(socialError(e)); }
              }}>رفع الحظر</button>
            </div>
          ))}
        </section>
      ) : (
        <section id="panel-requests" role="tabpanel" aria-labelledby="tab-requests" className="stack">
          {hub.requests.length === 0 && <p className="note">لا توجد طلبات صداقة.</p>}
          {hub.requests.map((r) => (
            <div key={r.uid} className="seat-row">
              <span>{r.username}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => respond(r, true)} aria-label={`قبول طلب ${r.username}`}>قبول</button>
                <button className="secondary" onClick={() => respond(r, false)} aria-label={`رفض طلب ${r.username}`}>رفض</button>
              </span>
            </div>
          ))}
        </section>
      )}

      {adding && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <h2 id="add-title">إضافة صديق</h2>
            <form className="stack" onSubmit={add}>
              <label className="stack" style={{ gap: 6 }}>
                اسم المستخدم
                <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
              </label>
              <div className="actions">
                <button type="submit" disabled={busy || !name.trim()}>إرسال طلب صداقة</button>
                <button type="button" className="secondary" onClick={() => setAdding(false)}>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toRemove && (
        <ConfirmDialog
          title="حذف صديق"
          message={`هل تريد حذف ${toRemove.username} من أصدقائك؟`}
          confirmLabel="حذف"
          danger
          onConfirm={async () => { await removeFriend(toRemove.uid).catch(() => {}); setToRemove(null); refresh(); }}
          onCancel={() => setToRemove(null)}
        />
      )}
    </main>
  );
}
