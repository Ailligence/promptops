import { TestBed } from "@angular/core/testing";
import { TranslateModule } from "@ngx-translate/core";
import { BackupRestoreCardComponent } from "./backup-restore-card.component";

describe("BackupRestoreCardComponent", () => {
  let bridge: Record<string, jasmine.Spy>;
  let previous: unknown;

  function create(): BackupRestoreCardComponent {
    TestBed.configureTestingModule({
      imports: [BackupRestoreCardComponent, TranslateModule.forRoot()],
    });
    return TestBed.createComponent(BackupRestoreCardComponent).componentInstance;
  }

  beforeEach(() => {
    const w = window as unknown as { promptops?: unknown };
    previous = w.promptops;
    bridge = {
      localBackupPickFile: jasmine.createSpy("pick").and.resolveTo("/tmp/a.pobackup"),
      localBackupExport: jasmine
        .createSpy("export")
        .and.resolveTo({ records: 3, collections: 2, skippedUnreadable: 0, bytes: 100 }),
      localBackupImport: jasmine.createSpy("import"),
    };
    w.promptops = bridge;
  });

  afterEach(() => {
    (window as unknown as { promptops?: unknown }).promptops = previous;
  });

  it("refuses a short passphrase before opening the save dialog", async () => {
    const c = create();
    c.openExport();
    c.passphrase = c.confirm = "short";
    await c.primary();
    expect(bridge["localBackupPickFile"]).not.toHaveBeenCalled();
    expect(c.formError()).toBe("BACKUP.Too short");
  });

  it("refuses passphrases that differ", async () => {
    const c = create();
    c.openExport();
    c.passphrase = "a long passphrase";
    c.confirm = "another passphrase";
    await c.primary();
    expect(c.formError()).toBe("BACKUP.Mismatch");
    expect(bridge["localBackupExport"]).not.toHaveBeenCalled();
  });

  it("exports to the chosen file and closes the dialog", async () => {
    const c = create();
    c.openExport();
    c.passphrase = c.confirm = "a long passphrase";
    await c.primary();
    expect(bridge["localBackupExport"]).toHaveBeenCalledWith("/tmp/a.pobackup", "a long passphrase");
    expect(c.dialog()).toBeNull();
    expect(c.status()?.kind).toBe("ok");
  });

  it("needs a file, a passphrase and the confirmation before restoring", async () => {
    const c = create();
    c.openImport();
    c.passphrase = "a long passphrase";
    expect(c.canSubmit()).toBeFalse();
    await c.chooseFile();
    expect(c.canSubmit()).toBeFalse();
    c.understood = true;
    expect(c.canSubmit()).toBeTrue();
  });

  it("maps a wrong passphrase to its own message", async () => {
    bridge["localBackupImport"].and.rejectWith("wrong_passphrase: wrong passphrase, or the file was damaged");
    const c = create();
    c.openImport();
    c.importPath = "/tmp/a.pobackup";
    c.passphrase = "a long passphrase";
    c.understood = true;
    c.mode = "merge";
    await c.primary();
    expect(bridge["localBackupImport"]).toHaveBeenCalledWith("/tmp/a.pobackup", "a long passphrase", "merge");
    expect(c.formError()).toBe("BACKUP.Error wrong_passphrase");
    expect(c.imported()).toBeNull();
  });
});

describe("BackupRestoreCardComponent DOM", () => {
  it("submit button click shows the short passphrase error", async () => {
    TestBed.configureTestingModule({ imports: [BackupRestoreCardComponent, TranslateModule.forRoot()] });
    const f = TestBed.createComponent(BackupRestoreCardComponent);
    f.detectChanges();
    f.componentInstance.openExport();
    f.detectChanges();
    await f.whenStable();
    const set = (sel: string, v: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set('[data-qa="backup-passphrase"]', "short");
    set('[data-qa="backup-passphrase-confirm"]', "short");
    f.detectChanges();
    (document.querySelector('[data-qa="backup-submit"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 50));
    f.detectChanges();
    expect(document.body.innerText).toContain("BACKUP.Too short");
    f.destroy();
  });
});
