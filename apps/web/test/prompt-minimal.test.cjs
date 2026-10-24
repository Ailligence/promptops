const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function signal(value) {
  const read = () => value;
  read.set = next => { value = next; };
  read.update = fn => { value = fn(value); };
  return read;
}
// Test the actual component methods without loading Angular's renderer.
function load(name, services, localMode = true) {
  const file = path.join(__dirname, '../src/app/views/admin-core/prompt-library', name, `${name}.component.ts`);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const requireStub = source => {
    if (source === '@angular/core') {
      const core = { Component: () => value => value, ViewChild: () => () => {}, signal, computed: fn => fn, inject: token => services[token?.key] || {} };
      // Anything else from Angular (decorators, tokens, effect) is a no-op.
      return new Proxy(core, { get: (target, key) => (key in target ? target[key] : Object.assign(() => () => {}, { key })) });
    }
    if (source === '@core/local-mode') return { LOCAL_MODE: localMode };
    if (source === '@core/constants') return { ENTITY: { PROMPT_camelCase: 'Prompt' } };
    if (source === '@core/models/prompt') return { Prompt: { generateModel: (form, prompt) => ({ ...form.getRawValue(), ...(prompt?.id ? { id: prompt.id } : {}) }) } };
    return new Proxy({}, { get: (_, key) => ({ key }) });
  };
  const exports = {};
  new Function('require', 'exports', outputText)(requireStub, exports);
  return Object.values(exports)[0];
}
function fixture(edit = false, localMode = true) {
  const saved = [], navigations = [], errors = [];
  const query = { promptSelected: edit ? { id: 42 } : null, addEntity: async body => { saved.push(body); return { id: 43 }; }, updateEntity: async body => { saved.push(body); } };
  const services = { PromptQueryService: query, Router: { navigate: args => navigations.push(args) }, SwalService: { success() {}, error: error => errors.push(error) }, TranslateService: { instant: key => key }, QuickAccessService: { loadShortcuts() {} }, Store: { selectSignal: () => () => ({ id: 1 }) } };
  const Component = load('prompt-form', services, localMode);
  const component = new Component();
  const data = { title: 'QA prompt', body: 'Test', status: 'draft', visibility: 'public' };
  component.form = { invalid: false, controls: { visibility: { get value() { return data.visibility; } }, status: { get value() { return data.status; }, setValue: value => { data.status = value; } } }, getRawValue: () => ({ ...data }), markAsPristine() {}, markAllAsTouched() {} };
  return { component, query, saved, navigations, errors, services, data };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('publishing opens the detail; a draft returns to the library', async () => {
  // With PromptOps Desktop the published public prompt opens in Explore.
  const p = fixture(false, false); p.component.submitPrompt(); await settle();
  assert.equal(p.saved[0].status, 'published');
  assert.deepEqual(p.navigations[0], ['/admin/prompt-library/explore', 43]);
  // In the open-source local mode Explore is locked: back to the library.
  const l = fixture(); l.component.submitPrompt(); await settle();
  assert.equal(l.saved[0].status, 'published');
  assert.deepEqual(l.navigations[0], ['/admin/prompt-library']);
  const d = fixture(); d.component.saveDraft(); await settle();
  assert.equal(d.saved[0].status, 'draft');
  assert.deepEqual(d.navigations[0], ['/admin/prompt-library']);
});
test('in-flight saves prevent duplicate writes and recover after errors', async () => {
  const f = fixture(true); let reject; let calls = 0;
  f.query.updateEntity = () => { calls++; return new Promise((_, failure) => { reject = failure; }); };
  const pending = f.component.handleSaveEntity();
  assert.equal(f.component.saving(), true);
  f.component.submitPrompt(); await f.component.handleSaveEntity();
  assert.equal(calls, 1); assert.equal(f.data.status, 'draft');
  reject(new Error('network failure')); await pending;
  assert.equal(f.component.saving(), false); assert.equal(f.errors.length, 1); assert.equal(f.navigations.length, 0);
});
test('invalid forms do not save or navigate', async () => {
  const f = fixture(); f.component.form.invalid = true; f.component.submitPrompt(); await f.component.handleSaveEntity();
  assert.equal(f.data.status, 'draft');
  assert.equal(f.saved.length, 0); assert.equal(f.navigations.length, 0);
});
test('personalization preserves literal dollar signs and missing variables', () => {
  const f = fixture(); const Detail = load('prompt-detail', f.services); const detail = new Detail();
  detail.editableBody.set('Visit {{url}}; {{objective}}; {{url}}');
  detail.variableValues.set({ url: 'https://example.test/$&', objective: '' });
  assert.equal(detail.generatedPrompt(), 'Visit https://example.test/$&; {{objective}}; https://example.test/$&');
});

test('deleting from edit waits for confirmation and removes the selected prompt', async () => {
  const f = fixture(true); let confirmed; const deleted = [];
  f.services.SwalService.confirm = (_, __, callback) => { confirmed = callback; };
  f.query.deleteEntity = async id => { deleted.push(id); };
  f.query.clearEntitySelected = () => { f.query.promptSelected = null; };
  f.component.deletePrompt();
  assert.equal(deleted.length, 0);
  await confirmed();
  assert.deepEqual(deleted, [42]);
  assert.equal(f.query.promptSelected, null);
  assert.deepEqual(f.navigations[0], ['/admin/prompt-library']);
  assert.equal(f.component.saving(), false);
});

test('delete failure keeps the editor and new prompts cannot be deleted', async () => {
  const f = fixture(true); let confirmed;
  f.services.SwalService.confirm = (_, __, callback) => { confirmed = callback; };
  f.query.deleteEntity = async () => { throw new Error('network failure'); };
  f.component.deletePrompt(); await confirmed();
  assert.equal(f.query.promptSelected.id, 42);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.component.saving(), false);
  const fresh = fixture();
  fresh.services.SwalService.confirm = () => assert.fail('New prompts have nothing to delete');
  fresh.component.deletePrompt();
});
