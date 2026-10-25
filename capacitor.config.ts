import type { CapacitorConfig } from '@capacitor/cli';
import { existsSync } from 'node:fs';

// إضافة الدخول بـ Google تحتاج ملف إعدادات Firebase للأندرويد؛ بدونه نستبعدها حتى لا يتعطل التطبيق
const hasGoogleServices = existsSync('android/app/google-services.json');
const hasGoogleServiceInfo = existsSync('ios/GoogleService-Info.plist');

const config: CapacitorConfig = {
  appId: 'com.majlisk.app',
  appName: 'مجلسك',
  webDir: 'dist',
  backgroundColor: '#0d2b20',
  android: {
    backgroundColor: '#0d2b20',
    ...(hasGoogleServices ? {} : {
      includePlugins: ['@capacitor-community/admob', '@capacitor-community/text-to-speech', '@capacitor/app', '@capacitor/screen-reader'],
    }),
  },
  ios: {
    backgroundColor: '#0d2b20',
    contentInset: 'always',
    ...(hasGoogleServiceInfo ? {} : {
      includePlugins: ['@capacitor-community/admob', '@capacitor-community/text-to-speech', '@capacitor/app', '@capacitor/screen-reader'],
    }),
  },
  plugins: {
    // الدخول بـ Google داخل التطبيق: الإضافة تجلب حساب Google من الجهاز فقط،
    // وتسجيل الدخول نفسه يتم في Firebase JS (لتبقى الجلسة واحدة في كل المنصات)
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com', 'apple.com'] },
  },
};

export default config;
