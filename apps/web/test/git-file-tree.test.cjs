// Pure tree regression tests: no browser, IPC, repository writes or app startup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const source = path.resolve(__dirname, '../src/app/views/admin-core/sessions/session-git-explorer/git-file-tree.ts');
const compiled = new Module(source, module);
compiled._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, source);
const { buildFileTree, visibleTreeRows } = compiled.exports;
const file = path => ({ path, status: 'modified', staged: false });
const rows = (tree, open = [], pages = []) => visibleTreeRows(tree, new Set(open), new Map(pages));

test('10000 sibling folders start closed and root is paginated', () => {
  const tree = buildFileTree(Array.from({ length: 10000 }, (_, i) => file(`folder-${String(i).padStart(5, '0')}/file.txt`)));
  const initial = rows(tree);
  assert.equal(tree.totalFiles, 10000);
  assert.equal(initial.filter(r => r.folder).length, 50);
  assert.equal(initial.filter(r => r.file).length, 0);
  assert.equal(initial.at(-1).pagination.pages, 200);
  const second = rows(tree, [], [['', 1]]);
  assert.equal(second[0].folder.fullPath, 'folder-00050');
});

test('folder file pages stay inside their hierarchy and do not open nested folders', () => {
  const tree = buildFileTree([
    ...Array.from({ length: 120 }, (_, i) => file(`src/file-${String(i).padStart(3, '0')}`)),
    file('src/nested/hidden.txt'), file('other/hidden.txt'),
  ]);
  const first = rows(tree, ['src']);
  assert.equal(first.filter(r => r.file).length, 49); // one of 50 entries is a nested folder
  assert.equal(first.some(r => r.file?.path.endsWith('hidden.txt')), false);
  const second = rows(tree, ['src'], [['src', 1]]);
  assert.equal(second.filter(r => r.file).length, 50);
  assert.equal(second.find(r => r.file).file.path, 'src/file-049');
  assert.equal(second.find(r => r.file).depth, 1);
  assert.equal(second.find(r => r.pagination)?.pagination.path, 'src');
  assert.equal(rows(tree).filter(r => r.file).length, 0);
});

test('filter keeps matching ancestors, counts and literal special names', () => {
  const tree = buildFileTree([file('src/deep/[é].txt'), file('other/no.txt')], '[É]');
  assert.equal(tree.totalFiles, 1);
  assert.equal(tree.children[0].fullPath, 'src');
  assert.equal(rows(tree).length, 1);
  const visible = rows(tree, ['src', 'src/deep']);
  assert.equal(visible.at(-1).file.path, 'src/deep/[é].txt');
  assert.equal(visible.at(-1).depth, 2);
});

test('root files, mixed entries, and empty results are bounded', () => {
  const tree = buildFileTree(Array.from({ length: 120 }, (_, i) => file(`file-${String(i).padStart(3, '0')}`)));
  assert.equal(rows(tree).filter(r => r.file).length, 50);
  assert.equal(rows(tree, [], [['', 2]]).filter(r => r.file).length, 20);
  assert.deepEqual(rows(buildFileTree([], 'missing')), []);
});

test('stale pages clamp when refresh removes files and subtree pages are independent', () => {
  const tree = buildFileTree([
    ...Array.from({ length: 110 }, (_, i) => file(`a/file-${i}`)),
    ...Array.from({ length: 60 }, (_, i) => file(`b/file-${i}`)),
  ]);
  const visible = rows(tree, ['a', 'b'], [['a', 99], ['b', 0]]);
  assert.deepEqual(visible.filter(r => r.pagination).map(r => [r.pagination.path, r.pagination.page]), [['a', 2], ['b', 0]]);
  assert.equal(visible.filter(r => r.file).length, 60);
});
