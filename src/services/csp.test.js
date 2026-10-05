import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const rules = config.headers.filter(rule => rule.headers.some(h => h.key === 'Content-Security-Policy'));
const header = rules[0]?.headers.find(h => h.key === 'Content-Security-Policy');
const entries = (header?.value ?? '').split(';').map(part => part.trim().split(/\s+/));
const policy = new Map(entries.map(([name, ...values]) => [name, values]));
const exact = (name, values) => assert.deepEqual(policy.get(name), values, name);

test('one enforcing CSP header covers SPA and worker paths but not auth responses', () => {
  assert.equal(rules.length, 1); assert.equal(rules[0].headers.length, 1);
  assert.equal(entries.length, policy.size, 'Duplicate directives silently ignore later values');
  const matches = new RegExp(`^${rules[0].source}$`);
  for (const path of ['/', '/index.html', '/login', '/settings', '/sw.js', '/notification-events.js', '/assets/app.js', '/manifest.webmanifest']) assert.ok(matches.test(path), path);
  for (const path of ['/api/auth', '/api/auth/', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout']) assert.equal(matches.test(path), false, path);
  assert.equal(config.headers.flatMap(r => r.headers).filter(h => h.key === 'Content-Security-Policy-Report-Only').length, 0);
});
test('CSP limits default sources, embedding, base URL changes and form submissions', () => {
  exact('default-src', ["'self'"]); exact('base-uri', ["'none'"]); exact('object-src', ["'none'"]);
  exact('frame-ancestors', ["'none'"]); exact('frame-src', ["'none'"]); exact('form-action', ["'self'"]);
});
test('scripts and styles use self only; inline/eval/wildcard/scheme-wide allowances are absent', () => {
  exact('script-src', ["'self'"]); exact('script-src-attr', ["'none'"]);
  exact('style-src', ["'self'"]); exact('style-src-attr', ["'none'"]);
  assert.doesNotMatch(header.value, /unsafe-inline|unsafe-eval|unsafe-hashes|\*|(?:^|\s)(?:https?|wss?|data|blob):(?:\s|;|$)/);
});
test('only same-origin auth, exact Render HTTPS REST and WSS sockets are allowed to connect', () => {
  exact('connect-src', ["'self'", 'https://multi-stopwatch-backend.onrender.com', 'wss://multi-stopwatch-backend.onrender.com']);
});
test('local images, media, manifest and workers remain allowed without data/blob or remote fonts', () => {
  for (const name of ['img-src', 'media-src', 'manifest-src', 'worker-src']) exact(name, ["'self'"]);
  exact('font-src', ["'none'"]);
});
test('auth rewrite, SPA fallback and every auth cache header retain the original contract', () => {
  assert.deepEqual(config.rewrites, [
    { source: '/api/auth/:path*', destination: 'https://multi-stopwatch-backend.onrender.com/auth/:path*' },
    { source: '/(.*)', destination: '/index.html' },
  ]);
  assert.deepEqual(config.headers.filter(rule => rule.source === '/api/auth/:path*'), [{
    source: '/api/auth/:path*', headers: [
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      { key: 'x-vercel-enable-rewrite-caching', value: '0' },
    ],
  }]);
  assert.equal(config.headers.length, 2, 'Only the CSP rule is added');
});
