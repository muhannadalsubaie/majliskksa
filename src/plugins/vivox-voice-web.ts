import { WebPlugin } from '@capacitor/core';
import type { VivoxVoicePlugin } from './vivox-voice-plugin';

/** بديل للمتصفح أثناء التطوير — لا ينقل صوتاً فعلياً. */
export class VivoxVoiceWeb extends WebPlugin implements VivoxVoicePlugin {
  private connected = false;
  async initialize() {}
  async joinChannel() { this.connected = true; }
  async leaveChannel() { this.connected = false; }
  async setMicrophoneMuted() {}
  async isConnected() { return { connected: this.connected }; }
}
