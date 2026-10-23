// زر الرجوع في أندرويد: يرجع داخل التطبيق بدل الخروج منه.
//  • نافذة مفتوحة (قائمة، تأكيد، دعوة): تُغلق كأنها Escape
//  • غير ذلك: الشاشة الحالية تقرر (رجوع للصفحة السابقة)، وفي الصفحة الرئيسية يُصغَّر التطبيق
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function initBackButton(onBack: () => boolean) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = App.addListener('backButton', () => {
    if (document.querySelector('[aria-modal="true"]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }
    if (!onBack()) void App.minimizeApp();
  });
  return () => { void handle.then((h) => h.remove()); };
}

/** حدث تستمع له شاشة الطاولة: الرجوع فيها يفتح القائمة (فيها خيار المغادرة) */
export const TABLE_BACK = 'majlisk:table-back';
