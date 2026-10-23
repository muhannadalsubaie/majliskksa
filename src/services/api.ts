import type { User } from 'firebase/auth';

/** عنوان خادم Cloudflare — يُضبط في .env بعد أول نشر */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export async function api<T>(user: User, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new Error('api-not-configured');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http-${res.status}`);
  return data as T;
}
