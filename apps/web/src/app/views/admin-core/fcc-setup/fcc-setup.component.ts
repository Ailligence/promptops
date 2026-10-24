import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';

interface ProviderEntry {
  id: string;
  name: string;
  tier: 'local' | 'cloud-free' | 'cloud-paid';
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
  modelDetails?: ModelDetail[];
}

interface ModelDetail {
  id: string;
  tier: 'low' | 'medium' | 'high';
  ram: string;
  recommended?: boolean;
  label?: string;
  installCmd?: string;
  runCmd?: string;
}

// ── Hardware scan (mirrors the desktop hardware scan types) ─────────────────
interface ScanHardwareProfile {
  os: { platform: string; arch: string; release: string; label: string };
  cpu: { model: string; cores: number; hasAvx: boolean | null };
  memory: { totalMb: number; freeMb: number };
  gpus: Array<{ vendor: string; model: string; vramMb: number; unifiedMemory: boolean }>;
  accelerator: string;
  effectiveVramMb: number;
  warnings: string[];
}

interface ScanRecommendation {
  id: string;
  name: string;
  family: string;
  compatibility: number;
  compatibilityLabel: string;
  performanceLevel: string;
  estimatedTokensPerSec: number;
  fit: 'gpu' | 'partial' | 'cpu';
  requiredRamGb: number;
  requiredVramGb: number;
  quantLabel: string;
  tasks: string[];
  reasons: string[];
  setupHint: string;
  score: number;
}

interface ScanResult {
  hardware: ScanHardwareProfile;
  recommendations: ScanRecommendation[];
  generatedAt: string;
}

/** Install guide steps: translation keys (rendered with [innerHTML]; the values only hold <b>/<code>). */
interface GuideStep { key: string; params?: Record<string, string> }
const signUp = (site: string): GuideStep => ({ key: 'FCC_SETUP.G sign up', params: { site } });
const CREATE_KEY: GuideStep = { key: 'FCC_SETUP.G create key' };
const PICK_MODEL: GuideStep = { key: 'FCC_SETUP.G pick model' };
const INSTALL_GUIDES: Record<string, { steps: GuideStep[]; link: string }> = {
  ollama: {
    steps: [{ key: 'FCC_SETUP.G ollama 1' }, { key: 'FCC_SETUP.G ollama 2' }, { key: 'FCC_SETUP.G ollama 3' }],
    link: 'https://ollama.com/download',
  },
  lm_studio: {
    steps: [{ key: 'FCC_SETUP.G lmstudio 1' }, { key: 'FCC_SETUP.G lmstudio 2' }, { key: 'FCC_SETUP.G lmstudio 3' }, { key: 'FCC_SETUP.G lmstudio 4' }],
    link: 'https://lmstudio.ai',
  },
  llamacpp: {
    steps: [{ key: 'FCC_SETUP.G llamacpp 1' }, { key: 'FCC_SETUP.G llamacpp 2' }, { key: 'FCC_SETUP.G llamacpp 3' }],
    link: 'https://github.com/ggml-org/llama.cpp',
  },
  // Model ids and prices change often: the steps point at the picker below and the
  // provider's own pages instead of naming free models or quoting prices.
  open_router: { steps: [signUp('openrouter.ai'), { key: 'FCC_SETUP.G openrouter 2' }, { key: 'FCC_SETUP.G openrouter 3' }], link: 'https://openrouter.ai/keys' },
  opencode: { steps: [signUp('opencode.ai'), { key: 'FCC_SETUP.G opencode 2' }, { key: 'FCC_SETUP.G opencode 3' }], link: 'https://opencode.ai' },
  nvidia_nim: { steps: [signUp('build.nvidia.com'), CREATE_KEY, { key: 'FCC_SETUP.G nvidia 3' }], link: 'https://build.nvidia.com' },
  zai: { steps: [signUp('z.ai'), CREATE_KEY, { key: 'FCC_SETUP.G zai 3' }], link: 'https://z.ai' },
  kimi: { steps: [signUp('platform.moonshot.cn'), { key: 'FCC_SETUP.G kimi 2' }, PICK_MODEL], link: 'https://platform.moonshot.cn' },
  deepseek: { steps: [signUp('platform.deepseek.com'), { key: 'FCC_SETUP.G deepseek 2' }, { key: 'FCC_SETUP.G deepseek 3' }], link: 'https://platform.deepseek.com/api_keys' },
  fireworks: { steps: [signUp('fireworks.ai'), CREATE_KEY, PICK_MODEL], link: 'https://fireworks.ai' },
  wafer: { steps: [signUp('wafer.ai'), CREATE_KEY, PICK_MODEL], link: 'https://wafer.ai' },
};

const TIER_META: Record<string, { label: string; icon: string; color: string; desc: string }> = {
  low:    { label: 'FCC_SETUP.Tier low',    icon: 'solar:leaf-bold-duotone', color: '#10b981', desc: 'FCC_SETUP.Tier low desc' },
  medium: { label: 'FCC_SETUP.Tier medium', icon: 'solar:star-bold-duotone', color: '#6366f1', desc: 'FCC_SETUP.Tier medium desc' },
  high:   { label: 'FCC_SETUP.Tier high',   icon: 'solar:fire-bold-duotone', color: '#f59e0b', desc: 'FCC_SETUP.Tier high desc' },
};

@Component({
  selector: 'app-fcc-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="setup-page">

      <!-- ═══════════ HERO (compact) ═══════════ -->
      <div class="hero">
        <div class="hero-grid">
          <div class="hero-left">
            <div class="hero-title-row">
              <div class="hero-badge">
                <iconify-icon icon="solar:file-terminal-bold" width="20"></iconify-icon>
              </div>
              <h1 class="hero-title">PromptOps <span class="hero-accent">CLI</span></h1>
              @if (pinging()) {
                <span class="badge-status pinging"><iconify-icon icon="solar:refresh-bold" width="13" class="spin"></iconify-icon> {{ 'FCC_SETUP.Checking' | translate }}</span>
              } @else if (pingOk()) {
                <span class="badge-status ok"><iconify-icon icon="solar:check-circle-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Connected' | translate }}</span>
              } @else if (configured()) {
                <span class="badge-status fail"><iconify-icon icon="solar:danger-triangle-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Not reachable' | translate }}</span>
                <button class="btn-retry" (click)="pingProvider()"><iconify-icon icon="solar:refresh-bold" width="12"></iconify-icon> {{ 'FCC_SETUP.Retry' | translate }}</button>
              } @else {
                <span class="badge-status pending"><iconify-icon icon="solar:info-circle-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Not configured' | translate }}</span>
              }
            </div>
            <p class="hero-subtitle">{{ 'FCC_SETUP.Subtitle' | translate }}</p>

            <div class="hero-chips">
              <span class="hchip"><iconify-icon icon="solar:shield-check-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip private' | translate }}</span>
              <span class="hchip"><iconify-icon icon="solar:code-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip agentic' | translate }}</span>
              <span class="hchip"><iconify-icon icon="solar:bolt-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip any' | translate }}</span>
              <span class="hchip"><iconify-icon icon="solar:wallet-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip free' | translate }}</span>
              <span class="hchip"><iconify-icon icon="solar:monitor-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip cross' | translate }}</span>
              <span class="hchip"><iconify-icon icon="solar:branching-paths-up-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Chip git' | translate }}</span>
            </div>

            <details class="why-box">
              <summary><iconify-icon icon="solar:question-circle-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Why' | translate }}</summary>
              <div class="features-grid">
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #10b981, #34d399);"><iconify-icon icon="solar:shield-check-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F private title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F private' | translate }}</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #6366f1, #a855f7);"><iconify-icon icon="solar:code-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F agentic title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F agentic' | translate }}</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #f59e0b, #fbbf24);"><iconify-icon icon="solar:bolt-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F any title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F any' | translate }}</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #ec4899, #f472b6);"><iconify-icon icon="solar:wallet-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F free title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F free' | translate }}</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #06b6d4, #22d3ee);"><iconify-icon icon="solar:monitor-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F cross title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F cross' | translate }}</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon" style="background: linear-gradient(135deg, #8b5cf6, #c084fc);"><iconify-icon icon="solar:branching-paths-up-bold-duotone" width="18"></iconify-icon></div>
                  <h4>{{ 'FCC_SETUP.F git title' | translate }}</h4>
                  <p>{{ 'FCC_SETUP.F git' | translate }}</p>
                </div>
              </div>
            </details>
          </div>

          <!-- macOS terminal window showcase -->
          <div class="term-window">
            <div class="term-bar">
              <span class="term-dot red"></span>
              <span class="term-dot yellow"></span>
              <span class="term-dot green"></span>
              <span class="term-title">promptops-cli — zsh</span>
            </div>
            <div class="term-body">
              <img src="assets/images/promptops-cli-terminal.png" [alt]="'FCC_SETUP.Terminal alt' | translate" loading="lazy" />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════ HARDWARE SCAN — pre-step helper ═══════════ -->
      <div class="scan-card">
        <div class="scan-head">
          <div class="scan-icon"><iconify-icon icon="solar:cpu-bolt-bold-duotone" width="20"></iconify-icon></div>
          <div class="scan-head-text">
            <h3>{{ 'FCC_SETUP.Scan title' | translate }}</h3>
            <p>{{ 'FCC_SETUP.Scan desc' | translate }}</p>
          </div>
          <button class="btn-action btn-purple scan-btn" (click)="scanHardware()" [disabled]="scanning()">
            @if (scanning()) {
              <iconify-icon icon="solar:refresh-bold" width="15" class="spin"></iconify-icon> {{ 'FCC_SETUP.Scanning' | translate }}
            } @else {
              <iconify-icon icon="solar:magnifer-bold" width="15"></iconify-icon> {{ 'FCC_SETUP.Scan button' | translate }}
            }
          </button>
        </div>

        @if (scanning()) {
          <div class="scan-loading">
            <iconify-icon icon="solar:refresh-bold" width="16" class="spin"></iconify-icon>
            {{ 'FCC_SETUP.Analyzing' | translate }}
          </div>
        } @else if (scanError()) {
          <div class="result-msg fail">
            <iconify-icon icon="solar:danger-triangle-bold" width="15"></iconify-icon> {{ scanError() }}
          </div>
        } @else {
          @if (scanResult(); as result) {
            <div class="hw-summary">
              <span class="hw-chip"><iconify-icon icon="solar:cpu-bold" width="13"></iconify-icon> {{ result.hardware.cpu.model }} · {{ 'FCC_SETUP.Cores' | translate: { count: result.hardware.cpu.cores } }}</span>
              <span class="hw-chip"><iconify-icon icon="solar:ssd-square-bold" width="13"></iconify-icon> {{ gb(result.hardware.memory.totalMb) }} GB RAM</span>
              <span class="hw-chip"><iconify-icon icon="solar:graph-bold" width="13"></iconify-icon> {{ gpuLabel(result.hardware) }}</span>
              <span class="hw-chip"><iconify-icon icon="solar:monitor-bold" width="13"></iconify-icon> {{ result.hardware.os.label }}</span>
            </div>

            @for (w of result.hardware.warnings; track $index) {
              <div class="hw-warn"><iconify-icon icon="solar:info-circle-bold" width="13"></iconify-icon> {{ w }}</div>
            }

            @if (result.recommendations.length === 0) {
              <div class="scan-empty">
                <iconify-icon icon="solar:sad-circle-bold-duotone" width="22"></iconify-icon>
                <span>{{ 'FCC_SETUP.No compatible' | translate }}</span>
              </div>
            } @else {
              <div class="rec-note">
                <iconify-icon icon="solar:shield-check-bold" width="14"></iconify-icon>
                <span [innerHTML]="'FCC_SETUP.Rec note' | translate"></span>
              </div>
              <div class="rec-list">
                @for (rec of result.recommendations; track rec.id; let i = $index) {
                  <div class="rec-card" [class.rec-top]="i === 0">
                    <div class="rec-top-row">
                      <div class="rec-rank">{{ i + 1 }}</div>
                      <div class="rec-name-block">
                        <span class="rec-name">{{ rec.name }}</span>
                        <span class="rec-tags">
                          @for (t of rec.tasks; track t) { <span class="rec-tag">{{ t }}</span> }
                        </span>
                      </div>
                      <div class="rec-compat" [style.color]="compatColor(rec.compatibility)">
                        <strong>{{ rec.compatibility }}%</strong>
                        <span>{{ rec.compatibilityLabel }}</span>
                      </div>
                    </div>

                    <div class="rec-meta-row">
                      <span class="rec-meta"><iconify-icon icon="solar:bolt-bold" width="12"></iconify-icon> {{ rec.performanceLevel }} · ~{{ rec.estimatedTokensPerSec }} tok/s</span>
                      <span class="rec-meta"><iconify-icon icon="solar:ssd-square-bold" width="12"></iconify-icon> ~{{ rec.requiredRamGb }} GB {{ rec.fit === 'gpu' ? 'VRAM' : 'RAM' }}</span>
                      <span class="rec-meta"><iconify-icon icon="solar:layers-minimalistic-bold" width="12"></iconify-icon> {{ rec.quantLabel }} · {{ fitLabel(rec.fit) }}</span>
                    </div>

                    <ul class="rec-reasons">
                      @for (r of rec.reasons; track $index) { <li>{{ r }}</li> }
                    </ul>

                    <div class="rec-actions">
                      <div class="rec-setup">
                        <code>{{ rec.setupHint }}</code>
                        <button class="cmd-copy" (click)="copyCmd(rec.setupHint, $event)" [title]="'FCC_SETUP.Copy command' | translate" [attr.aria-label]="'FCC_SETUP.Copy command' | translate">
                          <iconify-icon icon="solar:copy-bold" width="12"></iconify-icon>
                        </button>
                      </div>
                      <button class="btn-use" (click)="useRecommendation(rec)">
                        <iconify-icon icon="solar:arrow-right-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Use model' | translate }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          } @else {
            <div class="scan-empty">
              <iconify-icon icon="solar:cpu-bold-duotone" width="22"></iconify-icon>
              <span>{{ 'FCC_SETUP.Scan empty' | translate }}</span>
            </div>
          }
        }
      </div>

      <!-- ═══════════ STEP RAIL ═══════════ -->
      <div class="step-rail">
        <button class="step-node" [class.done]="step1Done()" [class.active]="openStep() === 1" (click)="toggleStep(1)">
          <span class="step-dot">@if (step1Done()) { <iconify-icon icon="solar:check-bold" width="13"></iconify-icon> } @else { 1 }</span>
          <span class="step-lbl">{{ 'FCC_SETUP.Step choose' | translate }}</span>
        </button>
        <span class="step-line"></span>
        <button class="step-node" [class.active]="openStep() === 2" (click)="toggleStep(2)">
          <span class="step-dot">2</span>
          <span class="step-lbl">{{ 'FCC_SETUP.Step connect' | translate }}</span>
        </button>
        <span class="step-line"></span>
        <button class="step-node" [class.done]="configured()" [class.active]="openStep() === 3" (click)="toggleStep(3)">
          <span class="step-dot">@if (configured()) { <iconify-icon icon="solar:check-bold" width="13"></iconify-icon> } @else { 3 }</span>
          <span class="step-lbl">{{ 'FCC_SETUP.Step save' | translate }}</span>
        </button>
      </div>

      <!-- ═══════════ STEP 1 — CHOOSE A MODEL ═══════════ -->
      <section class="step-card" [class.open]="openStep() === 1">
        <button class="step-head" (click)="toggleStep(1)">
          <span class="step-badge" [class.done]="step1Done()">@if (step1Done()) { <iconify-icon icon="solar:check-bold" width="14"></iconify-icon> } @else { 1 }</span>
          <div class="step-head-text">
            <h2>{{ 'FCC_SETUP.Step choose' | translate }}</h2>
            <p>{{ 'FCC_SETUP.Choose desc' | translate }}</p>
          </div>
          @if (step1Done()) { <span class="step-summary sum-ok"><iconify-icon icon="solar:check-circle-bold" width="13"></iconify-icon> {{ currentModelLabel() }}</span> }
          <iconify-icon class="chev" icon="solar:alt-arrow-down-bold" width="16"></iconify-icon>
        </button>
        @if (openStep() === 1) {
        <div class="step-body">

        <!-- Source tabs -->
        <div class="tab-bar">
          <button class="tab" [class.active]="activeTab() === 'local'" (click)="activeTab.set('local')">
            <iconify-icon icon="solar:monitor-bold-duotone" width="15"></iconify-icon> {{ 'FCC_SETUP.Tab local' | translate }}
          </button>
          <button class="tab" [class.active]="activeTab() === 'cloud-free'" (click)="activeTab.set('cloud-free')">
            <iconify-icon icon="solar:cloud-bolt-bold-duotone" width="15"></iconify-icon> {{ 'FCC_SETUP.Tab free' | translate }}
          </button>
          <button class="tab" [class.active]="activeTab() === 'cloud-paid'" (click)="activeTab.set('cloud-paid')">
            <iconify-icon icon="solar:wallet-bold-duotone" width="15"></iconify-icon> {{ 'FCC_SETUP.Tab low cost' | translate }}
          </button>
          <button class="tab" [class.active]="activeTab() === 'custom'" (click)="activeTab.set('custom')">
            <iconify-icon icon="solar:settings-bold-duotone" width="15"></iconify-icon> {{ 'FCC_SETUP.Tab custom' | translate }}
          </button>
        </div>

        <!-- ── CUSTOM source ── -->
        @if (activeTab() === 'custom') {
          <div class="custom-intro">
            <iconify-icon icon="solar:tuning-2-bold-duotone" width="18"></iconify-icon>
            <div>
              <strong>{{ 'FCC_SETUP.Manual title' | translate }}</strong>
              <p>{{ 'FCC_SETUP.Manual desc' | translate }}</p>
            </div>
          </div>

          <div class="custom-form">
            <div class="field-group">
              <label class="field-lbl">{{ 'FCC_SETUP.Base URL' | translate }} <span class="field-req">*</span></label>
              <input type="text" class="form-input" placeholder="http://localhost:11434/v1" [value]="customBaseUrl()" (input)="customBaseUrl.set($any($event.target).value)" />
              <span class="field-hint">{{ 'FCC_SETUP.Base URL hint' | translate }}</span>
            </div>

            <div class="field-row">
              <div class="field-group field-flex">
                <label class="field-lbl">{{ 'FCC_SETUP.Model name' | translate }} <span class="field-req">*</span></label>
                <input type="text" class="form-input" placeholder="qwen2.5-coder:14b" [value]="customModel()" (input)="customModel.set($any($event.target).value)" />
              </div>
              <div class="field-group field-flex">
                <label class="field-lbl">{{ 'FCC_SETUP.Provider label' | translate }}</label>
                <input type="text" class="form-input" placeholder="my-server" [value]="customProviderLabel()" (input)="customProviderLabel.set($any($event.target).value)" />
                <span class="field-hint">{{ 'FCC_SETUP.Provider label hint' | translate }}</span>
              </div>
            </div>

            <div class="field-group">
              <label class="field-lbl">{{ 'FCC_SETUP.API key' | translate }} <span class="field-opt">{{ 'FCC_SETUP.Optional' | translate }}</span></label>
              <input type="password" class="form-input" [placeholder]="'FCC_SETUP.Custom key placeholder' | translate" [value]="customApiKey()" (input)="customApiKey.set($any($event.target).value)" />
              <span class="field-hint">{{ 'FCC_SETUP.Custom key hint' | translate }}</span>
            </div>
          </div>
        }

        <!-- ── PRESET source (local / cloud-free / cloud-paid) ── -->
        @if (activeTab() !== 'custom') {
          <div class="provider-row">
            @for (p of providersForTab(); track p.id) {
              <button class="prov-btn" [class.selected]="selectedProvider() === p.id" (click)="selectProvider(p)">
                {{ p.name }}
                @if (!p.requiresApiKey) { <span class="prov-free">{{ 'FCC_SETUP.Free' | translate }}</span> }
                @if (selectedProvider() === p.id) { <iconify-icon icon="solar:check-circle-bold" width="14" class="prov-chk"></iconify-icon> }
              </button>
            }
          </div>

          @if (installGuide()) {
            <details class="guide-box">
              <summary><iconify-icon icon="solar:book-2-bold-duotone" width="14"></iconify-icon> {{ 'FCC_SETUP.How to install' | translate: { name: selectedProviderName() } }}</summary>
              <ol class="guide-steps">
                @for (step of installGuide()!.steps; track $index) { <li [innerHTML]="step.key | translate: step.params"></li> }
              </ol>
              <a class="guide-link" [href]="installGuide()!.link" target="_blank" rel="noopener">
                <iconify-icon icon="solar:link-round-bold" width="12"></iconify-icon> {{ 'FCC_SETUP.Open website' | translate: { name: selectedProviderName() } }} <iconify-icon icon="solar:arrow-right-up-bold" width="10"></iconify-icon>
              </a>
            </details>
          }

          @if (selectedProvider()) {
            <h4 class="models-title"><iconify-icon icon="solar:cpu-bolt-bold-duotone" width="14"></iconify-icon> {{ 'FCC_SETUP.Step choose' | translate }}</h4>
            @if (modelsByTier().length === 0) {
              <!-- Cloud providers: lineups change too often to suggest ids. -->
              <p class="field-hint">{{ 'FCC_SETUP.Model id hint' | translate: { name: selectedProviderName() } }}</p>
            }
            <div class="tier-sections">
              @for (section of modelsByTier(); track section.tier) {
                <div class="tier-section">
                  <div class="tier-label" [style.color]="section.color">
                    <iconify-icon [icon]="section.icon" width="14"></iconify-icon>
                    <strong>{{ section.label | translate }}</strong>
                    <span class="tier-desc">{{ section.desc | translate }}</span>
                  </div>
                  <div class="model-row">
                    @for (m of section.models; track m.id) {
                      <button class="model-btn"
                        [class.selected]="selectedModel() === m.id"
                        [class.recommended]="m.recommended"
                        (click)="selectModel(m.id)">
                        <span class="model-name">{{ shortModelName(m.id) }}</span>
                        <span class="model-meta">{{ m.ram }}</span>
                        @if (m.recommended) { <span class="rec-badge">{{ 'FCC_SETUP.Recommended' | translate }}</span> }
                        @if (m.label && !m.recommended) { <span class="model-label">{{ ('FCC_SETUP.MODEL_LABEL.' + m.label) | translate }}</span> }
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <input type="text" class="form-input" [placeholder]="'FCC_SETUP.Custom model placeholder' | translate" [value]="selectedModel()" (input)="selectedModel.set($any($event.target).value)" />
          }
        }
        </div>
        }
      </section>

      <!-- ═══════════ STEP 2 — CONNECT ═══════════ -->
      <section class="step-card" [class.open]="openStep() === 2">
        <button class="step-head" (click)="toggleStep(2)">
          <span class="step-badge">2</span>
          <div class="step-head-text">
            <h2>{{ 'FCC_SETUP.Step connect' | translate }}</h2>
            <p>{{ 'FCC_SETUP.Connect desc' | translate }}</p>
          </div>
          <iconify-icon class="chev" icon="solar:alt-arrow-down-bold" width="16"></iconify-icon>
        </button>
        @if (openStep() === 2) {
        <div class="step-body">
          @if (showConnectStep()) {
          <!-- Commands for the selected local model -->
          @if (selectedModelDetail(); as detail) {
            @if (detail.installCmd || detail.runCmd) {
              <div class="model-cmds-panel">
                <div class="cmds-header">
                  <iconify-icon icon="solar:file-terminal-bold-duotone" width="16"></iconify-icon>
                  <span>{{ 'FCC_SETUP.Set up' | translate }} <strong>{{ shortModelName(detail.id) }}</strong></span>
                </div>
                <div class="cmds-grid">
                  <div class="cmd-card">
                    <div class="cmd-step"><span class="cmd-num">1</span><span class="cmd-text">{{ 'FCC_SETUP.Download model' | translate }}</span></div>
                    <div class="cmd-block">
                      <code>{{ detail.installCmd }}</code>
                      <button class="cmd-copy" (click)="copyCmd(detail.installCmd!, $event)" [title]="'FCC_SETUP.Copy' | translate" [attr.aria-label]="'FCC_SETUP.Copy' | translate"><iconify-icon icon="solar:copy-bold" width="12"></iconify-icon></button>
                    </div>
                  </div>
                  <div class="cmd-card">
                    <div class="cmd-step"><span class="cmd-num">2</span><span class="cmd-text">{{ 'FCC_SETUP.Run model' | translate }}</span></div>
                    <div class="cmd-block">
                      <code>{{ detail.runCmd }}</code>
                      <button class="cmd-copy" (click)="copyCmd(detail.runCmd!, $event)" [title]="'FCC_SETUP.Copy' | translate" [attr.aria-label]="'FCC_SETUP.Copy' | translate"><iconify-icon icon="solar:copy-bold" width="12"></iconify-icon></button>
                    </div>
                  </div>
                  <div class="cmd-card cmd-card-last">
                    <div class="cmd-step"><span class="cmd-num">3</span><span class="cmd-text">{{ 'FCC_SETUP.Continue' | translate }}</span></div>
                  </div>
                </div>
              </div>
            }
          }

          <!-- API key (cloud providers) -->
          @if (needsApiKey()) {
            <div class="field-group">
              <label class="field-lbl">{{ 'FCC_SETUP.API key' | translate }}</label>
              <input type="password" class="form-input" [placeholder]="'FCC_SETUP.Key placeholder' | translate" [value]="apiKey()" (input)="apiKey.set($any($event.target).value)" />
              <span class="field-hint">{{ 'FCC_SETUP.Key hint' | translate }}</span>
            </div>
          }
          } @else {
            <div class="step-note">
              <iconify-icon icon="solar:check-circle-bold" width="15"></iconify-icon>
              @if (step1Done()) { {{ 'FCC_SETUP.Nothing to set up' | translate }} } @else { {{ 'FCC_SETUP.Pick first' | translate }} }
            </div>
          }
        </div>
        }
      </section>

      <!-- ═══════════ STEP 3 — SAVE & TEST ═══════════ -->
      <section class="step-card" [class.open]="openStep() === 3">
        <button class="step-head" (click)="toggleStep(3)">
          <span class="step-badge" [class.done]="configured()">@if (configured()) { <iconify-icon icon="solar:check-bold" width="14"></iconify-icon> } @else { 3 }</span>
          <div class="step-head-text">
            <h2>{{ 'FCC_SETUP.Step save' | translate }}</h2>
            <p>{{ 'FCC_SETUP.Save desc' | translate }}</p>
          </div>
          @if (configured()) {
            @if (pingOk()) { <span class="step-summary sum-ok"><iconify-icon icon="solar:check-circle-bold" width="13"></iconify-icon> {{ 'FCC_SETUP.Connected' | translate }}</span> }
            @else { <span class="step-summary sum-muted">{{ 'FCC_SETUP.Saved' | translate }}</span> }
          }
          <iconify-icon class="chev" icon="solar:alt-arrow-down-bold" width="16"></iconify-icon>
        </button>
        @if (openStep() === 3) {
        <div class="step-body">
          @if (!step1Done()) {
            <div class="step-note">
              <iconify-icon icon="solar:info-circle-bold" width="15"></iconify-icon>
              {{ 'FCC_SETUP.Pick first' | translate }}
            </div>
          } @else {

          <!-- Advanced base URL (preset only) -->
          @if (activeTab() !== 'custom' && selectedProvider()) {
            <details class="advanced-box">
              <summary>{{ 'FCC_SETUP.Advanced' | translate }}</summary>
              <label class="field-lbl">{{ 'FCC_SETUP.Base URL' | translate }}</label>
              <input type="text" class="form-input" [value]="baseUrl()" (input)="baseUrl.set($any($event.target).value)" />
            </details>
          }

          <!-- Actions -->
          @if (activeTab() === 'custom') {
            <div class="action-bar">
              <button class="btn-action btn-outline" (click)="testCustom()" [disabled]="testing()">
                @if (testing()) { <iconify-icon icon="solar:refresh-bold" width="14" class="spin"></iconify-icon> }
                @else { <iconify-icon icon="solar:plug-circle-bold" width="14"></iconify-icon> }
                {{ 'FCC_SETUP.Test connection' | translate }}
              </button>
              <button class="btn-action btn-primary" (click)="saveCustom()" [disabled]="saving()">
                <iconify-icon icon="solar:diskette-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Save configuration' | translate }}
              </button>
            </div>
          } @else {
            <div class="action-bar">
              <button class="btn-action btn-outline" (click)="testConnection()" [disabled]="testing()">
                @if (testing()) { <iconify-icon icon="solar:refresh-bold" width="14" class="spin"></iconify-icon> }
                @else { <iconify-icon icon="solar:plug-circle-bold" width="14"></iconify-icon> }
                {{ 'FCC_SETUP.Test connection' | translate }}
              </button>
              <button class="btn-action btn-primary" (click)="save()" [disabled]="saving()">
                <iconify-icon icon="solar:diskette-bold" width="14"></iconify-icon> {{ 'FCC_SETUP.Save configuration' | translate }}
              </button>
            </div>
          }

          @if (testResult()) {
            <div class="result-msg" [class.ok]="testOk()" [class.fail]="!testOk()">
              <iconify-icon [icon]="testOk() ? 'solar:check-circle-bold' : 'solar:danger-triangle-bold'" width="15"></iconify-icon> {{ testResult() }}
            </div>
          }
          @if (saveResult()) {
            <div class="result-msg ok"><iconify-icon icon="solar:check-circle-bold" width="15"></iconify-icon> {{ saveResult() }}</div>
          }

          <!-- Open a live CLI session -->
          @if (configured()) {
            <div class="test-cli-box">
              <p>{{ 'FCC_SETUP.Test cli' | translate }}</p>
              <button class="btn-action btn-purple" (click)="openTestSession()">
                <iconify-icon icon="solar:file-terminal-bold" width="15"></iconify-icon> {{ 'FCC_SETUP.Open session' | translate }}
              </button>
            </div>
          }
          }
        </div>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .setup-page { padding: 20px; display: flex; flex-direction: column; gap: 16px; }

    /* ── Hero ── */
    .hero {
      padding: 22px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(99,102,241,.07), rgba(168,85,247,.04), rgba(236,72,153,.03));
      border: 1px solid rgba(99,102,241,.15);
    }
    .hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; align-items: start; }
    @media (max-width: 880px) { .hero-grid { grid-template-columns: 1fr; } }
    .hero-left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .hero-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero-badge {
      width: 36px; height: 36px; border-radius: 9px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .hero-title { margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -.02em; }
    .hero-accent { background: linear-gradient(135deg, #6366f1, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero-subtitle { margin: 0; font-size: 13px; line-height: 1.5; color: var(--bs-secondary-color, #6c757d); }

    .hero-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .hchip {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11.5px; font-weight: 600;
      padding: 4px 10px; border-radius: 999px;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, rgba(0,0,0,.08));
    }
    .hchip iconify-icon { color: #6366f1; }

    .why-box { font-size: 12.5px; }
    .why-box summary {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      font-size: 12px; font-weight: 700; color: #6366f1; width: fit-content;
    }
    .why-box[open] summary { margin-bottom: 12px; }
    .features-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (max-width: 480px) { .features-grid { grid-template-columns: 1fr; } }
    .feature-card {
      padding: 12px; border-radius: 10px;
      background: var(--bs-body-bg, rgba(255,255,255,.6));
      border: 1px solid var(--bs-border-color, rgba(0,0,0,.06));
      display: flex; flex-direction: column; gap: 6px;
    }
    .feature-icon { width: 30px; height: 30px; border-radius: 8px; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .feature-card h4 { margin: 0; font-size: 12.5px; font-weight: 700; }
    .feature-card p { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--bs-secondary-color, #6c757d); }

    /* ── macOS terminal window ── */
    .term-window {
      border-radius: 11px; overflow: hidden;
      border: 1px solid rgba(0,0,0,.35);
      background: #1e1e2e;
      box-shadow: 0 12px 30px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.2);
    }
    .term-bar {
      display: flex; align-items: center; gap: 7px;
      padding: 9px 12px; background: #2a2a3c;
      border-bottom: 1px solid rgba(0,0,0,.3); position: relative;
    }
    .term-dot { width: 11px; height: 11px; border-radius: 999px; display: inline-block; }
    .term-dot.red { background: #ff5f57; }
    .term-dot.yellow { background: #febc2e; }
    .term-dot.green { background: #28c840; }
    .term-title {
      position: absolute; left: 0; right: 0; text-align: center;
      font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,.55);
      font-family: 'SF Mono', 'Fira Code', monospace; pointer-events: none;
    }
    .term-body { background: #181825; line-height: 0; }
    .term-body img { display: block; width: 100%; height: auto; }

    /* ── Step rail ── */
    .step-rail { display: flex; align-items: center; gap: 4px; padding: 2px 4px; }
    .step-node {
      display: flex; align-items: center; gap: 7px; opacity: .5; transition: opacity .15s;
      border: none; background: transparent; padding: 4px 6px; border-radius: 8px;
      font: inherit; color: inherit; cursor: pointer;
    }
    .step-node:hover { opacity: .85; background: var(--bs-tertiary-bg, rgba(99,102,241,.05)); }
    .step-node.active { opacity: 1; }
    .step-node.done { opacity: 1; }
    .step-dot {
      width: 24px; height: 24px; border-radius: 999px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800;
      background: var(--bs-tertiary-bg, #eef0f5); color: var(--bs-secondary-color, #64748b);
      border: 1.5px solid var(--bs-border-color, rgba(0,0,0,.1));
    }
    .step-node.active .step-dot { background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; border-color: transparent; }
    .step-node.done .step-dot { background: linear-gradient(135deg, #10b981, #34d399); color: #fff; border-color: transparent; }
    .step-lbl { font-size: 12px; font-weight: 700; }
    .step-line { flex: 1; height: 1.5px; background: var(--bs-border-color, rgba(0,0,0,.1)); min-width: 12px; }

    /* ── Step cards (accordion) ── */
    .step-card {
      display: flex; flex-direction: column;
      border-radius: 12px; overflow: hidden;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, rgba(0,0,0,.08));
      transition: border-color .15s, box-shadow .15s;
    }
    .step-card.open { border-color: rgba(99,102,241,.35); box-shadow: 0 0 0 2px rgba(99,102,241,.08); }
    .step-head {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 15px 18px; border: none; background: transparent;
      font: inherit; color: inherit; text-align: left; cursor: pointer; transition: background .12s;
    }
    .step-head:hover { background: var(--bs-tertiary-bg, rgba(99,102,241,.03)); }
    .step-badge {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff;
      font-size: 14px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
    }
    .step-badge.done { background: linear-gradient(135deg, #10b981, #34d399); }
    .step-head-text { flex: 1; min-width: 0; }
    .step-head-text h2 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
    .step-head-text p { margin: 1px 0 0; font-size: 12px; color: var(--bs-secondary-color, #6c757d); }
    .step-summary { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; white-space: nowrap; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
    .step-summary.sum-ok { color: #059669; }
    .step-summary.sum-muted { color: var(--bs-secondary-color, #6c757d); }
    .chev { margin-left: 8px; color: var(--bs-secondary-color, #94a3b8); flex-shrink: 0; transition: transform .18s; }
    .step-card.open .chev { transform: rotate(180deg); }
    .step-body { display: flex; flex-direction: column; gap: 14px; padding: 2px 18px 18px; }
    .step-note { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--bs-secondary-color, #6c757d); padding: 12px 14px; border-radius: 8px; background: var(--bs-tertiary-bg, rgba(0,0,0,.02)); border: 1px dashed var(--bs-border-color, rgba(0,0,0,.1)); }
    .step-note iconify-icon { color: #10b981; flex-shrink: 0; }

    .badge-status { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; flex-shrink: 0; }
    .badge-status.ok { background: rgba(16,185,129,.15); color: #059669; }
    .badge-status.pending { background: rgba(245,158,11,.15); color: #d97706; }
    .badge-status.fail { background: rgba(239,68,68,.12); color: #dc2626; }
    .badge-status.pinging { background: rgba(99,102,241,.12); color: #6366f1; }
    .btn-retry {
      display: flex; align-items: center; gap: 4px; font: inherit; font-size: 11px; font-weight: 700;
      padding: 3px 10px; border-radius: 6px; cursor: pointer;
      border: 1.5px solid rgba(99,102,241,.3); background: transparent; color: #6366f1; transition: all .12s;
    }
    .btn-retry:hover { background: rgba(99,102,241,.08); }

    /* ── Tabs ── */
    .tab-bar { display: flex; gap: 4px; padding: 4px; background: var(--bs-tertiary-bg, #f1f5f9); border-radius: 10px; }
    .tab {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
      font: inherit; font-size: 12.5px; font-weight: 600;
      padding: 10px 12px; border-radius: 8px; border: none; cursor: pointer;
      background: transparent; color: var(--bs-secondary-color, #64748b); transition: all .15s;
    }
    .tab:hover { background: var(--bs-body-bg, #fff); color: var(--bs-body-color); }
    .tab.active { background: var(--bs-body-bg, #fff); color: #6366f1; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    /* ── Provider row ── */
    .provider-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .prov-btn {
      display: flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 600;
      padding: 8px 14px; border-radius: 8px; cursor: pointer;
      background: var(--bs-body-bg, #fff); border: 1.5px solid var(--bs-border-color, rgba(0,0,0,.08));
      color: inherit; transition: all .12s;
    }
    .prov-btn:hover { border-color: rgba(99,102,241,.4); }
    .prov-btn.selected { border-color: #6366f1; background: linear-gradient(135deg, rgba(99,102,241,.06), rgba(168,85,247,.06)); box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
    .prov-free { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(16,185,129,.15); color: #059669; }
    .prov-chk { color: #6366f1; }

    /* ── Guide ── */
    .guide-box { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--bs-border-color, rgba(0,0,0,.08)); background: var(--bs-tertiary-bg, rgba(255,255,255,.02)); }
    .guide-box summary { font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .guide-box[open] { display: flex; flex-direction: column; gap: 8px; }
    .guide-steps { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.6; display: flex; flex-direction: column; gap: 4px; }
    .guide-steps li::marker { color: #6366f1; font-weight: 700; }
    .guide-steps code { background: rgba(99,102,241,.1); color: #6366f1; padding: 1px 6px; border-radius: 4px; font-size: 11.5px; font-family: 'SF Mono','Fira Code',monospace; }
    .guide-link { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: #6366f1; text-decoration: none; }
    .guide-link:hover { text-decoration: underline; }

    /* ── Models by tier ── */
    .models-title { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; margin: 6px 0 0; }
    .tier-sections { display: flex; flex-direction: column; gap: 12px; }
    .tier-section { display: flex; flex-direction: column; gap: 6px; }
    .tier-label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .tier-desc { font-weight: 400; color: var(--bs-secondary-color, #6c757d); }
    .model-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .model-btn {
      display: flex; flex-direction: column; gap: 2px; font: inherit; text-align: left; width: 100%;
      padding: 8px 12px; border-radius: 8px; cursor: pointer;
      background: var(--bs-body-bg, #fff); border: 1.5px solid var(--bs-border-color, rgba(0,0,0,.08));
      color: inherit; transition: all .12s; position: relative; box-sizing: border-box;
    }
    .model-btn:hover { border-color: rgba(99,102,241,.35); }
    .model-btn.selected { border-color: #6366f1; background: linear-gradient(135deg, rgba(99,102,241,.06), rgba(168,85,247,.06)); box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
    .model-btn.recommended { border-color: rgba(99,102,241,.3); }
    .model-name { font-size: 12.5px; font-weight: 700; }
    .model-meta { font-size: 11px; color: var(--bs-secondary-color, #64748b); }
    .model-label { font-size: 10px; color: var(--bs-secondary-color, #64748b); font-style: italic; }
    .rec-badge { position: absolute; top: -6px; right: 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; }

    /* ── Commands panel ── */
    .model-cmds-panel { padding: 16px 18px; border-radius: 10px; border: 1.5px solid rgba(99,102,241,.2); background: linear-gradient(135deg, rgba(99,102,241,.04), rgba(168,85,247,.02)); }
    .cmds-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; margin-bottom: 14px; color: #6366f1; }
    .cmds-header strong { color: var(--bs-body-color); }
    .cmds-grid { display: grid; grid-template-columns: 1fr 1fr auto; gap: 14px; align-items: start; }
    @media (max-width: 640px) { .cmds-grid { grid-template-columns: 1fr; } }
    .cmd-card { display: flex; flex-direction: column; gap: 6px; }
    .cmd-card-last { justify-content: center; }
    .cmd-step { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
    .cmd-num { width: 18px; height: 18px; border-radius: 999px; background: #6366f1; color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .cmd-text { color: var(--bs-body-color); }
    .cmd-text b { color: #6366f1; }
    .cmd-block { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; background: rgba(15, 23, 42, .06); border: 1px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    .cmd-block code { flex: 1; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 12.5px; font-weight: 600; color: #6366f1; user-select: all; cursor: text; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmd-copy { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; border: none; background: transparent; color: var(--bs-secondary-color); cursor: pointer; transition: all .12s; flex-shrink: 0; }
    .cmd-copy:hover { background: rgba(99,102,241,.12); color: #6366f1; }

    /* ── Forms ── */
    .form-input { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1.5px solid var(--bs-border-color, rgba(0,0,0,.12)); background: var(--bs-body-bg, #fff); color: var(--bs-body-color); font: inherit; font-size: 13px; transition: border-color .12s; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.12); }
    .field-group { display: flex; flex-direction: column; gap: 4px; }
    .field-lbl { font-size: 12px; font-weight: 700; }
    .field-hint { font-size: 11px; color: var(--bs-secondary-color, #6c757d); }
    .advanced-box { padding: 10px; border-radius: 8px; border: 1px solid var(--bs-border-color); }
    .advanced-box summary { font-size: 12px; font-weight: 600; cursor: pointer; color: var(--bs-secondary-color); }
    .advanced-box[open] { display: flex; flex-direction: column; gap: 8px; }

    /* ── Actions ── */
    .action-bar { display: flex; gap: 8px; }
    .btn-action { display: flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 700; padding: 9px 18px; border-radius: 8px; cursor: pointer; border: none; transition: opacity .12s; }
    .btn-outline { background: var(--bs-tertiary-bg, #f1f5f9); color: var(--bs-body-color); border: 1.5px solid var(--bs-border-color); }
    .btn-primary { background: linear-gradient(135deg, #10b981, #34d399); color: #fff; }
    .btn-purple { background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; }
    .btn-action:disabled { opacity: .5; cursor: not-allowed; }
    .btn-action:hover:not(:disabled) { opacity: .9; }
    .result-msg { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; }
    .result-msg.ok { background: rgba(16,185,129,.1); color: #059669; }
    .result-msg.fail { background: rgba(239,68,68,.1); color: #dc2626; }

    .test-cli-box { padding: 16px; border-radius: 10px; background: linear-gradient(135deg, rgba(99,102,241,.06), rgba(168,85,247,.04)); border: 1px solid rgba(99,102,241,.18); display: flex; flex-direction: column; gap: 10px; }
    .test-cli-box p { margin: 0; font-size: 12.5px; line-height: 1.5; }
    .test-cli-box b { color: #6366f1; }

    /* ── Custom tab ── */
    .custom-intro { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 10px; background: linear-gradient(135deg, rgba(99,102,241,.06), rgba(168,85,247,.04)); border: 1px solid rgba(99,102,241,.18); }
    .custom-intro p { margin: 4px 0 0; font-size: 12.5px; color: var(--bs-secondary-color, #6c757d); line-height: 1.5; }
    .custom-form { display: flex; flex-direction: column; gap: 12px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 540px) { .field-row { grid-template-columns: 1fr; } }
    .field-flex { flex: 1; }
    .field-req { color: #ef4444; }
    .field-opt { font-weight: 400; color: var(--bs-secondary-color, #6c757d); }

    /* ── Hardware scan ── */
    .scan-card { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px; border-radius: 12px; background: linear-gradient(135deg, rgba(99,102,241,.06), rgba(168,85,247,.035)); border: 1px solid rgba(99,102,241,.2); }
    .scan-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .scan-icon { width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; display: flex; align-items: center; justify-content: center; }
    .scan-head-text { flex: 1; min-width: 220px; }
    .scan-head-text h3 { margin: 0; font-size: 14px; font-weight: 800; letter-spacing: -.01em; }
    .scan-head-text p { margin: 2px 0 0; font-size: 12px; color: var(--bs-secondary-color, #6c757d); line-height: 1.45; }
    .scan-btn { flex-shrink: 0; }
    .scan-loading { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #6366f1; padding: 14px; border-radius: 10px; background: rgba(99,102,241,.06); border: 1px dashed rgba(99,102,241,.25); }
    .scan-empty { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--bs-secondary-color, #6c757d); padding: 16px; border-radius: 10px; background: var(--bs-body-bg, rgba(255,255,255,.4)); border: 1px dashed var(--bs-border-color, rgba(0,0,0,.1)); }
    .scan-empty iconify-icon { color: #a855f7; flex-shrink: 0; }
    .hw-summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .hw-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 999px; background: var(--bs-body-bg, #fff); border: 1px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    .hw-chip iconify-icon { color: #6366f1; }
    .hw-warn { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #d97706; background: rgba(245,158,11,.1); padding: 6px 10px; border-radius: 8px; }
    .rec-note { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #059669; background: rgba(16,185,129,.08); padding: 7px 12px; border-radius: 8px; }
    .rec-note b { color: #047857; }
    .rec-list { display: flex; flex-direction: column; gap: 10px; }
    .rec-card { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: 10px; background: var(--bs-body-bg, #fff); border: 1.5px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    .rec-card.rec-top { border-color: rgba(99,102,241,.45); box-shadow: 0 0 0 2px rgba(99,102,241,.12); }
    .rec-top-row { display: flex; align-items: center; gap: 10px; }
    .rec-rank { width: 24px; height: 24px; border-radius: 999px; flex-shrink: 0; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .rec-name-block { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .rec-name { font-size: 13.5px; font-weight: 700; }
    .rec-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .rec-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; padding: 1px 6px; border-radius: 4px; background: rgba(99,102,241,.1); color: #6366f1; }
    .rec-compat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; flex-shrink: 0; }
    .rec-compat strong { font-size: 15px; font-weight: 800; }
    .rec-compat span { font-size: 10px; font-weight: 600; }
    .rec-meta-row { display: flex; flex-wrap: wrap; gap: 12px; }
    .rec-meta { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--bs-secondary-color, #64748b); }
    .rec-meta iconify-icon { color: #6366f1; }
    .rec-reasons { margin: 0; padding-left: 16px; font-size: 11.5px; line-height: 1.55; color: var(--bs-secondary-color, #6c757d); display: flex; flex-direction: column; gap: 2px; }
    .rec-reasons li::marker { color: #a855f7; }
    .rec-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rec-setup { flex: 1; min-width: 180px; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 8px; background: rgba(15,23,42,.06); border: 1px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    .rec-setup code { flex: 1; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 12px; font-weight: 600; color: #6366f1; user-select: all; cursor: text; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-use {
      display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
      font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
      padding: 8px 14px; border-radius: 8px; border: none;
      background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; transition: opacity .12s;
    }
    .btn-use:hover { opacity: .9; }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class FccSetupComponent implements OnInit {
  private translate = inject(TranslateService);
  private t(key: string, params?: Record<string, unknown>): string { return this.translate.instant(key, params); }
  private catalog = signal<ProviderEntry[]>([]);
  activeTab = signal<string>('local');

  selectedProvider = signal<string>('');
  selectedModel = signal<string>('');
  apiKey = signal<string>('');
  baseUrl = signal<string>('');
  needsApiKey = signal(false);
  availableModels = signal<string[]>([]);
  configured = signal(false);

  testing = signal(false);
  saving = signal(false);
  testResult = signal('');
  testOk = signal(false);
  saveResult = signal('');

  // Ping status
  pinging = signal(false);
  pingOk = signal(false);

  // Custom tab
  customBaseUrl = signal('http://localhost:11434/v1');
  customModel = signal('');
  customApiKey = signal('');
  customProviderLabel = signal('custom');

  // Hardware scan
  scanning = signal(false);
  scanError = signal('');
  scanResult = signal<ScanResult | null>(null);

  // Accordion: which step is expanded (0 = all collapsed).
  openStep = signal(1);

  providersForTab = computed(() => this.catalog().filter(p => p.tier === this.activeTab()));

  installGuide = computed(() => {
    const id = this.selectedProvider();
    return id ? (INSTALL_GUIDES[id] ?? null) : null;
  });

  selectedProviderName = computed(() => {
    const id = this.selectedProvider();
    return this.catalog().find(p => p.id === id)?.name ?? id;
  });

  selectedModelDetail = computed(() => {
    const id = this.selectedProvider();
    const modelId = this.selectedModel();
    const prov = this.catalog().find(p => p.id === id);
    return prov?.modelDetails?.find(m => m.id === modelId) ?? null;
  });

  modelsByTier = computed(() => {
    const id = this.selectedProvider();
    const prov = this.catalog().find(p => p.id === id);
    if (!prov?.modelDetails?.length) return [];

    const tiers: Array<{ tier: string; label: string; icon: string; color: string; desc: string; models: ModelDetail[] }> = [];
    for (const t of ['low', 'medium', 'high'] as const) {
      const models = prov.modelDetails.filter(m => m.tier === t);
      if (models.length > 0) {
        const meta = TIER_META[t];
        tiers.push({ tier: t, ...meta, models });
      }
    }
    return tiers;
  });

  // Step 1 is "done" once a model is chosen (preset or custom).
  step1Done = computed(() =>
    this.activeTab() === 'custom' ? !!this.customModel() : !!this.selectedModel(),
  );

  // Short label of the currently chosen model, for collapsed step summaries.
  currentModelLabel = computed(() =>
    this.activeTab() === 'custom' ? this.customModel() : this.shortModelName(this.selectedModel()),
  );

  // Step 2 (Connect) only matters for presets that need an API key or have
  // install/run commands for the selected model.
  showConnectStep = computed(() => {
    if (this.activeTab() === 'custom') return false;
    if (!this.selectedProvider() || !this.selectedModel()) return false;
    const d = this.selectedModelDetail();
    return this.needsApiKey() || !!(d && (d.installCmd || d.runCmd));
  });

  async ngOnInit(): Promise<void> {
    const api = (window as any).promptops;
    if (!api) return;

    if (api.getFccCatalog) {
      const res = await api.getFccCatalog();
      if (res?.ok) this.catalog.set(res.data);
    }

    if (api.getFccConfig) {
      const res = await api.getFccConfig();
      if (res?.ok && res.data) {
        this.configured.set(res.data.configured ?? false);
        if (res.data.provider) {
          const entry = this.catalog().find(p => p.id === res.data.provider);
          if (entry) {
            this.selectedProvider.set(res.data.provider);
            this.selectedModel.set(res.data.model ?? '');
            this.apiKey.set(res.data.apiKey ?? '');
            this.baseUrl.set(res.data.baseUrl ?? '');
            this.needsApiKey.set(entry.requiresApiKey);
            this.activeTab.set(entry.tier);
          } else {
            this.customProviderLabel.set(res.data.provider);
            this.customModel.set(res.data.model ?? '');
            this.customApiKey.set(res.data.apiKey ?? '');
            this.customBaseUrl.set(res.data.baseUrl ?? 'http://localhost:11434/v1');
            this.activeTab.set('custom');
          }
        }
      }
    }

    // Returning users land on the final step (save/test/open session).
    if (this.configured()) {
      this.openStep.set(3);
      void this.pingProvider();
    }
  }

  /** Accordion toggle — open a step (or collapse it if already open). */
  toggleStep(n: number): void {
    this.openStep.set(this.openStep() === n ? 0 : n);
  }

  /** Pick a model and advance to the next relevant step. */
  selectModel(id: string): void {
    this.selectedModel.set(id);
    this.testResult.set('');
    this.saveResult.set('');
    this.openStep.set(this.showConnectStep() ? 2 : 3);
  }

  async pingProvider(): Promise<void> {
    if (!this.configured()) { this.pingOk.set(false); return; }
    const api = (window as any).promptops;
    if (!api?.testFccConnection) { this.pingOk.set(false); return; }
    this.pinging.set(true);
    try {
      const res = await api.testFccConnection();
      this.pingOk.set(res?.ok ?? false);
    } catch {
      this.pingOk.set(false);
    } finally {
      this.pinging.set(false);
    }
  }

  // ── Hardware scan ─────────────────────────────────────────────
  async scanHardware(): Promise<void> {
    const api = (window as any).promptops;
    if (!api?.scanHardwareForModels) {
      this.scanError.set(this.t('FCC_SETUP.Scan desktop only'));
      return;
    }
    this.scanning.set(true);
    this.scanError.set('');
    try {
      const res = await api.scanHardwareForModels({ limit: 6 });
      if (res?.ok && res.data) {
        this.scanResult.set(res.data as ScanResult);
      } else {
        this.scanError.set(res?.error || this.t('FCC_SETUP.Scan failed'));
      }
    } catch (err: any) {
      // A "No handler registered" rejection means the desktop app needs a
      // restart to pick up the new scan handler (renderer reloaded, main process
      // did not). Surface that clearly instead of blaming local permissions.
      const msg = String(err?.message || err || '');
      if (/no handler registered/i.test(msg)) {
        this.scanError.set(this.t('FCC_SETUP.Scan restart'));
      } else {
        this.scanError.set(this.t('FCC_SETUP.Scan failed'));
      }
    } finally {
      this.scanning.set(false);
    }
  }

  /** Pre-fill the picker from a scan suggestion (Ollama tag → local/ollama provider). */
  useRecommendation(rec: ScanRecommendation): void {
    const ollama = this.catalog().find(p => p.id === 'ollama');
    if (ollama) {
      this.activeTab.set('local');
      this.selectProvider(ollama);
    }
    // The recommendation id is an Ollama-style tag (e.g. "qwen2.5-coder:14b").
    this.selectedModel.set(rec.id);
    this.testResult.set('');
    this.saveResult.set('');
    this.openStep.set(this.showConnectStep() ? 2 : 3);
  }

  gb(mb: number): number {
    return Math.round((mb / 1024) * 10) / 10;
  }

  gpuLabel(hw: ScanHardwareProfile): string {
    const gpu = hw.gpus?.[0];
    if (!gpu) return this.t('FCC_SETUP.CPU only');
    if (gpu.unifiedMemory) return this.t('FCC_SETUP.Unified', { model: gpu.model });
    if (gpu.vramMb > 0) return `${gpu.model} · ${this.gb(gpu.vramMb)} GB VRAM`;
    return gpu.model;
  }

  fitLabel(fit: 'gpu' | 'partial' | 'cpu'): string {
    return this.t(fit === 'gpu' ? 'FCC_SETUP.Full GPU' : fit === 'partial' ? 'FCC_SETUP.Partial' : 'FCC_SETUP.CPU only');
  }

  compatColor(score: number): string {
    if (score >= 80) return '#059669';
    if (score >= 60) return '#6366f1';
    if (score >= 38) return '#d97706';
    return '#dc2626';
  }

  copyCmd(cmd: string, event: Event): void {
    event.stopPropagation();
    navigator.clipboard.writeText(cmd).then(() => {
      const btn = event.currentTarget as HTMLElement;
      btn.innerHTML = '<iconify-icon icon="solar:check-bold" width="12"></iconify-icon>';
      setTimeout(() => { btn.innerHTML = '<iconify-icon icon="solar:copy-bold" width="12"></iconify-icon>'; }, 1500);
    });
  }

  selectProvider(p: ProviderEntry): void {
    this.selectedProvider.set(p.id);
    this.selectedModel.set(p.defaultModel);
    this.baseUrl.set(p.defaultBaseUrl);
    this.needsApiKey.set(p.requiresApiKey);
    this.testResult.set('');
    this.saveResult.set('');
    if (!p.requiresApiKey) this.apiKey.set('');
  }

  shortModelName(id: string): string {
    const parts = id.split('/');
    return parts[parts.length - 1].replace(':free', ` (${this.t('FCC_SETUP.Free suffix')})`);
  }

  async testConnection(): Promise<void> {
    const api = (window as any).promptops;
    if (!api?.testFccConnection) return;
    this.testing.set(true);
    this.testResult.set('');
    try {
      await this.saveInternal();
      const res = await api.testFccConnection();
      this.testOk.set(res.ok);
      this.testResult.set(res.ok ? res.message : res.error);
    } catch (err) { this.testOk.set(false); this.testResult.set(this.failure(err, this.t('FCC_SETUP.Test failed'))); }
    finally { this.testing.set(false); }
  }

  /** The error the native side gave, or a generic one. */
  private failure(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.saveResult.set('');
    try {
      await this.saveInternal();
      this.configured.set(true);
      this.saveResult.set(this.t('FCC_SETUP.Configuration saved'));
      void this.pingProvider();
    } catch (err) {
      // Never report "saved" for a save that failed (e.g. the encrypted store
      // holding the API key is not available).
      this.testOk.set(false);
      this.testResult.set(this.failure(err, this.t('FCC_SETUP.Not saved')));
    }
    finally { this.saving.set(false); }
  }

  async testCustom(): Promise<void> {
    this.testing.set(true);
    this.testResult.set('');
    try {
      if (!(await this.saveCustom())) return;
      const api = (window as any).promptops;
      if (api?.testFccConnection) {
        const res = await api.testFccConnection();
        this.testOk.set(res.ok);
        this.testResult.set(res.ok ? res.message : res.error);
      }
    } catch (err) {
      this.testOk.set(false);
      this.testResult.set(this.failure(err, this.t('FCC_SETUP.Test failed')));
    } finally {
      this.testing.set(false);
    }
  }

  /** true once the configuration is really stored. */
  async saveCustom(): Promise<boolean> {
    this.saving.set(true);
    this.saveResult.set('');
    try {
      await this.persist({
        provider: this.customProviderLabel() || 'custom',
        model: this.customModel(),
        apiKey: this.customApiKey() || undefined,
        baseUrl: this.customBaseUrl() || undefined,
        configured: true,
      });
      this.configured.set(true);
      this.saveResult.set(this.t('FCC_SETUP.Configuration saved'));
      void this.pingProvider();
      return true;
    } catch (err) {
      this.testOk.set(false);
      this.testResult.set(this.failure(err, this.t('FCC_SETUP.Not saved')));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Saves through the desktop bridge; throws when it is missing or refuses. */
  private async persist(config: Record<string, unknown>): Promise<void> {
    const api = (window as any).promptops;
    if (!api?.saveFccConfig) throw new Error(this.t('FCC_SETUP.Desktop only save'));
    const res = await api.saveFccConfig(config);
    if (res && res.ok === false) throw new Error(res.error || this.t('FCC_SETUP.Not saved'));
  }

  private router = inject(Router);

  async openTestSession(): Promise<void> {
    const api = (window as any).promptops;
    if (!api?.createSession) return;
    await api.createSession({ name: 'PromptOps CLI Test', provider: 'promptops-cli', config: {} });
    this.router.navigate(['/admin/sessions']);
  }

  private async saveInternal(): Promise<void> {
    await this.persist({
      provider: this.selectedProvider(),
      model: this.selectedModel(),
      apiKey: this.apiKey() || undefined,
      baseUrl: this.baseUrl() || undefined,
      configured: true,
    });
  }
}
