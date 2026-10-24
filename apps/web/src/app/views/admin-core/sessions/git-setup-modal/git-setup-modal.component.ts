import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { GitSetupService, SetupStep } from '../services/git-setup.service';
import { GitService } from '../services/git.service';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

@Component({
  selector: 'app-git-setup-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (setup.visible()) {
      <div class="gs-backdrop po-modal-overlay" (click)="onBackdrop($event)">
        <div class="gs-modal po-modal" (click)="$event.stopPropagation()" appEscClose (escClose)="setup.close()">
          <!-- Header -->
          <div class="gs-header po-modal-header">
            <div class="gs-title po-modal-title">
              <iconify-icon icon="mdi:wrench" width="18"></iconify-icon>
              {{ 'SESSIONS.GIT_PANEL.Fix setup' | translate }}
            </div>
            <button class="gs-close po-modal-close" (click)="setup.close()" [attr.aria-label]="'COMMON.Close' | translate">
              <iconify-icon icon="mdi:close" width="16"></iconify-icon>
            </button>
          </div>

          <!-- Error banner -->
          @if (setup.lastPushError()) {
            <div class="gs-error-banner">
              <iconify-icon icon="mdi:alert" width="14"></iconify-icon>
              <div class="gs-err-text">{{ setup.lastPushError() }}</div>
            </div>
          }

          <!-- Stepper -->
          <div class="gs-stepper">
            @for (s of steps; track s.id) {
              <button
                class="gs-step"
                [class.active]="setup.currentStep() === s.id"
                [class.has-issue]="setup.stepsWithIssues().has(s.id)"
                (click)="setup.goto(s.id)">
                <span class="gs-step-num">{{ $index + 1 }}</span>
                <span class="gs-step-label">{{ s.label | translate }}</span>
              </button>
            }
          </div>

          <!-- Body -->
          <div class="gs-body po-modal-body">
            @if (setup.diagnosing()) {
              <div class="gs-loading">
                <iconify-icon icon="mdi:refresh" width="16" class="spinning"></iconify-icon>
                {{ 'GIT_SETUP.Diagnosing' | translate }}
              </div>
            } @else if (!setup.diagnosis()) {
              <div class="gs-empty-state">
                <iconify-icon icon="mdi:alert-outline" width="32"></iconify-icon>
                <h4>{{ 'GIT_SETUP.Backend not available' | translate }}</h4>
                <p>{{ 'GIT_SETUP.Backend not loaded' | translate }}</p>
                <p class="gs-empty-hint">{{ 'GIT_SETUP.Backend restart hint' | translate }}</p>
                <button class="gs-btn primary" (click)="setup.diagnose()" [disabled]="setup.diagnosing()">
                  <iconify-icon icon="mdi:refresh" width="14"></iconify-icon>
                  {{ 'GIT_SETUP.Retry diagnose' | translate }}
                </button>
              </div>
            } @else {
              @let d = setup.diagnosis()!;

              <!-- ── STEP: Remote ───────────────────────────────── -->
              @if (setup.currentStep() === 'remote') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Git remote' | translate }}</h5>
                  @if (!d.remote) {
                    <div class="gs-issue error" [innerHTML]="'GIT_SETUP.No origin remote' | translate"></div>
                  } @else {
                    <div class="gs-kv">
                      <span>{{ 'GIT_SETUP.Name' | translate }}</span><code>{{ d.remote.name }}</code>
                    </div>
                    <div class="gs-kv">
                      <span>{{ 'GIT_SETUP.Url' | translate }}</span><code class="gs-url">{{ d.remote.url }}</code>
                    </div>
                    <div class="gs-kv">
                      <span>{{ 'GIT_SETUP.Type' | translate }}</span>
                      <span class="gs-badge" [class.https]="d.remote.type === 'https'" [class.ssh]="d.remote.type === 'ssh'">
                        {{ d.remote.type }}
                      </span>
                    </div>
                    @if (d.remote.type === 'https') {
                      <div class="gs-issue warning">
                        {{ 'GIT_SETUP.Https warning' | translate }}
                      </div>
                      <button class="gs-btn primary" (click)="setup.convertRemote()" [disabled]="setup.busy() === 'convert-remote'">
                        <iconify-icon icon="mdi:swap-horizontal" width="14"></iconify-icon>
                        {{ (setup.busy() === 'convert-remote' ? 'GIT_SETUP.Converting' : 'GIT_SETUP.Convert to SSH') | translate }}
                      </button>
                    } @else if (d.remote.type === 'ssh') {
                      <div class="gs-issue info">{{ 'GIT_SETUP.Already ssh' | translate }}</div>
                    }
                  }
                </div>
              }

              <!-- ── STEP: SSH Keys ─────────────────────────────── -->
              @if (setup.currentStep() === 'keys') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Ssh keys' | translate }}</h5>
                  @if (d.sshKeys.length === 0) {
                    <div class="gs-issue warning" [innerHTML]="'GIT_SETUP.No ssh keys' | translate"></div>
                  } @else {
                    <div class="gs-key-list" role="radiogroup" [attr.aria-label]="'GIT_SETUP.Ssh keys' | translate">
                      @for (k of d.sshKeys; track k.privatePath) {
                        <div class="gs-key-row"
                             role="radio"
                             tabindex="0"
                             [attr.aria-checked]="setup.selectedKey() === k.privatePath"
                             [class.selected]="setup.selectedKey() === k.privatePath"
                             (click)="setup.selectKey(k.privatePath)"
                             (keydown.enter)="setup.selectKey(k.privatePath)"
                             (keydown.space)="$event.preventDefault(); setup.selectKey(k.privatePath)">
                          <iconify-icon
                            class="gs-key-radio-icon"
                            [icon]="setup.selectedKey() === k.privatePath ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'"
                            width="16"></iconify-icon>
                          <div class="gs-key-info">
                            <div class="gs-key-name">
                              <iconify-icon icon="mdi:key" width="13"></iconify-icon>
                              {{ k.name }}
                              <span class="gs-key-type">{{ k.type }}</span>
                            </div>
                            <div class="gs-key-path">{{ k.privatePath }}</div>
                          </div>
                        </div>
                      }
                    </div>
                  }

                  <div class="gs-divider">{{ 'GIT_SETUP.Or' | translate }}</div>

                  <details class="gs-collapse">
                    <summary>{{ 'GIT_SETUP.Generate new key' | translate }}</summary>
                    <div class="gs-form">
                      <label>
                        {{ 'GIT_SETUP.Email' | translate }}
                        <input type="email" [ngModel]="setup.genEmail()" (ngModelChange)="setup.genEmail.set($event)" placeholder="you@example.com" />
                      </label>
                      <label>
                        {{ 'GIT_SETUP.Filename' | translate }}
                        <input type="text" [ngModel]="setup.genFilename()" (ngModelChange)="setup.genFilename.set($event)" />
                      </label>
                      <label>
                        {{ 'GIT_SETUP.Type' | translate }}
                        <select [ngModel]="setup.genType()" (ngModelChange)="setup.genType.set($event)">
                          <option value="ed25519">{{ 'GIT_SETUP.Recommended' | translate }}</option>
                          <option value="rsa">rsa (4096)</option>
                        </select>
                      </label>
                      <button class="gs-btn primary" (click)="setup.generateKey()" [disabled]="setup.busy() === 'gen-key' || !setup.genEmail()">
                        <iconify-icon icon="mdi:key-plus" width="14"></iconify-icon>
                        {{ (setup.busy() === 'gen-key' ? 'GIT_SETUP.Generating' : 'GIT_SETUP.Generate') | translate }}
                      </button>
                    </div>
                  </details>

                  <details class="gs-collapse">
                    <summary>{{ 'GIT_SETUP.Paste existing key' | translate }}</summary>
                    <div class="gs-form">
                      <label>
                        {{ 'GIT_SETUP.Filename' | translate }}
                        <input type="text" [ngModel]="setup.pasteFilename()" (ngModelChange)="setup.pasteFilename.set($event)" />
                      </label>
                      <label>
                        {{ 'GIT_SETUP.Private key' | translate }}
                        <textarea rows="5" [ngModel]="setup.pastePrivateKey()" (ngModelChange)="setup.pastePrivateKey.set($event)"
                                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
                      </label>
                      <label>
                        {{ 'GIT_SETUP.Public key optional' | translate }}
                        <textarea rows="2" [ngModel]="setup.pastePublicKey()" (ngModelChange)="setup.pastePublicKey.set($event)"
                                  placeholder="ssh-ed25519 AAAA..."></textarea>
                      </label>
                      <button class="gs-btn primary" (click)="setup.savePastedKey()" [disabled]="setup.busy() === 'paste-key' || !setup.pastePrivateKey()">
                        <iconify-icon icon="mdi:content-save" width="14"></iconify-icon>
                        {{ (setup.busy() === 'paste-key' ? 'GIT_SETUP.Saving' : 'GIT_SETUP.Save key') | translate }}
                      </button>
                    </div>
                  </details>
                </div>
              }

              <!-- ── STEP: Agent ────────────────────────────────── -->
              @if (setup.currentStep() === 'agent') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Ssh agent' | translate }}</h5>
                  <div class="gs-kv">
                    <span>{{ 'GIT_SETUP.Running' | translate }}</span>
                    <span class="gs-badge" [class.ok]="d.agentRunning" [class.bad]="!d.agentRunning">
                      {{ (d.agentRunning ? 'GIT_SETUP.Yes' : 'GIT_SETUP.No') | translate }}
                    </span>
                  </div>
                  @if (d.agentLoadedKeys.length > 0) {
                    <div class="gs-kv-block">
                      <span>{{ 'GIT_SETUP.Loaded keys' | translate }}</span>
                      <ul class="gs-mono-list">
                        @for (k of d.agentLoadedKeys; track k) {
                          <li>{{ k }}</li>
                        }
                      </ul>
                    </div>
                  } @else {
                    <div class="gs-issue warning">{{ 'GIT_SETUP.No keys loaded' | translate }}</div>
                  }

                  <div class="gs-actions-row">
                    @if (!d.agentRunning) {
                      <button class="gs-btn primary" (click)="setup.startAgent()" [disabled]="setup.busy() === 'start-agent'">
                        <iconify-icon icon="mdi:play" width="14"></iconify-icon>
                        {{ (setup.busy() === 'start-agent' ? 'GIT_SETUP.Starting' : 'GIT_SETUP.Start agent') | translate }}
                      </button>
                    }
                    @if (!setup.needsPassphrase()) {
                      <button class="gs-btn" (click)="setup.addKeyToAgent()" [disabled]="setup.busy() === 'add-key' || !setup.selectedKey()">
                        <iconify-icon icon="mdi:key-arrow-right" width="14"></iconify-icon>
                        {{ (setup.busy() === 'add-key' ? 'GIT_SETUP.Adding' : 'GIT_SETUP.Add selected key') | translate }}
                      </button>
                    }
                  </div>
                  @if (!setup.selectedKey()) {
                    <div class="gs-hint">{{ 'GIT_SETUP.Select key first step' | translate }}</div>
                  }

                  @if (setup.needsPassphrase()) {
                    <div class="gs-form gs-passphrase-prompt">
                      <div class="gs-issue info">
                        {{ 'GIT_SETUP.Passphrase info' | translate }}
                      </div>
                      <label>
                        {{ 'GIT_SETUP.Passphrase' | translate }}
                        <input
                          type="password"
                          autocomplete="off"
                          [ngModel]="setup.passphrase()"
                          (ngModelChange)="setup.passphrase.set($event)"
                          (keydown.enter)="setup.submitPassphrase()"
                          [disabled]="setup.busy() === 'add-key-pp'"
                          placeholder="••••••••"
                        />
                      </label>
                      @if (setup.passphraseError()) {
                        <div class="gs-issue error">{{ setup.passphraseError() }}</div>
                      }
                      <div class="gs-actions-row">
                        <button class="gs-btn primary"
                                (click)="setup.submitPassphrase()"
                                [disabled]="setup.busy() === 'add-key-pp' || !setup.passphrase()">
                          <iconify-icon icon="mdi:lock-open" width="14"></iconify-icon>
                          {{ (setup.busy() === 'add-key-pp' ? 'GIT_SETUP.Unlocking' : 'GIT_SETUP.Unlock add') | translate }}
                        </button>
                        <button class="gs-btn" (click)="setup.cancelPassphrase()" [disabled]="setup.busy() === 'add-key-pp'">
                          {{ 'COMMON.Cancel' | translate }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- ── STEP: Identity ─────────────────────────────── -->
              @if (setup.currentStep() === 'identity') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Git identity' | translate }}</h5>
                  <div class="gs-form">
                    <label>
                      {{ 'GIT_SETUP.Name' | translate }}
                      <input type="text" [ngModel]="setup.identityName()" (ngModelChange)="setup.identityName.set($event)" placeholder="Jane Doe" />
                    </label>
                    <label>
                      {{ 'GIT_SETUP.Email' | translate }}
                      <input type="email" [ngModel]="setup.identityEmail()" (ngModelChange)="setup.identityEmail.set($event)" placeholder="jane@example.com" />
                    </label>
                    <label class="gs-check">
                      <input type="checkbox" [ngModel]="setup.identityGlobal()" (ngModelChange)="setup.identityGlobal.set($event)" />
                      {{ 'GIT_SETUP.Apply globally' | translate }}
                    </label>
                    <button class="gs-btn primary" (click)="setup.applyIdentity()"
                            [disabled]="setup.busy() === 'apply-identity' || !setup.identityName() || !setup.identityEmail()">
                      <iconify-icon icon="mdi:account-check" width="14"></iconify-icon>
                      {{ (setup.busy() === 'apply-identity' ? 'GIT_SETUP.Applying' : 'GIT_SETUP.Apply config') | translate }}
                    </button>
                  </div>
                </div>
              }

              <!-- ── STEP: Test ─────────────────────────────────── -->
              @if (setup.currentStep() === 'test') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Test connection' | translate }}</h5>
                  <div class="gs-kv">
                    <span>{{ 'GIT_SETUP.Host' | translate }}</span>
                    <code>git&#64;{{ d.remote?.host || 'github.com' }}</code>
                  </div>
                  <button class="gs-btn primary" (click)="setup.testConnection()" [disabled]="setup.busy() === 'test-conn'">
                    <iconify-icon icon="mdi:lan-connect" width="14"></iconify-icon>
                    {{ (setup.busy() === 'test-conn' ? 'GIT_SETUP.Testing' : 'GIT_SETUP.Test connection') | translate }}
                  </button>
                  @if (setup.testOutput(); as out) {
                    <div class="gs-test-output" [class.ok]="setup.testOk() === true" [class.err]="setup.testOk() === false">
                      <pre>{{ out }}</pre>
                    </div>
                  }
                </div>
              }

              <!-- ── STEP: Retry ────────────────────────────────── -->
              @if (setup.currentStep() === 'retry') {
                <div class="gs-step-content">
                  <h5>{{ 'GIT_SETUP.Step retry' | translate }}</h5>
                  @if (d.issues.length === 0) {
                    <div class="gs-issue info">{{ 'GIT_SETUP.All checks passed' | translate }}</div>
                  } @else {
                    <div class="gs-issue warning">
                      {{ 'GIT_SETUP.Issues remain' | translate: { count: d.issues.length } }}
                    </div>
                  }
                  <div class="gs-retry-row">
                    <button class="gs-btn primary big" (click)="retryPush()" [disabled]="pushing || git.aiResolving()">
                      <iconify-icon icon="mdi:arrow-up-bold" width="14"></iconify-icon>
                      {{ (pushing ? 'SESSIONS.GIT_PANEL.Pushing' : 'GIT_SETUP.Step retry') | translate }}
                    </button>
                    @if (pushOk === false || setup.lastPushError()) {
                      <button class="gs-btn ai big" (click)="aiResolve()" [disabled]="pushing || git.aiResolving()"
                              [title]="'SESSIONS.GIT_PANEL.AI resolver hint' | translate">
                        <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14" [class.spinning]="git.aiResolving()"></iconify-icon>
                        {{ (git.aiResolving() ? 'SESSIONS.GIT_PANEL.Resolving' : 'SESSIONS.GIT_PANEL.AI resolver') | translate }}
                      </button>
                    }
                  </div>
                  @if (git.aiResolving() || git.aiResolveSteps().length > 0) {
                    <div class="gs-ai-log">
                      @if (git.aiResolving()) {
                        <div class="gs-ai-working">
                          <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="13" class="spinning"></iconify-icon>
                          <span>{{ git.aiResolvePhase() || ('GIT_SETUP.Working on it' | translate) }}</span>
                        </div>
                      }
                      @for (s of git.aiResolveSteps(); track $index) {
                        <div class="gs-ai-step">
                          <iconify-icon icon="mdi:check" width="12"></iconify-icon>
                          <span>{{ s }}</span>
                        </div>
                      }
                    </div>
                  }
                  @if (pushMessage) {
                    <div class="gs-test-output" [class.ok]="pushOk === true" [class.err]="pushOk === false">
                      <pre>{{ pushMessage }}</pre>
                    </div>
                  }
                </div>
              }

              <!-- Feedback -->
              @if (setup.stepError()) {
                <div class="gs-feedback err">
                  <iconify-icon icon="mdi:alert-circle" width="13"></iconify-icon>
                  {{ setup.stepError() }}
                </div>
              }
              @if (setup.stepSuccess()) {
                <div class="gs-feedback ok">
                  <iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>
                  {{ setup.stepSuccess() }}
                </div>
              }
            }
          </div>

          <!-- Footer -->
          <div class="gs-footer po-modal-footer">
            <button class="gs-btn ghost" (click)="setup.diagnose()" [disabled]="setup.diagnosing()">
              <iconify-icon icon="mdi:refresh" width="13"></iconify-icon>
              {{ 'GIT_SETUP.Re-diagnose' | translate }}
            </button>
            <div class="gs-footer-nav">
              <button class="gs-btn ghost" (click)="prev()" [disabled]="!hasPrev()">
                <iconify-icon icon="mdi:chevron-left" width="14"></iconify-icon> {{ 'SESSIONS.Back' | translate }}
              </button>
              <button class="gs-btn primary" (click)="next()" [disabled]="!hasNext()">
                {{ 'SESSIONS.Next' | translate }} <iconify-icon icon="mdi:chevron-right" width="14"></iconify-icon>
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .gs-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(2px);
    }
    .gs-modal {
      background: var(--po-bg-0);
      color: var(--po-text-primary);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      width: min(720px, 92vw);
      max-height: 85vh;
      display: flex; flex-direction: column;
      box-shadow: 0 25px 50px rgba(0,0,0,0.4);
    }
    .gs-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .gs-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.95rem; }
    .gs-close {
      background: transparent; border: 0; color: inherit; cursor: pointer; opacity: 0.6;
      padding: 4px; border-radius: 4px;
    }
    .gs-close:hover { opacity: 1; background: rgba(255,255,255,0.06); }

    .gs-error-banner {
      display: flex; gap: 8px; align-items: flex-start;
      padding: 8px 14px; margin: 10px 14px 0;
      background: var(--po-error-bg); border: 1px solid rgba(248,81,73,0.3);
      border-radius: 6px; font-size: 0.78rem; color: var(--po-error);
    }
    .gs-err-text { word-break: break-word; }

    .gs-stepper {
      display: flex; gap: 4px; padding: 12px 14px 4px;
      overflow-x: auto;
    }
    .gs-step {
      display: flex; align-items: center; gap: 6px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 999px; padding: 4px 10px; font-size: 0.72rem;
      color: inherit; cursor: pointer; white-space: nowrap;
    }
    .gs-step.active { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.5); color: var(--po-accent); }
    .gs-step.has-issue .gs-step-num { color: var(--po-error); }
    .gs-step-num {
      width: 18px; height: 18px; border-radius: 50%;
      background: rgba(255,255,255,0.08); display: inline-flex;
      align-items: center; justify-content: center; font-weight: 600; font-size: 0.7rem;
    }

    .gs-body {
      flex: 1; overflow-y: auto; padding: 14px 18px 6px;
    }
    .gs-step-content h5 {
      font-size: 0.85rem; font-weight: 600; margin: 0 0 10px;
      color: var(--po-text-primary);
    }
    .gs-loading { display: flex; gap: 8px; padding: 20px; justify-content: center; opacity: 0.7; }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .gs-kv, .gs-kv-block {
      display: flex; gap: 10px; margin-bottom: 6px; font-size: 0.78rem;
    }
    .gs-kv-block { flex-direction: column; gap: 4px; }
    .gs-kv > span:first-child, .gs-kv-block > span:first-child {
      min-width: 72px; color: var(--po-text-secondary);
    }
    .gs-kv code, .gs-url {
      background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;
      word-break: break-all;
    }
    .gs-badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;
      background: rgba(255,255,255,0.08); text-transform: uppercase;
    }
    .gs-badge.ssh { background: var(--po-success-bg); color: var(--po-success); }
    .gs-badge.https { background: var(--po-warning-bg); color: var(--po-warning); }
    .gs-badge.ok { background: var(--po-success-bg); color: var(--po-success); }
    .gs-badge.bad { background: var(--po-error-bg); color: var(--po-error); }

    .gs-issue {
      padding: 8px 10px; border-radius: 6px; font-size: 0.76rem; margin: 8px 0;
      border: 1px solid transparent;
    }
    .gs-issue.error { background: var(--po-error-bg); border-color: rgba(248,81,73,0.3); color: var(--po-error); }
    .gs-issue.warning { background: var(--po-warning-bg); border-color: rgba(210,153,34,0.3); color: var(--po-warning); }
    .gs-issue.info { background: var(--po-accent-muted-bg); border-color: rgba(99,102,241,0.3); color: var(--po-accent); }
    .gs-issue code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; }

    .gs-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04); color: inherit; font-size: 0.78rem;
      cursor: pointer; transition: all 0.15s;
    }
    .gs-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .gs-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .gs-btn.primary { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.5); color: var(--po-accent); }
    .gs-btn.primary:hover:not(:disabled) { background: rgba(99,102,241,0.35); }
    .gs-btn.big { padding: 10px 18px; font-size: 0.85rem; }
    .gs-btn.ghost { background: transparent; }
    .gs-btn.ai {
      background: linear-gradient(90deg, rgba(110,86,207,0.2), rgba(166,114,255,0.2));
      border-color: rgba(166,114,255,0.5); color: #a672ff;
    }
    .gs-btn.ai:hover:not(:disabled) { background: linear-gradient(90deg, rgba(110,86,207,0.32), rgba(166,114,255,0.32)); }
    .gs-retry-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .gs-ai-log {
      margin-top: 10px; padding: 8px 10px; border-radius: 6px;
      background: rgba(166,114,255,0.06); border: 1px solid rgba(166,114,255,0.2);
      display: flex; flex-direction: column; gap: 4px; font-size: 0.74rem;
    }
    .gs-ai-working { display: flex; align-items: center; gap: 6px; color: #a672ff; }
    .gs-ai-step { display: flex; align-items: center; gap: 6px; color: var(--po-text-secondary); }
    .gs-ai-step iconify-icon { color: #a672ff; flex-shrink: 0; }

    .gs-key-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .gs-key-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
      cursor: pointer;
    }
    .gs-key-row:focus-visible { outline: 2px solid rgba(99,102,241,0.6); outline-offset: 1px; }
    .gs-key-row.selected { border-color: rgba(99,102,241,0.5); background: rgba(99,102,241,0.05); }
    .gs-key-radio-icon { color: rgba(255,255,255,0.35); flex-shrink: 0; }
    .gs-key-row.selected .gs-key-radio-icon { color: var(--po-accent); }
    .gs-key-info { flex: 1; }
    .gs-key-name { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; font-weight: 500; }
    .gs-key-type { font-size: 0.65rem; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; text-transform: uppercase; }
    .gs-key-path { font-size: 0.68rem; color: var(--po-text-secondary); font-family: monospace; }

    .gs-divider {
      text-align: center; font-size: 0.7rem; color: var(--po-text-secondary);
      margin: 10px 0; position: relative;
    }
    .gs-divider::before, .gs-divider::after {
      content: ""; position: absolute; top: 50%; width: 40%;
      height: 1px; background: rgba(255,255,255,0.08);
    }
    .gs-divider::before { left: 0; }
    .gs-divider::after { right: 0; }

    .gs-collapse {
      margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
    }
    .gs-collapse summary {
      padding: 8px 12px; cursor: pointer; font-size: 0.78rem; font-weight: 500;
      list-style: none;
    }
    .gs-collapse summary::-webkit-details-marker { display: none; }
    .gs-collapse[open] summary { border-bottom: 1px solid rgba(255,255,255,0.08); }
    .gs-collapse .gs-form { padding: 10px 12px; }

    .gs-form { display: flex; flex-direction: column; gap: 8px; }
    .gs-form label {
      display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem;
      color: var(--po-text-secondary);
    }
    .gs-form label.gs-check { flex-direction: row; align-items: center; }
    .gs-form input[type="text"], .gs-form input[type="email"],
    .gs-form textarea, .gs-form select {
      padding: 6px 10px; font-size: 0.78rem;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 5px; color: var(--po-text-primary);
      font-family: inherit;
    }
    .gs-form textarea { font-family: monospace; font-size: 0.72rem; resize: vertical; }

    .gs-mono-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 2px;
    }
    .gs-mono-list li {
      font-family: monospace; font-size: 0.7rem;
      background: rgba(255,255,255,0.04); padding: 3px 8px; border-radius: 3px;
      word-break: break-all;
    }

    .gs-actions-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .gs-hint { font-size: 0.7rem; color: var(--po-text-secondary); margin-top: 6px; }

    .gs-test-output {
      margin-top: 10px; padding: 8px 10px; border-radius: 6px;
      background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
      max-height: 200px; overflow: auto;
    }
    .gs-test-output pre { margin: 0; font-size: 0.7rem; white-space: pre-wrap; word-break: break-all; }
    .gs-test-output.ok { border-color: rgba(63,185,80,0.4); }
    .gs-test-output.err { border-color: rgba(248,81,73,0.4); }

    .gs-feedback {
      margin-top: 10px; padding: 6px 10px; border-radius: 5px; font-size: 0.74rem;
      display: flex; align-items: center; gap: 6px;
    }
    .gs-feedback.err { background: var(--po-error-bg); color: var(--po-error); }
    .gs-feedback.ok { background: var(--po-success-bg); color: var(--po-success); }

    .gs-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08);
    }
    .gs-footer-nav { display: flex; gap: 6px; }

    .gs-empty-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 28px 20px; gap: 8px; text-align: center;
    }
    .gs-empty-state h4 {
      margin: 6px 0 2px; font-size: 0.95rem; font-weight: 600;
    }
    .gs-empty-state p {
      margin: 0; font-size: 0.78rem; color: var(--po-text-secondary);
      max-width: 420px;
    }
    .gs-empty-state .gs-empty-hint { color: var(--po-warning); }
    .gs-empty-state .gs-btn { margin-top: 10px; }
  `,
})
export class GitSetupModalComponent {
  setup = inject(GitSetupService);
  git = inject(GitService);
  private readonly translate = inject(TranslateService);

  pushing = false;
  pushMessage = '';
  pushOk: boolean | null = null;

  readonly steps: { id: SetupStep; label: string }[] = [
    { id: 'remote', label: 'GIT_SETUP.Step remote' },
    { id: 'keys', label: 'GIT_SETUP.Step keys' },
    { id: 'agent', label: 'GIT_SETUP.Step agent' },
    { id: 'identity', label: 'GIT_SETUP.Step identity' },
    { id: 'test', label: 'GIT_SETUP.Step test' },
    { id: 'retry', label: 'GIT_SETUP.Step retry' },
  ];

  onBackdrop(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('gs-backdrop')) {
      this.setup.close();
    }
  }

  stepIndex(): number {
    return this.steps.findIndex(s => s.id === this.setup.currentStep());
  }

  hasPrev(): boolean { return this.stepIndex() > 0; }
  hasNext(): boolean { return this.stepIndex() < this.steps.length - 1; }

  prev(): void {
    const i = this.stepIndex();
    if (i > 0) this.setup.goto(this.steps[i - 1].id);
  }
  next(): void {
    const i = this.stepIndex();
    if (i < this.steps.length - 1) this.setup.goto(this.steps[i + 1].id);
  }

  async retryPush(): Promise<void> {
    const cwd = this.setup.cwd();
    if (!cwd) return;
    this.pushing = true;
    this.pushMessage = '';
    this.pushOk = null;
    try {
      await this.git.push(cwd);
      const err = this.git.syncError();
      if (err) {
        this.pushOk = false;
        this.pushMessage = err;
        // Refresh diagnosis with fresh error context
        this.setup.lastPushError.set(err);
        await this.setup.diagnose();
      } else {
        this.pushOk = true;
        this.pushMessage = this.git.syncSuccess() || this.translate.instant('GIT_SETUP.Push successful');
      }
    } finally {
      this.pushing = false;
    }
  }

  async aiResolve(): Promise<void> {
    const cwd = this.setup.cwd();
    if (!cwd) return;
    const lastError = this.pushMessage || this.setup.lastPushError() || undefined;
    const result = await this.git.aiResolveSync(cwd, 'push', this.setup.provider(), lastError);
    if (result.ok) {
      this.pushOk = true;
      this.pushMessage = this.git.syncSuccess() || this.translate.instant('GIT_SETUP.Push successful');
      this.setup.lastPushError.set(null);
    } else {
      this.pushOk = false;
      this.pushMessage = result.error || this.translate.instant('GIT_SETUP.AI resolver failed');
      this.setup.lastPushError.set(this.pushMessage);
      await this.setup.diagnose();
    }
  }
}
