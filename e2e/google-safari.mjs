// اختبار آلي للدخول بـ Google (و Apple) في محرك Safari (WebKit) — كآيفون وكماك — على الموقع الحقيقي:
// الضغط على "الدخول بحساب Google" يجب أن يفتح نافذة Google فوراً (بلا منع للنافذة ولا خطأ في الإعداد).
// لا يُكمل الدخول نفسه (يحتاج حساب Google حقيقي)، لكنه يتحقق من كل ما قبل ذلك.
import { devices, webkit } from 'playwright';

const SITE = process.env.SITE ?? 'https://majlisk-api.majlisk.workers.dev';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failed = false;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failed = true; };

const browser = await webkit.launch();
for (const [label, opts] of [['iPhone (Safari)', devices['iPhone 15']], ['Mac (Safari)', devices['Desktop Safari']]]) {
  const context = await browser.newContext({ ...opts, locale: 'ar-SA' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log(label, 'console:', m.text().slice(0, 200)); });
  try {
    await page.goto(SITE, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: 'الدخول بحساب Google' });
    await btn.waitFor({ timeout: 30000 });
    const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await btn.click();
    const popup = await popupPromise;
    check(Boolean(popup), `${label}: Google window opened on tap`);
    if (popup) {
      // نافذة Firebase تحوّل إلى صفحة اختيار حساب Google
      await popup.waitForURL(/accounts\.google\.com/, { timeout: 30000 }).catch(() => {});
      const url = popup.url();
      log(label, 'popup url:', url.slice(0, 140));
      check(/accounts\.google\.com/.test(url), `${label}: reached Google account chooser`);
      const body = await popup.textContent('body').catch(() => '') ?? '';
      check(!/redirect_uri_mismatch|invalid_request|Error 400/i.test(body), `${label}: no Google configuration error`);
      await popup.close().catch(() => {});
    }
    // لا رسالة خطأ في الصفحة (نطاق غير مصرح، نافذة ممنوعة...)
    await page.waitForTimeout(1500);
    const alert = await page.locator('[role="alert"]').textContent().catch(() => null);
    check(!alert || /إغلاق نافذة الدخول/.test(alert), `${label}: no sign-in error shown (${alert ?? 'none'})`);
    // الدخول بـ Apple: النافذة يجب أن تُفتح لحظة الضغط. الوصول لصفحة Apple يحتاج تفعيل Apple في Firebase
    // (يحتاج حساب مطوّر Apple)، فنسجّل النتيجة فقط ولا نُفشل الاختبار بسببها
    const apple = page.getByRole('button', { name: 'الدخول بحساب Apple' });
    const applePopupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await apple.click();
    const applePopup = await applePopupPromise;
    check(Boolean(applePopup), `${label}: Apple window opened on tap`);
    if (applePopup) {
      await applePopup.waitForURL(/appleid\.apple\.com/, { timeout: 20000 }).catch(() => {});
      log(label, 'apple popup url:', applePopup.url().slice(0, 140), /appleid\.apple\.com/.test(applePopup.url()) ? '(Apple sign-in page reached)' : '(Apple not configured yet)');
      await applePopup.close().catch(() => {});
    }
    await page.waitForTimeout(1500);
    log(label, 'after Apple:', await page.locator('[role="alert"]').textContent().catch(() => null) ?? 'no message');
  } catch (e) {
    log(label, 'ERROR', e?.message ?? e);
    failed = true;
  }
  await context.close();
}
await browser.close();
log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASSED');
process.exit(failed ? 1 : 0);
