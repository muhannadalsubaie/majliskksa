import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { announce } from '../services/announcer';
import { type Friend, type HubState, listFriends, removeFriend, requestFriend, respondFriend, socialError } from '../services/social';
import type { Navigate } from '../state/navigation';

/** الأصدقاء: إضافة باسم المستخدم، الطلبات الواردة، والقائمة مع حالة الاتصال */
export function FriendsScreen({ navigate, hub }: { navigate: Navigate; hub: HubState }) {
  const [name, setName] = useState('');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [toRemove, setToRemove] = useState<Friend | null>(null);

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
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
      </header>

      <section aria-labelledby="add-title" className="stack">
        <h2 id="add-title">إضافة صديق</h2>
        <form className="stack" onSubmit={add}>
          <label className="stack" style={{ gap: 6 }}>
            اسم المستخدم
            <input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>إرسال طلب صداقة</button>
        </form>
        {message && <p role="status" style={{ margin: 0, color: 'var(--gold-soft)' }}>{message}</p>}
      </section>

      {hub.requests.length > 0 && (
        <section aria-labelledby="req-title" className="stack">
          <h2 id="req-title">طلبات الصداقة ({hub.requests.length})</h2>
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

      <section aria-labelledby="list-title" className="stack">
        <h2 id="list-title">أصدقائي{friends ? ` (${friends.length})` : ''}</h2>
        {friends === null && <p role="status">جارٍ التحميل…</p>}
        {friends?.length === 0 && <p className="note">لا يوجد أصدقاء بعد — أضف صديقاً باسم المستخدم.</p>}
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
