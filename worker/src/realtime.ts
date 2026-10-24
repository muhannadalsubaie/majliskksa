// عميل Cloudflare Realtime (SFU) للمحادثة الصوتية.
// مفتاح التطبيق سري ويبقى في الخادم؛ التطبيق يرسل عروض WebRTC عبرنا فقط.
// https://developers.cloudflare.com/realtime/sfu/

const BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export interface SessionDescription { type: 'offer' | 'answer'; sdp: string }

export interface TracksResponse {
  sessionDescription?: SessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }[];
  errorCode?: string;
  errorDescription?: string;
}

export class Realtime {
  constructor(private appId: string, private secret: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}/${this.appId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { errorCode?: string; errorDescription?: string };
    if (!res.ok || data.errorCode) throw new Error(`realtime: ${data.errorCode ?? res.status} ${data.errorDescription ?? ''}`.trim());
    return data;
  }

  /** جلسة جديدة + نشر الميكروفون فيها */
  async publish(offer: SessionDescription, mid: string, trackName: string): Promise<{ sessionId: string; answer: SessionDescription }> {
    const { sessionId } = await this.call<{ sessionId: string }>('POST', '/sessions/new');
    const r = await this.call<TracksResponse>('POST', `/sessions/${sessionId}/tracks/new`, {
      sessionDescription: offer,
      tracks: [{ location: 'local', mid, trackName }],
    });
    if (!r.sessionDescription) throw new Error('realtime: no answer');
    return { sessionId, answer: r.sessionDescription };
  }

  /** سحب صوت شخص آخر إلى جلستي — يرجع عرضاً يجيب عليه التطبيق */
  pull(sessionId: string, remoteSessionId: string, trackName: string): Promise<TracksResponse> {
    return this.call<TracksResponse>('POST', `/sessions/${sessionId}/tracks/new`, {
      tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName }],
    });
  }

  renegotiate(sessionId: string, answer: SessionDescription): Promise<unknown> {
    return this.call('PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription: answer });
  }

  close(sessionId: string, mids: string[]): Promise<unknown> {
    return this.call('PUT', `/sessions/${sessionId}/tracks/close`, { tracks: mids.map((mid) => ({ mid })), force: true });
  }
}
