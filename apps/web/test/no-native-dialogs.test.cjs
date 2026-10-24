// window.confirm/alert/prompt do not work in the desktop webview: on macOS
// wry implements no JS dialog delegate, so confirm() returns false at once and
// the guarded action silently never runs. Use SwalService instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(ts|html)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) yield p;
  }
}

test('no native confirm/alert/prompt dialogs in the web app', () => {
  const root = path.join(__dirname, '../src');
  const call = /(^|[^.\w$'"-])(?:window\.)?(confirm|alert|prompt)\(\s*[^)\s]|window\.(confirm|alert|prompt)\s*\(/;
  const hits = [];
  for (const f of files(root)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return; // doc comments
      if (/^\s*(?:(?:private|public|async)\s+)*(?:confirm|alert|prompt)\(.*\)[^;]*\{\s*$/.test(code)) return; // method declarations
      if (call.test(code)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
