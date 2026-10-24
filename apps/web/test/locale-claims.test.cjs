// Locale files: identical keys in all 15 languages, and none of the provider
// claims that turned out to be false comes back in any language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'assets', 'i18n');
const LANGS = ['en', 'it', 'fr', 'es', 'de', 'pt', 'zh', 'ja', 'ru', 'ar', 'hi', 'pl', 'nl', 'sv', 'ko'];
const load = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const locales = Object.fromEntries(LANGS.map((l) => [l, flat(load(l))]));

test('every locale has exactly the keys of en.json', () => {
  const base = Object.keys(locales.en).sort();
  for (const l of LANGS) {
    assert.deepEqual(Object.keys(locales[l]).sort(), base, `${l}.json keys differ from en.json`);
  }
});

test('no locale tells users to run `claude login` (Claude Code has no such command)', () => {
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(locales[l])) {
      assert.ok(!(typeof v === 'string' && v.includes('claude login')), `${l}:${k}`);
    }
  }
});

test('Copilot copy names the standalone Copilot CLI, not the GitHub CLI', () => {
  for (const l of LANGS) {
    for (const k of ['PROVIDERS.COPILOT.LIMITATIONS', 'PROVIDERS.COPILOT.MICROCOPY']) {
      assert.ok(!/GitHub CLI(?! Copilot)/.test(locales[l][k].replace('GitHub Copilot CLI', '')), `${l}:${k}`);
    }
  }
});

test('the free tier does not promise that everything runs on this machine', () => {
  assert.doesNotMatch(locales.en['PROVIDERS.GROUP.FREE_LOCAL_SUB'], /entirely/i);
  assert.doesNotMatch(locales.en['PROVIDERS.BADGE.FREE_TOOLTIP'], /^Runs on your machine/);
  assert.doesNotMatch(locales.en['PROVIDERS.OPENCODE.MICROCOPY'], /^Runs locally/);
  // Every language must carry its own translation, not the English fallback.
  for (const l of LANGS.filter((x) => x !== 'en')) {
    assert.notEqual(locales[l]['PROVIDERS.BADGE.FREE_TOOLTIP'], locales.en['PROVIDERS.BADGE.FREE_TOOLTIP'], l);
  }
});

test('PromptOps CLI copy does not claim it needs Claude Code', () => {
  for (const l of LANGS) {
    for (const k of ['PROVIDERS.PROMPTOPS_CLI.LIMITATIONS', 'PROVIDERS.PROMPTOPS_CLI.INSTALL_HINT']) {
      assert.doesNotMatch(locales[l][k], /claude/i, `${l}:${k}`);
    }
  }
});

test('keyboard shortcuts keep their Latin key names in every language', () => {
  // A katakana "ア" once replaced the "A" of "Alt+M" in ja.json.
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(locales[l])) {
      if (typeof v !== 'string') continue;
      assert.doesNotMatch(v, /[^\x00-\x7F]lt\+[A-Z]/, `${l}:${k}`);
    }
  }
});
