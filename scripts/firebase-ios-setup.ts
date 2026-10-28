// إعداد Firebase للآيفون مرة واحدة (يشغّله GitHub Actions بمفتاح الخادم):
//  1) يضمن وجود تطبيق iOS في مشروع Firebase بالمعرّف com.majlisk.app
//  2) ينزّل ملف GoogleService-Info.plist إلى ios/ (يقرؤه بناء الآيفون لتفعيل الدخول بجوجل وApple)
//  3) يفعّل الدخول بـ Apple في Firebase Auth لتطبيق الآيفون
import { writeFileSync } from 'node:fs';
import { accessToken, parseServiceAccount } from '../worker/src/firestore';

const BUNDLE = 'com.majlisk.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const project = parseServiceAccount(sa).project_id;
const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase');
const api = async (url: string, init: RequestInit = {}) => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
};
const FB = 'https://firebase.googleapis.com/v1beta1';

// 1) تطبيق iOS
const list = await api(`${FB}/projects/${project}/iosApps?pageSize=100`) as { apps?: { appId: string; bundleId: string }[] };
let app = list.apps?.find((a) => a.bundleId === BUNDLE);
if (!app) {
  console.log('creating Firebase iOS app…');
  let op = await api(`${FB}/projects/${project}/iosApps`, { method: 'POST', body: JSON.stringify({ bundleId: BUNDLE, displayName: 'مجلسك iOS' }) }) as { name: string; done?: boolean; response?: { appId: string; bundleId: string } };
  for (let i = 0; i < 30 && !op.done; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await api(`${FB}/${op.name}`);
  }
  if (!op.response) throw new Error('iOS app creation did not finish');
  app = op.response;
}
console.log('iOS app:', app.appId);

// 2) ملف الإعداد
const cfg = await api(`${FB}/projects/${project}/iosApps/${app.appId}/config`) as { configFileContents: string };
const plist = Buffer.from(cfg.configFileContents, 'base64').toString('utf8');
writeFileSync('ios/GoogleService-Info.plist', plist);
console.log('GoogleService-Info.plist written; REVERSED_CLIENT_ID present:', /REVERSED_CLIENT_ID/.test(plist));

// 3) الدخول بـ Apple (الآيفون يكفيه معرّف التطبيق؛ المتصفح والأندرويد يحتاجان Services ID ومفتاحاً من حساب Apple)
const IDP = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs`;
try {
  const cur = await api(`${IDP}/apple.com`).catch(() => null) as { enabled?: boolean; clientId?: string; appleSignInConfig?: { bundleIds?: string[] } } | null;
  const bundleIds = [...new Set([...(cur?.appleSignInConfig?.bundleIds ?? []), BUNDLE])];
  if (!cur) {
    await api(`${IDP}?idpId=apple.com`, { method: 'POST', body: JSON.stringify({ enabled: true, appleSignInConfig: { bundleIds } }) });
  } else {
    await api(`${IDP}/apple.com?updateMask=enabled,appleSignInConfig.bundleIds`, { method: 'PATCH', body: JSON.stringify({ enabled: true, appleSignInConfig: { bundleIds } }) });
  }
  console.log('Apple sign-in enabled in Firebase for', bundleIds.join(', '));
} catch (e) {
  console.log('could not enable Apple sign-in automatically:', (e as Error).message);
}
