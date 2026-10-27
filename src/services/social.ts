import { useEffect, useRef, useState } from 'react';
import { announce } from './announcer';
import { API_URL } from './api';
import { getToken } from './tables';

export interface Friend { uid: string; username: string; online?: boolean }
export interface TableInvite { tableId: string; code: string; fromUid: string; fromName: string; at: number }
export interface HubState { friends: Friend[]; requests: Friend[]; invites: TableInvite[] }

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http-${res.status}`);
  return data as T;
}

/** الأصدقاء مع حالة الاتصال الحالية */
export const listFriends = () => post<HubState>('/friends/list');
export const requestFriend = (username: string) => post<{ ok: true; friends?: boolean }>('/friends/request', { username });
export const respondFriend = (uid: string, accept: boolean) => post('/friends/respond', { uid, accept });
export const removeFriend = (uid: string) => post('/friends/remove', { uid });
export const listBans = () => post<{ bans: { uid: string; username: string }[] }>('/bans/list');
export const unbanUser = (uid: string) => post('/bans/remove', { uid });
export const inviteFriend = (tableId: string, uid: string, seat?: number) => post(`/tables/${tableId}/inviteFriend`, { uid, seat });
export const respondInvite = (tableId: string, accept: boolean) => post<{ ok: true; tableId?: string }>('/invites/respond', { tableId, accept });

export const SOCIAL_ERRORS: Record<string, string> = {
  'user-not-found': 'لا يوجد لاعب بهذا الاسم',
  self: 'هذا اسمك أنت',
  'already-friends': 'أنتما صديقان بالفعل',
  'not-friends': 'هذا اللاعب ليس في قائمة أصدقائك',
  offline: 'صديقك غير متصل الآن',
  'no-invite': 'انتهت صلاحية الدعوة',
  'not-enough-coins': 'رصيدك من العملات لا يكفي',
  'not-owner': 'الدعوة لمالك الطاولة فقط',
  'table-full': 'الطاولة ممتلئة',
  'not-found': 'الطاولة لم تعد موجودة',
  'no-username': 'اختر اسم مستخدم أولاً',
};

export const socialError = (e: unknown) => SOCIAL_ERRORS[(e as Error).message] ?? 'حدث خطأ، حاول مرة أخرى';

/**
 * اتصال دائم بمركز اللاعب أثناء تشغيل التطبيق:
 * يجعلك "متصلاً" لأصدقائك، ويستقبل طلبات الصداقة والدعوات فوراً.
 */
export function useHub(enabled: boolean): HubState {
  const [state, setState] = useState<HubState>({ friends: [], requests: [], invites: [] });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !API_URL) return;
    let cancelled = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = async () => {
      const token = await getToken().catch(() => '');
      if (cancelled || !token) return;
      const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/me/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 30_000);
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'state') setState({ friends: msg.friends, requests: msg.requests, invites: msg.invites });
        if (msg.type === 'notice') announce(msg.text);
        if (msg.type === 'invite') announce(`${msg.invite.fromName} يدعوك لطاولته`);
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (cancelled) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 1500 * retry);
      };
    };
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [enabled]);

  return state;
}
