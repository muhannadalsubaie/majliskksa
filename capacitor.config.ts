import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.majlisk.app',
  appName: 'مجلسك',
  webDir: 'dist',
  backgroundColor: '#0d2b20',
  android: { backgroundColor: '#0d2b20' },
  ios: { backgroundColor: '#0d2b20', contentInset: 'always' },
};

export default config;
