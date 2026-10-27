// اختبار آلي للمحادثة الصوتية على الموقع الحقيقي بمتصفحين وحسابين تجريبيين (يُحذفان في النهاية):
// الانضمام التلقائي وثباته، فتح الميكروفون ووصول الصوت للآخر، العودة بعد انقطاع الإنترنت،
// والخروج المقصود دون إعادة إدخال، ثم الضغط من خارج المحادثة يعيدك ويفتح الميكروفون.
import { chromium } from 'playwright';

const SITE = process.env.SITE ?? 'https://majlisk-api.majlisk.workers.dev';
const KEY = process.env.FIREBASE_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failed = false;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failed = true; };

async function api(token, path, body) {
  const r = await fetch(`${SITE}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return r.json().catch(() => ({}));
}

async function makeUser(tag) {
  const letters = () => Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
  const email = `e2e-${tag}-${Date.now()}@majlisk-test.dev`;
  const password = `Pw-${letters()}-${Date.now()}`;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((x) => x.json());
  if (!r.idToken) throw new Error(`signup failed: ${JSON.stringify(r).slice(0, 200)}`);
  await api(r.idToken, '/profile/ensure');
  const username = `e2e${tag}${letters()}`;
  const u = await api(r.idToken, '/profile/username', { username });
  log('user', tag, username, JSON.stringify(u).slice(0, 80));
  return { email, password, token: r.idToken, username };
}

async function login(context, u) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('INTERNET_DISCONNECTED')) log(u.username, 'console:', m.text().slice(0, 160)); });
  // تفاصيل أي طلب صوت فشل (للتشخيص)
  page.on('response', async (res) => {
    if (res.url().includes('/voice') && res.status() >= 400) {
      const req = res.request().postData() ?? '';
      log(u.username, 'voice', res.status(), (await res.text().catch(() => '')).slice(0, 200), 'op:', (req.match(/"op":"(\w+)"/) ?? [])[1]);
    }
  });
  await page.goto(`${SITE}/?v=e2e${Date.now()}`);
  await page.getByLabel('البريد الإلكتروني').fill(u.email, { timeout: 30000 });
  await page.getByLabel('كلمة المرور').fill(u.password);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await page.getByRole('button', { name: 'إنشاء طاولة' }).waitFor({ timeout: 30000 });
  return page;
}

const status = (page) => page.locator('.voice-btn span').textContent().catch(() => '');
const voice = (page) => page.evaluate(() => window.__voice?.()).catch(() => null);

async function waitStatus(page, want, ms, who) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await status(page)) === want) return true; await sleep(300); }
  log(who, 'status is', await status(page), JSON.stringify(await voice(page)));
  return false;
}

/** يراقب الحالة مدة ويتأكد أنها لم تتغير (لا طرد ولا إعادة إدخال متكرر) */
async function stable(page, want, ms) {
  const seen = new Set();
  const end = Date.now() + ms;
  while (Date.now() < end) { seen.add(await status(page)); await sleep(250); }
  return seen.size === 1 && seen.has(want) ? true : (log('seen states:', [...seen].join(' | ')), false);
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const users = [];
const pages = [];
try {
  const A = await makeUser('a'); users.push(A);
  const B = await makeUser('b'); users.push(B);
  const ctxA = await browser.newContext({ permissions: ['microphone'] });
  const ctxB = await browser.newContext({ permissions: ['microphone'] });
  const pa = await login(ctxA, A);
  const pb = await login(ctxB, B);
  pages.push(pa, pb);
  log('both signed in');

  await pa.getByRole('button', { name: 'إنشاء طاولة' }).click();
  // أولاً اختيار اللعبة
  await pa.getByRole('button', { name: /^بلوت/ }).click();
  await pa.getByRole('button', { name: /إنشاء الطاولة/ }).click();
  await pa.locator('.voice-btn').waitFor({ timeout: 30000 });
  log('A created a table');

  await pb.getByRole('button', { name: 'انضمام إلى طاولة' }).click();
  const row = pb.getByRole('button', { name: new RegExp(`طاولة ${A.username}`) });
  for (let i = 0; i < 20 && !(await row.count()); i++) { await sleep(1500); await pb.reload().catch(() => {}); if (i > 0) { await pb.getByRole('button', { name: 'انضمام إلى طاولة' }).click().catch(() => {}); } }
  await row.first().click();
  await pb.locator('.voice-btn').waitFor({ timeout: 30000 });
  log('B joined the table');

  check(await waitStatus(pa, 'الميكروفون مغلق', 30000, 'A'), 'A auto-joined voice (mic closed)');
  check(await waitStatus(pb, 'الميكروفون مغلق', 30000, 'B'), 'B auto-joined voice (mic closed)');
  check(await stable(pb, 'الميكروفون مغلق', 15000), 'B stays in voice for 15s (no kick / rejoin loop)');
  check(await stable(pa, 'الميكروفون مغلق', 3000), 'A stays in voice');

  await pa.locator('.voice-btn').click();
  check(await waitStatus(pa, 'الميكروفون مفتوح', 20000, 'A'), 'A opened the mic');
  let heard = false;
  for (let i = 0; i < 60 && !heard; i++) { const v = await voice(pb); heard = v?.players >= 1 && v?.pc === 'connected'; if (!heard) await sleep(500); }
  log('B voice', JSON.stringify(await voice(pb)));
  check(heard, 'B receives A\'s audio');

  log('B goes offline for 12s');
  await ctxB.setOffline(true); await sleep(12000); await ctxB.setOffline(false);
  check(await waitStatus(pb, 'الميكروفون مغلق', 60000, 'B'), 'B is back in voice after reconnecting (mic closed)');
  let heardAgain = false;
  for (let i = 0; i < 60 && !heardAgain; i++) { const v = await voice(pb); heardAgain = v?.players >= 1 && v?.pc === 'connected'; if (!heardAgain) await sleep(500); }
  check(heardAgain, 'B hears A again after reconnecting');

  await pb.locator('.voice-btn').dispatchEvent('contextmenu');
  check(await waitStatus(pb, 'أنت خارج المحادثة الصوتية', 10000, 'B'), 'long press: B left voice');
  check(await stable(pb, 'أنت خارج المحادثة الصوتية', 8000), 'B stays out (no automatic rejoin after leaving)');

  await pb.locator('.voice-btn').click();
  check(await stable(pb, 'أنت خارج المحادثة الصوتية', 4000), 'tap while out: B stays out');
  await pb.locator('.voice-btn').dispatchEvent('contextmenu');
  check(await waitStatus(pb, 'الميكروفون مغلق', 20000, 'B'), 'long press while out: B rejoined (mic closed)');
} catch (e) {
  log('ERROR', e?.message ?? e);
  failed = true;
} finally {
  // نغادر الطاولة قبل حذف الحسابين، فتُغلق ولا تبقى في قائمة الطاولات
  for (const page of pages) {
    try {
      await page.getByRole('button', { name: 'القائمة' }).click({ timeout: 5000 });
      await page.getByRole('button', { name: 'مغادرة الطاولة' }).click({ timeout: 5000 });
      await page.getByRole('button', { name: 'مغادرة', exact: true }).click({ timeout: 5000 });
      await sleep(1500);
    } catch (e) { log('leave table failed', e?.message ?? e); }
  }
  log('server voice-status', await fetch(`${SITE}/api/voice-status`).then((r) => r.text()).catch(() => ''));
  for (const u of users) log('delete', u.username, JSON.stringify(await api(u.token, '/me/delete')));
  await browser.close();
}
log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASSED');
process.exit(failed ? 1 : 0);
