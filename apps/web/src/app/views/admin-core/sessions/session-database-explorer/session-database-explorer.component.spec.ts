import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import {
  SessionDatabaseExplorerComponent,
  persistableDraft,
  withoutUriPassword,
} from './session-database-explorer.component';

/**
 * The manual-connect draft used to be written to localStorage with the
 * password and the full connection URI: a plain file on disk, while saved
 * connections are in the encrypted local store.
 */
describe('SessionDatabaseExplorerComponent draft', () => {
  const KEY = 'po-db-manual-draft';

  function create(): SessionDatabaseExplorerComponent {
    TestBed.configureTestingModule({
      imports: [SessionDatabaseExplorerComponent, TranslateModule.forRoot()],
      providers: [{ provide: NgbActiveModal, useValue: { dismiss: () => undefined } }],
    });
    return TestBed.createComponent(SessionDatabaseExplorerComponent).componentInstance;
  }

  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('strips the password from connection URIs', () => {
    expect(withoutUriPassword('mongodb://admin:hunter2@db:27017/app')).toBe('mongodb://admin@db:27017/app');
    expect(withoutUriPassword('postgres://u:p%40ss@h/db')).toBe('postgres://u@h/db');
    expect(withoutUriPassword('mongodb://db:27017/app')).toBe('mongodb://db:27017/app');
    // Passwords pasted without percent-encoding.
    expect(withoutUriPassword('postgres://u:pa/ss@h:5432/db')).toBe('postgres://u@h:5432/db');
    expect(withoutUriPassword('mongodb://u:p@ss@h/d?authSource=admin')).toBe('mongodb://u@h/d?authSource=admin');
    expect(withoutUriPassword('mysql://u:p:w@h/d')).toBe('mysql://u@h/d');
    // An "@" after the host (query) is not user info.
    expect(withoutUriPassword('mongodb://h/d?appName=a@b')).toBe('mongodb://h/d?appName=a@b');
    expect(withoutUriPassword('not a uri')).toBe('not a uri');
    expect(persistableDraft({ password: 'x', uri: 'mysql://a:b@h/d', name: 'n' }))
      .toEqual({ password: '', uri: 'mysql://a@h/d', name: 'n' });
  });

  it('never writes the password to localStorage but keeps it for this run', () => {
    const c = create();
    c.manualConfig = { ...c.manualConfig, name: 'prod', username: 'root', password: 'hunter2', uri: 'mongodb://root:hunter2@db/app' };
    c.saveManualDraft();
    const stored = localStorage.getItem(KEY)!;
    expect(stored).not.toContain('hunter2');
    expect(JSON.parse(stored).username).toBe('root');

    c.openAddConnection();
    expect(c.draftRestored).toBeTrue();
    expect(c.manualConfig.password).toBe('hunter2');
    c.discardManualDraft();
  });

  it('scrubs a draft left with a password by an older version', () => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'old', password: 'hunter2', uri: 'mongodb://a:hunter2@h/d' }));
    SessionDatabaseExplorerComponent.scrubStoredDraft();
    const stored = localStorage.getItem(KEY)!;
    expect(stored).not.toContain('hunter2');
    expect(JSON.parse(stored).name).toBe('old');
  });
});
