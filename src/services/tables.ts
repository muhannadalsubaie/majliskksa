import { useCallback, useEffect, useRef, useState } from 'react';
import type { TableView } from '../../shared/table';
import type { GameKind, GameVariant } from '../../shared/games';
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

/** true/false = الجواب من الخادم، null = لا شبكة (نستمر بالمحاولة) */
async function isMember(tableId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${API_URL}/tables/${tableId}/member`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (!res.ok) return null;
    return Boolean(((await res.json()) as { member?: boolean }).member);
  } catch {
    return null;
  }
}

/** حذف الحساب نهائياً من الخادم (الملف، اسم المستخدم، الأصدقاء، وحساب الدخول) */
export const deleteMyAccount = () => post<{ ok: true }>('/me/delete');

export const createTable = (isPrivate: boolean, kind: GameKind = 'baloot', variant: GameVariant = 'classic') =>
  post<{ id: string }>('/tables', { isPrivate, kind, variant }).then((r) => r.id);
export const joinTable = (id: string, invite?: string) => post<{ ok: true }>(`/tables/${id}/join`, { invite });


export const API_ERRORS: Record<string, string> = {
  'not-enough-coins': 'رصيدك من العملات لا يكفي',
  'no-username': 'اختر اسم مستخدم أولاً',
  'table-full': 'الطاولة ممتلئة',
  banned: 'مالك الطاولة حظرك من هذه الطاولة',
  'banned-by-owner': 'مالك هذه الطاولة حظرك، فلا يمكنك دخول طاولاته',
  kicked: 'أُخرجت من هذه الطاولة، ويمكنك العودة إليها بعد ساعة من طردك. يمكنك دخول أي طاولة أخرى الآن',
  'not-found': 'الطاولة غير موجودة',
  'not-a-member': 'لست عضواً في هذه الطاولة',
  'private': 'هذه طاولة خاصة — تحتاج دعوة من مالكها',
  'not-owner': 'هذا الإجراء لمالك الطاولة فقط',
};

export type ClientMessage =
  | { type: 'action'; action: Record<string, unknown> }
  | { type: 'domino'; action: Record<string, unknown> }
  | { type: 'jackaroo'; action: Record<string, unknown> }
  | { type: 'addBot'; seat: number }
  | { type: 'start' }
  | { type: 'leave' }
  | { type: 'replace'; seat: number; uid: string }
  | { type: 'vacate'; seat: number }
  | { type: 'botNow'; seat: number }
  | { type: 'stop' }
  | { type: 'kick'; uid: string }
  | { type: 'ban'; uid: string }
  | { type: 'voiceBlock'; uid: string; blocked: boolean }
  | { type: 'setPrivate'; isPrivate: boolean };

/** اتصال حي بالطاولة: يستقبل الحالة والإعلانات، ويعيد الاتصال تلقائياً عند الانقطاع. */
export function useTable(tableId: string) {
  const [view, setView] = useState<TableView | null>(null);
  const [connected, setConnected] = useState(false);
  const [closed, setClosed] = useState(false);
  /** أخرجه المالك (أو حظره): لا نعيد الاتصال */
  const [kicked, setKicked] = useState<null | 'kicked' | 'banned'>(null);
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
        if (msg.type === 'kicked') {
          closedByUs.current = true;
          setKicked(msg.banned ? 'banned' : 'kicked');
          announce(msg.banned ? 'حظرك مالك الطاولة' : 'أخرجك مالك الطاولة');
        }
        if (msg.type === 'closed') {
          closedByUs.current = true; // لا نعيد الاتصال بطاولة مغلقة
          setClosed(true);
          announce('أُغلقت الطاولة');
        }
      };
      ws.onclose = async () => {
        if (wsRef.current === ws) setConnected(false);
        if (cancelled || closedByUs.current || wsRef.current !== ws) return;
        retry = Math.min(retry + 1, 6);
        // بعد عدة محاولات: هل الطاولة أُغلقت أو أُخرجنا منها؟ أم الشبكة فقط (مكالمة، تنقل بين الشبكات)؟
        if (retry >= 3) {
          const member = await isMember(tableId);
          if (cancelled) return;
          if (member === false) { setClosed(true); return; }
        }
        timer = setTimeout(connect, 1000 * retry);
      };
    };
    void connect();
    // العودة للتطبيق (بعد مكالمة أو تطبيق آخر): نعيد الاتصال فوراً بدل انتظار المحاولة التالية
    const onVisible = () => {
      if (document.hidden || cancelled || closedByUs.current) return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      clearTimeout(timer);
      retry = 0;
      void connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      cancelled = true;
      closedByUs.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [tableId]);

  const send = useCallback((m: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(m));
    else announce('جارٍ إعادة الاتصال بالطاولة…');
  }, []);

  return { view, connected, closed, kicked, send };
}
