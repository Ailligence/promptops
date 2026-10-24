import { Injectable, signal, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ProviderType } from '../../../../../store/sessions/session.state';

export interface GitRemoteInfo {
  name: string;
  url: string;
  type: 'ssh' | 'https' | 'unknown';
  host: string | null;
  owner: string | null;
  repo: string | null;
}

export interface SshKeyInfo {
  name: string;
  privatePath: string;
  publicPath: string;
  publicKey: string;
  type: string;
}

export interface GitSetupIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  step: 'remote' | 'keys' | 'agent' | 'identity' | 'test';
}

export interface GitSetupDiagnosis {
  ok: boolean;
  error?: string;
  remote: GitRemoteInfo | null;
  remotes: GitRemoteInfo[];
  sshKeys: SshKeyInfo[];
  sshDirExists: boolean;
  agentRunning: boolean;
  agentLoadedKeys: string[];
  identity: { name: string | null; email: string | null };
  selectedKeyPath: string | null;
  issues: GitSetupIssue[];
  classifiedError?: {
    kind: 'permission-denied' | 'unknown-host' | 'auth-failed' | 'not-a-repo' | 'no-remote' | 'other';
    message: string;
  };
}

export type SetupStep = 'remote' | 'keys' | 'agent' | 'identity' | 'test' | 'retry';

@Injectable({ providedIn: 'root' })
export class GitSetupService {
  private readonly translate = inject(TranslateService);
  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant('GIT_SETUP.' + key, params);
  }
  private get api(): any {
    return (window as any).promptops;
  }

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  // ── State ──────────────────────────────────────────────────────
  visible = signal(false);
  cwd = signal<string | null>(null);
  provider = signal<ProviderType>('claude-code-cli');
  diagnosing = signal(false);
  diagnosis = signal<GitSetupDiagnosis | null>(null);
  currentStep = signal<SetupStep>('remote');
  lastPushError = signal<string | null>(null);

  // Step action feedback
  busy = signal<string | null>(null);   // key of the currently-running action
  stepError = signal<string | null>(null);
  stepSuccess = signal<string | null>(null);

  // Identity form
  identityName = signal('');
  identityEmail = signal('');
  identityGlobal = signal(false);

  // Selected key
  selectedKey = signal<string | null>(null);

  // Passphrase prompt state for `ssh-add`
  needsPassphrase = signal(false);
  passphrase = signal('');
  passphraseError = signal<string | null>(null);

  // Test result
  testOutput = signal<string | null>(null);
  testOk = signal<boolean | null>(null);

  // Key generation form
  genEmail = signal('');
  genFilename = signal('id_ed25519');
  genType = signal<'ed25519' | 'rsa'>('ed25519');

  // Paste-key form
  pasteFilename = signal('id_ed25519_promptops');
  pastePrivateKey = signal('');
  pastePublicKey = signal('');

  // Computed
  stepsWithIssues = computed(() => {
    const d = this.diagnosis();
    if (!d) return new Set<SetupStep>();
    return new Set(d.issues.map(i => i.step as SetupStep));
  });

  canRetry = computed(() => {
    const d = this.diagnosis();
    if (!d) return false;
    const errs = d.issues.filter(i => i.severity === 'error');
    return errs.length === 0;
  });

  // ── Lifecycle ──────────────────────────────────────────────────
  async open(cwd: string, lastError?: string, provider?: ProviderType): Promise<void> {
    this.cwd.set(cwd);
    if (provider) this.provider.set(provider);
    this.lastPushError.set(lastError || null);
    this.visible.set(true);
    this.currentStep.set('remote');
    this.stepError.set(null);
    this.stepSuccess.set(null);
    this.testOutput.set(null);
    this.testOk.set(null);
    this.needsPassphrase.set(false);
    this.passphrase.set('');
    this.passphraseError.set(null);
    // Clear any stale selection from a previous workspace so diagnose()
    // can repopulate it cleanly from the (canonicalized) prefs file.
    this.selectedKey.set(null);
    await this.diagnose();
  }

  close(): void {
    this.visible.set(false);
    // Don't keep the passphrase in memory once the modal closes.
    this.passphrase.set('');
    this.needsPassphrase.set(false);
    this.passphraseError.set(null);
  }

  async diagnose(): Promise<void> {
    if (!this.isDesktop || !this.cwd()) return;
    this.diagnosing.set(true);
    this.stepError.set(null);
    try {
      if (typeof this.api?.gitSetupDiagnose !== 'function') {
        this.diagnosis.set(null);
        this.stepError.set(this.t('Backend not loaded error'));
        return;
      }
      const result: GitSetupDiagnosis = await this.api.gitSetupDiagnose(this.cwd(), this.lastPushError() || undefined);
      this.diagnosis.set(result);

      // Seed identity form from current values
      if (result.identity.name) this.identityName.set(result.identity.name);
      if (result.identity.email) this.identityEmail.set(result.identity.email);

      // Seed generator email from identity if available
      if (result.identity.email && !this.genEmail()) this.genEmail.set(result.identity.email);

      // Restore previously selected key if still present
      if (result.selectedKeyPath) {
        const found = result.sshKeys.find(k => k.privatePath === result.selectedKeyPath);
        if (found) this.selectedKey.set(found.privatePath);
      } else if (result.sshKeys.length === 1) {
        this.selectedKey.set(result.sshKeys[0].privatePath);
      }

      // Auto-navigate to first step with an issue
      const firstIssue = result.issues[0];
      if (firstIssue) this.currentStep.set(firstIssue.step as SetupStep);
    } catch (err) {
    } finally {
      this.diagnosing.set(false);
    }
  }

  goto(step: SetupStep): void {
    this.currentStep.set(step);
    this.stepError.set(null);
    this.stepSuccess.set(null);
  }

  private async run(key: string, fn: () => Promise<any>): Promise<any> {
    this.busy.set(key);
    this.stepError.set(null);
    this.stepSuccess.set(null);
    try {
      return await fn();
    } catch (err: any) {
      this.stepError.set(err?.message || this.t('Action failed'));
      return null;
    } finally {
      this.busy.set(null);
    }
  }

  // ── Step actions ───────────────────────────────────────────────
  async convertRemote(): Promise<void> {
    const cwd = this.cwd(); if (!cwd) return;
    const r = await this.run('convert-remote', () => this.api.gitSetupConvertRemote(cwd, 'origin'));
    if (!r) return;
    if (r.ok) {
      this.stepSuccess.set(r.unchanged ? this.t('Remote already ssh') : this.t('Remote set to', { url: r.url }));
      await this.diagnose();
    } else {
      this.stepError.set(r.error || this.t('Convert failed'));
    }
  }

  async generateKey(): Promise<void> {
    const r = await this.run('gen-key', () => this.api.gitSetupGenerateKey({
      email: this.genEmail(),
      filename: this.genFilename(),
      type: this.genType(),
    }));
    if (!r) return;
    if (r.ok) {
      this.stepSuccess.set(this.t('Key created', { path: r.privatePath }));
      this.selectedKey.set(r.privatePath);
      await this.diagnose();
    } else {
      this.stepError.set(r.error || this.t('Keygen failed'));
    }
  }

  async savePastedKey(): Promise<void> {
    const r = await this.run('paste-key', () => this.api.gitSetupSaveKey({
      filename: this.pasteFilename(),
      privateKey: this.pastePrivateKey(),
      publicKey: this.pastePublicKey() || undefined,
    }));
    if (!r) return;
    if (r.ok) {
      this.stepSuccess.set(this.t('Key saved', { path: r.privatePath }));
      this.selectedKey.set(r.privatePath);
      this.pastePrivateKey.set('');
      this.pastePublicKey.set('');
      await this.diagnose();
    } else {
      this.stepError.set(r.error || this.t('Save key failed'));
    }
  }

  async selectKey(keyPath: string): Promise<void> {
    this.selectedKey.set(keyPath);
    const cwd = this.cwd();
    if (cwd) {
      await this.api.gitSetupSetPref(cwd, keyPath);
    }
  }

  /** The key that just worked becomes this workspace's key: push/pull offer
   *  it explicitly and (macOS) reload it from the Keychain when the agent
   *  lost it — without this, the default pick was never saved. */
  private async rememberKey(keyPath: string): Promise<void> {
    const cwd = this.cwd();
    if (cwd) {
      try { await this.api.gitSetupSetPref(cwd, keyPath); } catch { /* best effort */ }
    }
  }

  async startAgent(): Promise<void> {
    const r = await this.run('start-agent', () => this.api.gitSetupStartAgent());
    if (!r) return;
    if (r.ok) {
      this.stepSuccess.set(this.t('Agent started'));
      await this.diagnose();
    } else {
      this.stepError.set(r.error || this.t('Agent start failed'));
    }
  }

  async addKeyToAgent(): Promise<void> {
    const key = this.selectedKey();
    if (!key) {
      this.stepError.set(this.t('Select key first'));
      return;
    }
    // Reset any previous passphrase prompt state when starting a fresh attempt.
    this.needsPassphrase.set(false);
    this.passphraseError.set(null);
    this.passphrase.set('');

    const r = await this.run('add-key', () => this.api.gitSetupAddKey(key));
    if (!r) return;
    if (r.ok) {
      await this.rememberKey(key);
      this.stepSuccess.set(r.output || this.t('Key added'));
      await this.diagnose();
    } else if (r.needsPassphrase) {
      // The handler detected the key is encrypted: surface the inline passphrase prompt.
      this.needsPassphrase.set(true);
      this.stepError.set(null);
    } else {
      this.stepError.set(r.error || this.t('Ssh add failed'));
    }
  }

  async submitPassphrase(): Promise<void> {
    const key = this.selectedKey();
    const pp = this.passphrase();
    if (!key) {
      this.passphraseError.set(this.t('Select key first'));
      return;
    }
    if (!pp) {
      this.passphraseError.set(this.t('Enter passphrase'));
      return;
    }
    this.passphraseError.set(null);
    const r = await this.run('add-key-pp', () => this.api.gitSetupAddKey(key, pp));
    // Wipe the in-memory passphrase regardless of outcome so it isn't retained.
    this.passphrase.set('');
    if (!r) return;
    if (r.ok) {
      await this.rememberKey(key);
      this.needsPassphrase.set(false);
      this.stepSuccess.set(r.output || this.t('Key added'));
      await this.diagnose();
    } else {
      // Keep the prompt open so the user can retry.
      this.passphraseError.set(r.error || this.t('Ssh add failed'));
    }
  }

  cancelPassphrase(): void {
    this.needsPassphrase.set(false);
    this.passphrase.set('');
    this.passphraseError.set(null);
  }

  async applyIdentity(): Promise<void> {
    const cwd = this.cwd(); if (!cwd) return;
    const r = await this.run('apply-identity', () => this.api.gitSetupSetIdentity(
      cwd,
      this.identityName().trim(),
      this.identityEmail().trim(),
      this.identityGlobal(),
    ));
    if (!r) return;
    if (r.ok) {
      this.stepSuccess.set(this.t('Identity saved'));
      await this.diagnose();
    } else {
      this.stepError.set(r.error || this.t('Identity failed'));
    }
  }

  async testConnection(): Promise<void> {
    const host = this.diagnosis()?.remote?.host || 'github.com';
    this.testOutput.set(null);
    this.testOk.set(null);
    const r = await this.run('test-conn', () => this.api.gitSetupTestConnection(host));
    if (!r) return;
    this.testOutput.set(r.output || this.t('No output'));
    this.testOk.set(!!r.ok);
    if (r.ok) this.stepSuccess.set(this.t('Connection ok'));
    else this.stepError.set(this.t('Auth failed'));
  }
}
