import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadConfigFromFile } from 'vite';
import vm from 'node:vm';
import path from 'node:path';

test('Vite auth proxy preserves browser Origin and TLS verification; only path prefix changes', async () => {
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'test' });
  const proxy = config.server.proxy['^/api/auth(?:/|$)'];
  assert.equal(proxy.target, 'https://multi-stopwatch-backend.onrender.com');
  assert.equal(proxy.secure, true); assert.equal(proxy.changeOrigin, true);
  assert.equal(proxy.headers, undefined); assert.equal(proxy.configure, undefined);
  for (const route of ['login', 'refresh', 'logout']) assert.equal(proxy.rewrite(`/api/auth/${route}`), `/auth/${route}`);
  assert.equal(proxy.rewrite('/api/authorize'), '/api/authorize');
});
test('Vercel auth rewrite precedes SPA and no-store is limited to auth', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites[0], { source: '/api/auth/:path*', destination: 'https://multi-stopwatch-backend.onrender.com/auth/:path*' });
  assert.equal(config.rewrites[1].destination, '/index.html');
  const authHeaders = config.headers.filter(rule => rule.source === '/api/auth/:path*');
  assert.equal(authHeaders.length, 1);
  assert.equal(authHeaders[0].headers.find(h => h.key === 'x-vercel-enable-rewrite-caching').value, '0');
  for (const key of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) {
    assert.equal(authHeaders[0].headers.find(h => h.key === key).value, 'no-store');
  }
});
test('PWA navigation excludes auth; existing static precache and empty runtime cache rules remain', async () => {
  // Capture actual plugin options without relying on undocumented plugin internals.
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  let options;
  vm.runInNewContext(source.replace(/^import .*$/gm, '').replace('export default ', ''), {
    defineConfig: value => value, vue: () => ({}), path, __dirname: process.cwd(), BASE_URL: 'https://mock.invalid',
    VitePWA: value => { options = value.workbox; return {}; },
  });
  for (const path of ['/api/auth', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout'])
    assert.ok(options.navigateFallbackDenylist.some(pattern => pattern.test(path)));
  assert.ok(options.navigateFallbackDenylist.every(pattern => !pattern.test('/login')));
  assert.equal(options.navigateFallback, '/index.html');
  assert.equal(options.runtimeCaching.length, 0);
  assert.equal(JSON.stringify(options.importScripts), '["/notification-events.js"]');
  assert.ok(options.globPatterns.some(pattern => pattern.includes('mp3')));
});
