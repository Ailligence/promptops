const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const text = fs.readFileSync(path.join(__dirname, '../src/app/views/admin-core/sessions/action-center/action-center.component.ts'), 'utf8');
const source = ts.createSourceFile('component.ts', text, ts.ScriptTarget.Latest, true);
const component = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ActionCenterComponent');
const method = component.members.find(node => node.name?.getText(source) === 'removeSlot');
const standalone = method.getText(source).replace('async removeSlot(', 'async function removeSlot(');
const { outputText } = ts.transpileModule(standalone, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const removeSlot = new Function(outputText + '; return removeSlot;')();
function fixture(type = 'global') {
  let busy = null, scope = { scope: { type }, key: type + ':scope' }, resolve;
  const deleted = [];
  const instance = {
    deletingSlotId: Object.assign(() => busy, { set: value => { busy = value; } }),
    slotService: { context: () => scope, removeSlot: async id => { deleted.push(id); return true; } },
    slotAlerts: { showConfirm: () => new Promise(done => { resolve = done; }), error: () => assert.fail('Unexpected error') },
    translateService: { instant: key => key }, editingSlotId: () => null, cancelEditing() {},
  };
  return { instance, deleted, confirm: value => resolve({ isConfirmed: value }), changeScope: () => { scope = { scope: { type: 'session' }, key: 'session:other' }; } };
}
test('global deletion waits for confirmation and rejects duplicate clicks', async () => {
  const f = fixture(); const pending = removeSlot.call(f.instance, 4);
  assert.deepEqual(f.deleted, []);
  await removeSlot.call(f.instance, 4);
  f.confirm(true); await pending;
  assert.deepEqual(f.deleted, [4]); assert.equal(f.instance.deletingSlotId(), null);
});
test('cancel leaves the global action intact', async () => {
  const f = fixture(); const pending = removeSlot.call(f.instance, 4);
  f.confirm(false); await pending;
  assert.deepEqual(f.deleted, []); assert.equal(f.instance.deletingSlotId(), null);
});
test('changing scope while the modal is open cancels deletion', async () => {
  const f = fixture(); const pending = removeSlot.call(f.instance, 4);
  f.changeScope(); f.confirm(true); await pending;
  assert.deepEqual(f.deleted, []);
});
test('session deletion does not open the global warning', async () => {
  const f = fixture('session'); f.instance.slotAlerts.showConfirm = () => assert.fail('Unexpected global warning');
  await removeSlot.call(f.instance, 4); assert.deepEqual(f.deleted, [4]);
});
