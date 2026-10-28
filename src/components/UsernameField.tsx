import { useEffect, useState } from 'react';
import { USERNAME_ERRORS, USERNAME_MAX, validateUsername, type UsernameError } from '../../shared/username';
import { apiPublic } from '../services/api';

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'error'; message: string };

/** حقل اسم المستخدم مع فحص فوري للصيغة والتوفر (القرار النهائي في الخادم). */
export function UsernameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (!value.trim()) { setStatus({ kind: 'idle' }); return; }
    const invalid = validateUsername(value);
    if (invalid) { setStatus({ kind: 'error', message: USERNAME_ERRORS[invalid] }); return; }
    setStatus({ kind: 'checking' });
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const r = await apiPublic<{ available: boolean; error?: UsernameError | 'taken' }>('/username/available', { username: value });
        if (stale) return;
        setStatus(r.available ? { kind: 'ok' } : { kind: 'error', message: USERNAME_ERRORS[r.error ?? 'taken'] });
      } catch {
        if (!stale) setStatus({ kind: 'idle' });
      }
    }, 450);
    return () => { stale = true; clearTimeout(t); };
  }, [value]);

  const hint = status.kind === 'checking' ? 'جارٍ التحقق…'
    : status.kind === 'ok' ? '✓ الاسم متاح'
      : status.kind === 'error' ? status.message
        : 'اسم فريد يظهر للاعبين — حروف عربية أو إنجليزية أو أرقام أو _';

  return (
    <label className="stack" style={{ gap: 6 }}>
      اسم المستخدم
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={USERNAME_MAX + 8}
        aria-invalid={status.kind === 'error'}
        required
      />
      <span
        id="username-hint"
        aria-live="polite"
        style={{ fontSize: 14, color: status.kind === 'error' ? 'var(--gold-soft)' : status.kind === 'ok' ? '#7fd48f' : 'var(--text-dim)' }}
      >
        {hint}
      </span>
    </label>
  );
}
