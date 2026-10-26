// تفضيلات محلية بسيطة على الجهاز
const MUTE_KEY = 'majlisk.muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === 'on'; } catch { return false; }
}

export function setMuted(on: boolean) {
  try { localStorage.setItem(MUTE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

// نغمة "دورك": مفعّلة افتراضياً
const TURN_CHIME_KEY = 'majlisk.turnChime';

export function isTurnChimeOn(): boolean {
  try { return localStorage.getItem(TURN_CHIME_KEY) !== 'off'; } catch { return true; }
}

export function setTurnChime(on: boolean) {
  try { localStorage.setItem(TURN_CHIME_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
