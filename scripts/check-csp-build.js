// Run after npm run build. Static output audit; not a browser CSP enforcement test.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const csp = config.headers.flatMap(rule => rule.headers).find(h => h.key === 'Content-Security-Policy').value;
assert.ok(csp.includes("script-src 'self'"));
assert.ok(csp.includes("style-src 'self'"));
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file)); else result.push(file);
  }
  return result;
}
const files = await walk(dist);
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  assert.match(match[1], /\bsrc="\/[^/][^"]+"/);
  assert.equal(match[2].trim(), '', 'No inline script without a CSP hash');
}
assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son\w+\s*=/i);
assert.doesNotMatch(html, /http-equiv=["']Content-Security-Policy/i);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.match(match[1], /^\/[^/]/, 'HTML resources must be same-origin');
  await readFile(path.join(dist, match[1]));
}
for (const file of files.filter(f => /\.(?:js|css|html|webmanifest)$/.test(f))) {
  const text = await readFile(file, 'utf8');
  assert.doesNotMatch(text, /\beval\s*\(|\bnew\s+Function\s*\(/, path.basename(file));
  assert.doesNotMatch(text, /["'`]\s*(?:data:|blob:)/, path.basename(file));
  if (file.endsWith('.css')) {
    assert.doesNotMatch(text, /@import\b|@font-face\b/, 'No external CSS or downloadable font required');
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)/g)) assert.match(match[1], /^(?:#|\/[^/]|\.\.?\/)/);
  }
}
const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
assert.ok(worker.includes('notification-events.js'));
assert.ok(worker.includes('denylist:[/^\\/api\\/auth(?:\\/|$)/]'));
assert.doesNotMatch(worker, /url:["']\/?api\/auth/);
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) { assert.match(icon.src, /^\/[^/]/); await readFile(path.join(dist, icon.src)); }
assert.ok(files.some(f => /radar-alarm.*\.mp3$/.test(f)));
assert.ok(files.some(f => /digital-alarm.*\.mp3$/.test(f)));
assert.equal(files.filter(f => /\.(woff2?|ttf|otf)$/.test(f)).length, 0);
console.log(`CSP production audit passed: ${files.length} files; external JS/CSS, same-origin media/icons/workers; no eval/inline HTML/data/blob/fonts.`);
