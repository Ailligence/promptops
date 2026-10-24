#!/usr/bin/env node
// One version for the open-source edition: the desktop shell and the web
// interface must agree. (The npm launcher in apps/npm follows PromptOps
// Desktop releases instead, see docs/releasing.md.)
//
//   node scripts/versions.mjs check          fails if any file disagrees
//   node scripts/versions.mjs set 0.2.0      writes the version everywhere
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const write = (path, text) => writeFileSync(root + path, text);

const json = (path, get, set) => ({
  path,
  get: () => get(JSON.parse(read(path))),
  set: (version) => {
    const data = JSON.parse(read(path));
    set(data, version);
    write(path, `${JSON.stringify(data, null, 2)}\n`);
  },
});
const pkg = (path) => json(path, (d) => d.version, (d, v) => { d.version = v; });
const lock = (path) => json(path, (d) => d.version === d.packages[''].version ? d.version : `${d.version}/${d.packages[''].version}`, (d, v) => {
  d.version = v;
  d.packages[''].version = v;
});
const toml = (path, pattern) => ({
  path,
  get: () => read(path).match(pattern)?.[2],
  set: (version) => write(path, read(path).replace(pattern, (_, head) => `${head}${version}"`)),
});

const FILES = [
  pkg('apps/desktop/src-tauri/tauri.conf.json'),
  toml('apps/desktop/src-tauri/Cargo.toml', /(\[package\][^[]*?\nversion = ")([^"]+)"/),
  toml('apps/desktop/src-tauri/Cargo.lock', /(\nname = "promptops-oss"\nversion = ")([^"]+)"/),
  pkg('apps/desktop/package.json'),
  lock('apps/desktop/package-lock.json'),
  pkg('apps/web/package.json'),
  lock('apps/web/package-lock.json'),
  // Fallback the UI shows when the native bridge has no version.
  toml('apps/web/src/environments/version.ts', /(\|\|\s*")([^"]+)"/),
];

const [command, next] = process.argv.slice(2);
if (command === 'set') {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next || '')) {
    console.error('usage: node scripts/versions.mjs set <major.minor.patch>');
    process.exit(2);
  }
  for (const file of FILES) file.set(next);
}
if (command !== 'check' && command !== 'set') {
  console.error('usage: node scripts/versions.mjs check | set <version>');
  process.exit(2);
}

const found = FILES.map((file) => ({ path: file.path, version: file.get() }));
const versions = new Set(found.map((f) => f.version));
for (const f of found) console.log(`${f.version ?? '(missing)'}\t${f.path}`);
if (versions.size !== 1 || versions.has(undefined)) {
  console.error('Versions differ: run node scripts/versions.mjs set <version>');
  process.exit(1);
}
console.log(`All at ${[...versions][0]}.`);
