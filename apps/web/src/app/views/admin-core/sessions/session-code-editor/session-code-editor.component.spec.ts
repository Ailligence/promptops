import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { SwalService } from '@core/services/swal.service';
import { GitService } from '../services/git.service';
import { SessionService } from '../services/session.service';
import { SessionCodeEditorComponent } from './session-code-editor.component';

describe('inline editor visibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SessionCodeEditorComponent, TranslateModule.forRoot()],
      providers: [NgbModal, GitService, SessionService, SwalService].map(provide => ({ provide, useValue: {} })),
    }).overrideComponent(SessionCodeEditorComponent, { set: { template: '', imports: [] } });
    // Monaco's AMD loader is outside this component lifecycle regression test.
    spyOn(SessionCodeEditorComponent.prototype, 'ngAfterViewInit');
  });

  it('preserves dirty buffers and the active file when hidden and shown', () => {
    const fixture = TestBed.createComponent(SessionCodeEditorComponent);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    const destroy = spyOn(editor, 'ngOnDestroy').and.callThrough();
    const files = [{ path: 'index.ts', name: 'index.ts', content: 'unsaved', originalContent: 'saved', modified: true, language: 'typescript' }];
    editor.openFiles.set(files);
    editor.activeFilePath.set('index.ts');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(editor.openFiles()).toBe(files);
    expect(editor.activeFilePath()).toBe('index.ts');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('does not intercept save or search shortcuts while hidden', () => {
    const fixture = TestBed.createComponent(SessionCodeEditorComponent);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    const save = spyOn(fixture.componentInstance, 'saveCurrentFile');
    const search = spyOn(fixture.componentInstance, 'toggleQuickSearch');
    for (const key of ['s', 'p', 'f', '`']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: key === 'f', cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBeFalse();
    }
    expect(save).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('handles save again after becoming visible', () => {
    const fixture = TestBed.createComponent(SessionCodeEditorComponent);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const save = spyOn(fixture.componentInstance, 'saveCurrentFile');
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('editor file operations', () => {
  let swal: jasmine.SpyObj<SwalService>;
  let written: { path: string; content: string }[];
  let writeOk: boolean;

  beforeEach(() => {
    swal = jasmine.createSpyObj('SwalService', ['error', 'confirmDanger', 'promptText']);
    written = [];
    writeOk = true;
    (window as any).promptops = {
      fsReadFile: async (_cwd: string, path: string) => ({ ok: true, content: `disk ${path} foo` }),
      fsWriteFile: async (_cwd: string, path: string, content: string) => {
        written.push({ path, content });
        return writeOk ? { ok: true } : { ok: false, error: 'Path resolves outside the workspace (symlink)' };
      },
      fsSearchContent: async () => ({ ok: true, results: [] }),
      fsDelete: jasmine.createSpy('fsDelete').and.resolveTo({ ok: true }),
      fsListDirShallow: async () => ({ ok: true, entries: [] }),
    };
    TestBed.configureTestingModule({
      imports: [SessionCodeEditorComponent, TranslateModule.forRoot()],
      providers: [
        ...[NgbModal, GitService, SessionService].map(provide => ({ provide, useValue: { refresh: async () => {}, files: () => [] } })),
        { provide: SwalService, useValue: swal },
      ],
    }).overrideComponent(SessionCodeEditorComponent, { set: { template: '', imports: [] } });
    spyOn(SessionCodeEditorComponent.prototype, 'ngAfterViewInit');
  });

  afterEach(() => { delete (window as any).promptops; });

  function editor(): SessionCodeEditorComponent {
    const fixture = TestBed.createComponent(SessionCodeEditorComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('replace all starts from the open tab and keeps its unsaved edits', async () => {
    const ed = editor();
    ed.openFiles.set([{ path: 'a.ts', name: 'a.ts', content: 'unsaved foo', originalContent: 'disk', modified: true, language: 'typescript' }]);
    ed.globalSearchQuery = 'foo';
    ed.replaceQuery = 'bar';
    ed.globalSearchResults.set([{ filePath: 'a.ts', line: 1, column: 9, content: 'unsaved foo' }, { filePath: 'b.ts', line: 1, column: 1, content: 'x' }]);
    await ed.replaceAll();
    expect(written.find(w => w.path === 'a.ts')?.content).toBe('unsaved bar');
    expect(written.find(w => w.path === 'b.ts')?.content).toBe('disk b.ts bar');
  });

  it('replaces literally unless regex mode is on', async () => {
    const ed = editor();
    ed.globalSearchQuery = 'foo';
    ed.replaceQuery = '$&-$1';
    ed.globalSearchResults.set([{ filePath: 'c.ts', line: 1, column: 1, content: 'x' }]);
    await ed.replaceAll();
    expect(written[0].content).toBe('disk c.ts $&-$1');
  });

  it('a refused write is reported and the tab stays dirty', async () => {
    const ed = editor();
    writeOk = false;
    ed.openFiles.set([{ path: 'a.ts', name: 'a.ts', content: 'foo', originalContent: 'old', modified: true, language: 'typescript' }]);
    ed.globalSearchQuery = 'foo';
    ed.replaceQuery = 'bar';
    ed.globalSearchResults.set([{ filePath: 'a.ts', line: 1, column: 1, content: 'foo' }]);
    await ed.replaceAll();
    expect(swal.error).toHaveBeenCalled();
    expect(ed.openFiles()[0].modified).toBeTrue();
    expect(ed.openFiles()[0].content).toBe('foo');
  });

  it('keeps #, ? and % in file names as part of the Monaco model path', () => {
    const ed = editor() as any;
    const from = jasmine.createSpy('from').and.callFake((c: any) => ({ path: c.path }));
    const parse = jasmine.createSpy('parse');
    (window as any).monaco = {
      Uri: { from, parse },
      editor: { getModel: () => null, createModel: (_c: string, _l: string, uri: any) => ({ uri, dispose: () => {} }) },
    };
    ed.monacoReady = true;
    ed.editor = {
      getModel: () => null, setModel: () => {}, saveViewState: () => null,
      restoreViewState: () => {}, focus: () => {}, createDecorationsCollection: () => ({ set: () => {} }), dispose: () => {},
    };
    for (const path of ['C#/Program.cs', 'q?.md', 'pct%41.txt']) {
      ed.openFiles.set([{ path, name: path, content: '', originalContent: '', modified: false, language: 'plaintext' }]);
      ed.switchEditorModel(path);
      expect(from).toHaveBeenCalledWith({ scheme: 'file', path: '/' + path });
      expect(ed.pathOfModel(ed.editorModels.get(path))).toBe(path);
    }
    expect(parse).not.toHaveBeenCalled();
    delete (window as any).monaco;
  });

  it('move to trash asks through the app dialog and deletes only on confirm', async () => {
    const ed = editor();
    const node = { name: 'x.ts', path: 'x.ts', isDir: false, level: 0 };
    ed.ctxNode.set(node);
    await ed.ctxDelete();
    expect(swal.confirmDanger).toHaveBeenCalled();
    expect((window as any).promptops.fsDelete).not.toHaveBeenCalled();
    const onConfirm = swal.confirmDanger.calls.mostRecent().args[2] as () => void;
    onConfirm();
    await new Promise(r => setTimeout(r));
    expect((window as any).promptops.fsDelete).toHaveBeenCalledWith(jasmine.any(String), 'x.ts');
  });
});
