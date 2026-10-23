// تفضيلات محلية بسيطة على الجهاز
const MUTE_KEY = 'majlisk.muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === 'on'; } catch { return false; }
}

export function setMuted(on: boolean) {
  try { localStorage.setItem(MUTE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
