import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.majlisk.app',
  appName: 'مجلسك',
  webDir: 'dist',
  backgroundColor: '#0d2b20',
  android: { backgroundColor: '#0d2b20' },
  ios: { backgroundColor: '#0d2b20', contentInset: 'always' },
  plugins: {
    // الدخول بـ Google داخل التطبيق: الإضافة تجلب حساب Google من الجهاز فقط،
    // وتسجيل الدخول نفسه يتم في Firebase JS (لتبقى الجلسة واحدة في كل المنصات)
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] },
  },
};

export default config;
