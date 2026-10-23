import { useCallback, useEffect, useRef, useState } from 'react';
import type { TableView } from '../../shared/table';
import { announce } from './announcer';
import { API_URL } from './api';
import { connectFirebase } from './firebase';

/** للتطوير المحلي فقط: ?devUser=اسم يستخدم توكن وهمي يقبله الخادم المحلي */
const devUser = import.meta.env.DEV ? new URLSearchParams(location.search).get('devUser') : null;

export async function getToken(): Promise<string> {
  if (devUser) return `dev:${devUser}:${devUser}`;
  const { auth } = await connectFirebase();
  if (!auth.currentUser) throw new Error('unauthenticated');
  return auth.currentUser.getIdToken();
}

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

export const createTable = (isPrivate: boolean) => post<{ id: string }>('/tables', { isPrivate }).then((r) => r.id);
export const joinTable = (id: string) => post<{ ok: true }>(`/tables/${id}/join`);

export const API_ERRORS: Record<string, string> = {
  'not-enough-coins': 'رصيدك من العملات لا يكفي',
  'no-username': 'اختر اسم مستخدم أولاً',
  'table-full': 'الطاولة ممتلئة',
  'not-found': 'الطاولة غير موجودة',
  'not-a-member': 'لست عضواً في هذه الطاولة',
};

export type ClientMessage =
  | { type: 'action'; action: Record<string, unknown> }
  | { type: 'addBot'; seat: number }
  | { type: 'start' }
  | { type: 'leave' };

/** اتصال حي بالطاولة: يستقبل الحالة والإعلانات، ويعيد الاتصال تلقائياً عند الانقطاع. */
export function useTable(tableId: string) {
  const [view, setView] = useState<TableView | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;
    let cancelled = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      const token = await getToken().catch(() => '');
      // قد تُغلق الشاشة أثناء انتظار التوكن — لا نفتح اتصالاً يتيماً
      if (cancelled) return;
      const url = `${API_URL.replace(/^http/, 'ws')}/tables/${tableId}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); retry = 0; };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'state') setView(msg.view);
        if (msg.type === 'events') {
          // كل حدث إعلان مستقل حتى يقرأها قارئ الشاشة بالترتيب
          for (const e of msg.events as string[]) announce(e);
        }
        if (msg.type === 'error') announce(msg.message);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) setConnected(false);
        if (cancelled || closedByUs.current) return;
        retry = Math.min(retry + 1, 5);
        timer = setTimeout(connect, 1000 * retry);
      };
    };
    void connect();
    return () => {
      cancelled = true;
      closedByUs.current = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [tableId]);

  const send = useCallback((m: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(m));
    else announce('جارٍ إعادة الاتصال بالطاولة…');
  }, []);

  return { view, connected, send };
}
