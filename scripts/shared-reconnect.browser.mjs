// Real production-build UI with two real accounts. Runtime JSON on stdin only:
// { manager: { username, pin }, worker: { username, pin } }. No traces/storage exports.
// PLAYWRIGHT_MODULE can point to a separately installed Playwright module.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_UI_URL || 'http://127.0.0.1:5178';
const out = process.env.TEST_UI_OUT || '.testsprite/shared-reconnect-followup/browser';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input || '{}'); input = '';
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'msedge', headless: true });
const results = [], actors = {}, owned = [], prefix = `KTR-${Date.now().toString(36)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const card = (a, name) => a.page.locator('.card-shadow,.card-shadow-finished').filter({ has: a.page.getByRole('heading', { name, exact: true }) });
const button = (a, name, label) => card(a, name).getByRole('button', { name: label, exact: true });
const state = a => a.page.locator('[data-state]').first().getAttribute('data-state');
const ready = a => a.page.locator('[data-state="ready"]').waitFor({ timeout: 45000 });
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw Error('Observable condition timed out');
}
function clean(error) {
  let text = String(error?.message || error);
  for (const c of Object.values(credentials)) for (const secret of Object.values(c)) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED_TOKEN]').slice(0, 1400);
}
async function test(id, fn) {
  const result = { id, runner: 'Independent real browser / real backend, controlled network; not TestSprite cloud' };
  try { result.detail = await fn(); result.status = 'PASS'; }
  catch (error) {
    result.status = error.message.startsWith('BLOCKED:') ? 'BLOCKED' : 'FAIL'; result.error = clean(error);
    result.network = Object.values(actors).map(a => ({ role: a.role, phases: a.phases.map(({ path, status }) => ({ path, status })), failures: a.failures, socket: a.socket }));
  }
  results.push(result); await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(result));
}
async function login(a, role = a.role) {
  await a.page.goto(`${base}/login`);
  await a.page.getByLabel('Kullanıcı adı', { exact: true }).fill(credentials[role].username);
  await a.page.getByLabel('PIN', { exact: true }).fill(credentials[role].pin);
  const response = a.page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/auth/login'), { timeout: 60000 });
  await a.page.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
  const receipt = await response;
  assert.equal(receipt.ok(), true, `Real login HTTP status ${receipt.status()}`);
  await a.page.waitForURL(`${base}/`);
}
async function shared(a) {
  await a.page.getByRole('button', { name: 'Ortak', exact: true }).click(); await ready(a);
  assert.equal(await a.page.getByRole('button', { name: /Tümünü|Toplu işlem/ }).count(), 0);
}
async function add(a, name, personal = false) {
  owned.push({ name, role: a.role, personal });
  await a.page.getByRole('button', { name: 'Yeni ekle', exact: true }).click();
  await a.page.locator('#new-timer-name').fill(name); await a.page.locator('#new-timer-duration').fill('60');
  await a.page.getByRole('button', { name: personal ? 'kronometre oluştur' : 'ortak kronometre oluştur', exact: true }).click();
  await a.page.getByRole('dialog').waitFor({ state: 'detached' });
  await button(a, name, 'Durdur').waitFor();
}
async function both(name, label) { for (const a of Object.values(actors)) await button(a, name, label).waitFor(); }
async function pause(a, name) { if (await button(a, name, 'Durdur').count()) await button(a, name, 'Durdur').click(); await both(name, 'Başlat'); }
await mkdir(out, { recursive: true });
let main;
try {
  await test('REAL-TWO-USER-SINGLE-OPERATIONS', async () => {
    if (!credentials.manager || !credentials.worker) throw Error('BLOCKED: Runtime account inputs missing');
    for (const role of ['manager', 'worker']) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      const a = { role, context, page, commands: [], phases: [], failures: [], socket: { opened: 0, closed: 0, connected: 0 } }; actors[role] = a;
      page.on('requestfailed', request => a.failures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
      // The namespace may authenticate over polling before WebSocket upgrade.
      // Count only the app's accepted-connect signal; never retain log contents.
      page.on('console', entry => { if (entry.text().startsWith('[Socket] Bağlandı:')) a.socket.connected++; });
      page.on('websocket', ws => {
        a.socket.opened++; ws.on('close', () => a.socket.closed++);
      });
      page.on('request', request => { if (new URL(request.url()).pathname === '/timers/shared/commands') a.commands.push(request.postDataJSON()); });
      page.on('response', async response => {
        try {
          const path = new URL(response.url()).pathname;
          if (path.endsWith('/auth/login') && response.ok()) a.identity = (await response.json()).user;
          if (path === '/workspace' && response.ok()) a.workspace = (await response.json()).workspace;
          if (['/workspace', '/account/experience', '/timers/shared'].includes(path)) a.phases.push({ path, status: response.status(), at: Date.now() });
        } catch { /* page teardown can cancel response body reads */ }
      });
      await login(a); await page.goto(`${base}/profile`);
      await page.getByText(credentials[role].username, { exact: true }).first().waitFor();
      await until(() => a.workspace); assert.equal(a.workspace.shared_mode_enabled, true);
      await page.goto(`${base}/`); await shared(a);
    }
    const m = actors.manager, w = actors.worker;
    assert.notEqual(m.identity.id, w.identity.id); assert.equal(m.workspace.id, w.workspace.id);
    main = `${prefix}-shared`; await add(m, main); await both(main, 'Durdur');
    await pause(w, main); await button(m, main, 'Başlat').click(); await both(main, 'Durdur');
    await button(w, main, 'Ödenmedi').click(); await button(m, main, 'Ödendi').waitFor();
    await m.page.getByRole('button', { name: 'Kronometre', exact: true }).click();
    await add(m, `${prefix}-personal-m`, true);
    await w.page.getByRole('button', { name: 'Kronometre', exact: true }).click();
    assert.equal(await card(w, `${prefix}-personal-m`).count(), 0);
    await add(w, `${prefix}-personal-w`, true); assert.equal(await card(m, `${prefix}-personal-w`).count(), 0);
    await shared(m); await shared(w);
    return { distinctUsers: true, sameWorkspace: true, sharedPermissionVerified: true, singleCreateStartPausePaySync: true, personalIsolation: true, sharedBulkAbsent: true };
  });
  const m = actors.manager, w = actors.worker;
  async function prerequisites() { if (!main || !m?.identity || !w?.identity) throw Error('BLOCKED: Initial two-user setup incomplete'); await ready(m); await ready(w); }
  await test('REPEATED-OFFLINE-LATE-AUTHORITY-NO-RELOAD', async () => {
    await prerequisites(); const detail = [];
    for (const [cycle, [w, m]] of [
      [0, [actors.worker, actors.manager]], [1, [actors.manager, actors.worker]],
      [2, [actors.worker, actors.manager]], [3, [actors.manager, actors.worker]],
    ]) {
      await pause(m, main); const commands = w.commands.length, initial = w.phases.length, connections = w.socket.connected;
      const proofGate = gate(); let held = 0;
      const handler = async route => { const response = await route.fetch(); held++; await proofGate.promise; await route.fulfill({ response }).catch(() => {}); };
      await w.page.route('**/account/experience', handler);
      try {
        await w.context.setOffline(true); await w.page.locator('[data-state="offline-readonly"]').waitFor(); await sleep(500);
        assert.equal(await button(w, main, 'Başlat').getAttribute('aria-disabled'), 'true');
        await button(w, main, 'Başlat').focus(); await w.page.keyboard.press('Enter'); assert.equal(w.commands.length, commands);
        await button(m, main, 'Başlat').click(); await button(m, main, 'Durdur').waitFor();
        await w.context.setOffline(false); await until(() => held > 0);
        assert.equal(await w.page.evaluate(() => navigator.onLine), true);
        await sleep(1000); assert.notEqual(await state(w), 'ready'); assert.equal(w.commands.length, commands);
        const namespaceConnectedBeforeProofRelease = w.socket.connected > connections;
        const started = Date.now(); proofGate.release(); await ready(w); await button(w, main, 'Durdur').waitFor();
        await until(() => w.socket.connected > connections);
        assert.equal(await card(w, main).count(), 1); assert.equal(w.commands.length, commands);
        detail.push({ cycle: cycle + 1, offlineRole: w.role, namespaceConnectedBeforeProofRelease, socketReauthenticated: true, verifiedProofHeld: true, onlineAloneDidNotOpenWrites: true, recoveredAfterProofMs: Date.now() - started,
          canonicalGet200: w.phases.slice(initial).some(p => p.path === '/timers/shared' && p.status === 200) });
        assert.equal(detail.at(-1).canonicalGet200, true);
      } finally { proofGate.release(); await w.context.setOffline(false); await w.page.unroute('**/account/experience', handler); }
    }
    return { cycles: detail, socketTransport: { ...w.socket }, reloadsDuringRecovery: 0, duplicateCommands: 0 };
  });
  await test('BACKEND-UNREACHABLE-WHILE-BROWSER-ONLINE', async () => {
    await prerequisites(); await pause(m, main); const before = w.commands.length;
    let hits = 0;
    const deny = route => { hits++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"controlled backend outage"}' }); };
    await w.page.route('**/account/experience', deny);
    try {
      await w.context.setOffline(true); await w.page.locator('[data-state="offline-readonly"]').waitFor(); await sleep(300);
      await w.context.setOffline(false); await until(() => hits > 0); await sleep(1000);
      assert.equal(await w.page.evaluate(() => navigator.onLine), true); assert.notEqual(await state(w), 'ready');
      await button(m, main, 'Başlat').click(); await button(m, main, 'Durdur').waitFor();
    } finally { await w.page.unroute('**/account/experience', deny); await w.context.setOffline(false); }
    const started = Date.now(); await ready(w); await button(w, main, 'Durdur').waitFor();
    assert.equal(w.commands.length, before);
    return { browserOnlineWith503: true, writesStayedClosed: true, recoveredByExistingAuthorityRenewalMs: Date.now() - started, reloads: 0, replayedCommands: 0 };
  });
  await test('PENDING-REAL-ACK-THROUGH-RECONNECT', async () => {
    await prerequisites();
    if (await button(m, main, 'Başlat').count()) { await button(m, main, 'Başlat').click(); await both(main, 'Durdur'); }
    const ackGate = gate(); let held = 0;
    const timerId = m.commands.find(c => c.command === 'create' && c.name === main).timerId;
    const handler = async route => {
      const body = route.request().postDataJSON();
      if (body.timerId !== timerId || body.command !== 'pause') return route.continue();
      const response = await route.fetch(); held++; await ackGate.promise; await route.fulfill({ response }).catch(() => {});
    };
    await w.page.route('**/timers/shared/commands', handler);
    const before = w.commands.length;
    try {
      await button(w, main, 'Durdur').click(); await until(() => held === 1); await button(m, main, 'Başlat').waitFor();
      await w.context.setOffline(true); await w.page.locator('[data-state="offline-readonly"]').waitFor(); await sleep(300);
      await w.context.setOffline(false); await until(async () => ['pending', 'reconciling'].includes(await state(w)));
      assert.equal(w.commands.length, before + 1); await sleep(1000); assert.notEqual(await state(w), 'ready');
      ackGate.release(); await ready(w); await both(main, 'Başlat');
      assert.equal(w.commands.length, before + 1);
      return { realServerAcceptedBeforeAck: true, onePauseCommand: true, noReplay: true, bothUsersCanonicalPaused: true };
    } finally { ackGate.release(); await w.context.setOffline(false); await w.page.unroute('**/timers/shared/commands', handler); }
  });
  await test('LATE-ACK-AFTER-REAL-ACCOUNT-SWITCH', async () => {
    await prerequisites(); await button(m, main, 'Başlat').click(); await both(main, 'Durdur');
    const timerId = m.commands.find(c => c.command === 'create' && c.name === main).timerId;
    const ackGate = gate(); let held = 0;
    const handler = async route => {
      const body = route.request().postDataJSON();
      if (body.timerId !== timerId || body.command !== 'pause') return route.continue();
      const response = await route.fetch(); held++; await ackGate.promise; await route.fulfill({ response }).catch(() => {});
    };
    await w.page.route('**/timers/shared/commands', handler);
    const before = w.commands.length;
    try {
      await button(w, main, 'Durdur').click(); await until(() => held === 1); await button(m, main, 'Başlat').waitFor();
      await w.page.getByRole('button', { name: 'Çıkış', exact: true }).click();
      await login(w, 'manager'); await w.page.getByRole('button', { name: 'Kronometre', exact: true }).click();
      await card(w, `${prefix}-personal-m`).waitFor(); assert.equal(await card(w, `${prefix}-personal-w`).count(), 0);
      ackGate.release(); await sleep(1000); assert.equal(await card(w, `${prefix}-personal-w`).count(), 0);
      await shared(w); await both(main, 'Başlat'); assert.equal(w.commands.length, before + 1);
      return { realLogoutAndOtherAccountLogin: true, oldPersonalRowsAbsent: true, lateAckDidNotReplay: true, sharedStateCanonical: true };
    } finally {
      ackGate.release(); await w.page.unroute('**/timers/shared/commands', handler);
      if (await w.page.getByRole('button', { name: 'Çıkış', exact: true }).count()) await w.page.getByRole('button', { name: 'Çıkış', exact: true }).click();
      await login(w); await shared(w);
    }
  });
} finally {
  // Stop only this run's fixtures. Existing timers and workspace policy are untouched.
  for (const a of Object.values(actors)) try {
    await a.context.setOffline(false); await a.page.goto(`${base}/`); await shared(a);
    for (const fixture of owned) {
      if (fixture.personal && fixture.role !== a.role) continue;
      await a.page.getByRole('button', { name: fixture.personal ? 'Kronometre' : 'Ortak', exact: true }).click();
      const stop = button(a, fixture.name, 'Durdur'); if (await stop.count()) { await stop.click(); await button(a, fixture.name, 'Başlat').waitFor(); }
    }
  } catch (error) { results.push({ id: 'OWN-FIXTURE-CLEANUP', status: 'BLOCKED', error: clean(error) }); }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await writeFile(`${out}/fixtures.json`, JSON.stringify(owned, null, 2));
  await browser.close();
}
if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
