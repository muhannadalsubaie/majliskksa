# مجلسك

لعبة بلوت أونلاين لأربعة لاعبين — React + Vite، مغلّفة بـCapacitor (Android/iOS)، مع Firebase وVivox وAdMob.

## الهيكل

```
├─ src/                     الواجهة (React + TypeScript)
│  ├─ screens/              الشاشات (البداية، القائمة، الطاولة، الإعدادات…)
│  ├─ components/           مكونات مشتركة (صندوق التأكيد، زر المحادثة الصوتية)
│  ├─ services/             Firebase، النطق وإمكانية الوصول
│  ├─ plugins/              واجهة إضافة Vivox + بديل المتصفح
│  ├─ state/                التنقل وحالة التطبيق
│  └─ styles/theme.css      الهوية البصرية (#0d2b20 + #d4af37)
├─ shared/                  كود مشترك بين الواجهة والخادم (قواعد البلوت، الاقتصاد)
├─ functions/               Firebase Cloud Functions — الحكَم الوحيد على قانونية الحركات والعملات
│  └─ src/vivox/            مولّد توكنات Vivox
├─ native-plugins/vivox-voice/   إضافة Capacitor الأصلية (Kotlin + Swift)
├─ firestore.rules          العميل يقرأ فقط؛ الكتابة من الخادم فقط
├─ codemagic.yaml           بناء Android وiOS عند كل push
└─ capacitor.config.ts
```

## التشغيل محلياً

```bash
npm install
cp .env.example .env.local   # ثم املأ مفاتيح Firebase
npm run dev                  # http://localhost:5173
npm test                     # اختبارات قواعد اللعبة
```

بدون مفاتيح Firebase تعرض شاشة البداية زر "متابعة بدون خادم" (في وضع التطوير فقط).

## Cloud Functions

```bash
cd functions && npm install && npm run build
```

`npm run build` ينسخ مجلد `shared/` إلى `functions/src/shared/` قبل الترجمة، لأن النشر يرفع مجلد `functions` وحده.
