// src/plugins/vivox-voice-plugin.ts
import { registerPlugin } from '@capacitor/core';

export interface VivoxVoicePlugin {
  initialize(options: { server: string; domain: string; issuer: string }): Promise<void>;
  joinChannel(options: { token: string; channelName: string }): Promise<void>;
  leaveChannel(): Promise<void>;
  setMicrophoneMuted(options: { muted: boolean }): Promise<void>;
  isConnected(): Promise<{ connected: boolean }>;
}

const VivoxVoice = registerPlugin<VivoxVoicePlugin>('VivoxVoice', {
  // لا يوجد SDK ويب رسمي لـVivox: في المتصفح نستخدم بديلاً وهمياً للتطوير فقط.
  web: () => import('./vivox-voice-web').then((m) => new m.VivoxVoiceWeb()),
});
export default VivoxVoice;
