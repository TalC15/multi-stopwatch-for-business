// Run after npm run build. Static output audit; not a browser CSP enforcement test.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");

const config = JSON.parse(
  await readFile(path.join(root, "vercel.json"), "utf8"),
);

const csp = config.headers
  .flatMap((rule) => rule.headers)
  .find((h) => h.key === "Content-Security-Policy").value;

assert.ok(csp.includes("script-src 'self'"));
assert.ok(csp.includes("style-src 'self'"));

async function walk(dir) {
  const result = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await walk(file)));
    } else {
      result.push(file);
    }
  }

  return result;
}

// Parse actual HTML attributes instead of searching for "src=" / "href="
// substrings. Handles:
//   src="..."
//   src='...'
//   src=/assets/app.js
//   SRC="..."
// and keeps data-src separate from src.
function htmlAttributes(rawTag) {
  const attributes = new Map();
  const openTag = rawTag.slice(0, rawTag.indexOf(">") + 1);

  const pattern =
    /(?:^|[\s/])([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of openTag.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    attributes.set(name, value);
  }

  return attributes;
}

async function verifyLocalResource(value, label) {
  assert.match(value, /^\/[^/]/, `${label} must be same-origin`);

  const pathname = new URL(value, "https://keeptimer.invalid").pathname;

  await readFile(path.join(dist, pathname));
}

const files = await walk(dist);
const html = await readFile(path.join(dist, "index.html"), "utf8");

// Every script must have a real src attribute.
// data-src does not count as src.
for (const match of html.matchAll(
  /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
)) {
  const attributes = htmlAttributes(`<script${match[1]}>`);

  const src = attributes.get("src");

  assert.ok(src, "Every script must use an external src");

  assert.equal(match[2].trim(), "", "No inline script without a CSP hash");
}

// Audit actual attributes on every HTML opening tag.
for (const match of html.matchAll(/<[a-z][^>]*>/gi)) {
  const tag = match[0];
  const attributes = htmlAttributes(tag);

  assert.ok(!attributes.has("style"), "No inline style attributes");

  for (const name of attributes.keys()) {
    assert.ok(!/^on/i.test(name), `No inline event handlers: ${name}`);
  }

  if (
    /^<meta\b/i.test(tag) &&
    attributes.get("http-equiv")?.toLowerCase() === "content-security-policy"
  ) {
    assert.fail(
      "No meta CSP; production policy must come from the response header",
    );
  }

  for (const name of ["src", "href"]) {
    const value = attributes.get(name);

    if (value !== undefined) {
      await verifyLocalResource(value, `HTML ${name}`);
    }
  }

  const srcset = attributes.get("srcset");

  if (srcset !== undefined) {
    for (const candidate of srcset.split(",")) {
      const value = candidate.trim().split(/\s+/)[0];

      assert.ok(value, "srcset entries must contain a URL");

      await verifyLocalResource(value, "HTML srcset");
    }
  }
}

for (const file of files.filter((f) =>
  /\.(?:js|css|html|webmanifest)$/.test(f),
)) {
  const text = await readFile(file, "utf8");

  assert.doesNotMatch(
    text,
    /\beval\s*\(|\bnew\s+Function\s*\(/,
    path.basename(file),
  );

  assert.doesNotMatch(text, /["'`]\s*(?:data:|blob:)/, path.basename(file));

  if (file.endsWith(".css")) {
    assert.doesNotMatch(
      text,
      /@import\b|@font-face\b/,
      "No external CSS or downloadable font required",
    );

    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)/g)) {
      assert.match(match[1], /^(?:#|\/[^/]|\.\.?\/)/);
    }
  }
}

const worker = await readFile(path.join(dist, "sw.js"), "utf8");

assert.ok(worker.includes("notification-events.js"));

assert.ok(worker.includes("denylist:[/^\\/api\\/auth(?:\\/|$)/]"));

assert.doesNotMatch(worker, /url:["']\/?api\/auth/);

const manifest = JSON.parse(
  await readFile(path.join(dist, "manifest.webmanifest"), "utf8"),
);

for (const icon of manifest.icons) {
  assert.match(icon.src, /^\/[^/]/);

  await readFile(path.join(dist, icon.src));
}

assert.ok(files.some((f) => /radar-alarm.*\.mp3$/.test(f)));

assert.ok(files.some((f) => /digital-alarm.*\.mp3$/.test(f)));

assert.equal(files.filter((f) => /\.(woff2?|ttf|otf)$/.test(f)).length, 0);

console.log(
  `CSP production audit passed: ${files.length} files; external JS/CSS, same-origin media/icons/workers; no eval/inline HTML/data/blob/fonts.`,
);
