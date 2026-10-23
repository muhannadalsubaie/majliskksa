import { useState, type FormEvent } from 'react';
import { signOut } from 'firebase/auth';
import { USERNAME_ERRORS, validateUsername } from '../../shared/username';
import { UsernameField } from '../components/UsernameField';
import { announce } from '../services/announcer';
import { api } from '../services/api';
import { connectFirebase } from '../services/firebase';

/** يظهر لأي حساب بلا اسم مستخدم (مثل أول دخول بحساب Google) قبل الوصول للقائمة. */
export function ChooseUsernameScreen() {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validateUsername(username);
    if (invalid) { setError(USERNAME_ERRORS[invalid]); announce(USERNAME_ERRORS[invalid]); return; }
    setBusy(true);
    setError('');
    try {
      const { auth } = await connectFirebase();
      if (!auth.currentUser) throw new Error('unauthenticated');
      await api(auth.currentUser, '/profile/username', { username });
      announce(`تم حجز اسم المستخدم ${username}`);
    } catch (err) {
      const code = (err as Error).message as keyof typeof USERNAME_ERRORS;
      const msg = USERNAME_ERRORS[code] ?? 'حدث خطأ، حاول مرة أخرى';
      setError(msg);
      announce(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen" aria-labelledby="choose-title">
      <img src="/icon.svg" alt="" width={88} height={88} style={{ alignSelf: 'center' }} />
      <h1 id="choose-title" style={{ textAlign: 'center' }}>اختر اسم المستخدم</h1>
      <p style={{ textAlign: 'center', color: 'var(--text-dim)', margin: 0 }}>
        هذا الاسم يظهر لكل اللاعبين ولا يمكن لأحد غيرك استخدامه.
      </p>
      <form className="stack" onSubmit={submit} noValidate>
        <UsernameField value={username} onChange={setUsername} />
        {error && <p role="alert" style={{ color: 'var(--gold-soft)', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>تأكيد</button>
      </form>
      <button className="secondary" disabled={busy} onClick={async () => signOut((await connectFirebase()).auth)}>
        تسجيل الخروج
      </button>
    </main>
  );
}
