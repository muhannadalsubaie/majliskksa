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
├─ worker/                  خادم Cloudflare Workers — الحكَم الوحيد على قانونية الحركات والعملات
│  └─ src/vivox.ts          مولّد توكنات Vivox
├─ native-plugins/vivox-voice/   إضافة Capacitor الأصلية (Kotlin + Swift)
├─ firestore.rules          العميل يقرأ فقط؛ الكتابة من الخادم فقط
├─ codemagic.yaml           بناء Android وiOS عند كل push
└─ capacitor.config.ts
```

## التشغيل محلياً

```bash
npm install
# إعدادات Firebase في ملف .env (قيم عامة)
npm run dev                  # http://localhost:5173
npm test                     # اختبارات قواعد اللعبة
```

إذا تعذّر الاتصال بـFirebase تعرض شاشة البداية زر إعادة المحاولة، وفي وضع التطوير زر "متابعة بدون خادم".

## الخادم (Cloudflare Workers)

```bash
cd worker && npm install && npx wrangler dev
```

يُنشر تلقائياً عبر GitHub Actions (`.github/workflows/deploy-worker.yml`) عند تعديل `worker/` أو `shared/`.
الأسرار المطلوبة في GitHub: `CLOUDFLARE_API_TOKEN`، `FIREBASE_SERVICE_ACCOUNT`.

> Firebase مستخدم لتسجيل الدخول وFirestore فقط (الباقة المجانية). قواعد Firestore في `firestore.rules` تُنشر يدوياً من لوحة Firebase.
