import {
  AfterViewChecked,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { toPng } from 'html-to-image';
import { SwalService } from '@core/services/swal.service';
import { getSessions } from '@/store/sessions/session.selectors';
import { getWorkspaces } from '@/store/workspaces/workspace.selectors';
import { loadSessions } from '@/store/sessions/session.actions';
import { loadWorkspaces } from '@/store/workspaces/workspace.actions';
import { SessionSummary } from '@/store/sessions/session.state';
import { WorkspaceSummary } from '@/store/workspaces/workspace.state';
import {
  MAX_MODELS,
  SpeedTestBaselineVerdict,
  SpeedTestLiveState,
  SpeedTestModelResult,
  SpeedTestService,
} from './speed-test.service';

/**
 * Model Speed Test — full-screen comparison page (hdblog.it/compara style):
 * pick up to 3 models, run the harmless benchmark suite in a live terminal,
 * compare the metrics side by side with relative bars.
 */
@Component({
  selector: 'app-speed-test',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  templateUrl: './speed-test.component.html',
  styleUrl: './speed-test.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // <iconify-icon> web component
})
export class SpeedTestComponent implements OnInit, OnDestroy, AfterViewChecked {
  protected readonly svc = inject(SpeedTestService);
  protected readonly maxModels = MAX_MODELS;
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);
  /** SPEED_TEST.<key>, translated in the current language. */
  private tr(key: string, params?: Record<string, unknown>): string {
    return this.translateService.instant(`SPEED_TEST.${key}`, params);
  }
  private readonly store = inject(Store);

  @ViewChild('terminal') private terminal?: ElementRef<HTMLElement>;
  @ViewChild('shareSurface') private shareSurface?: ElementRef<HTMLElement>;

  protected readonly exporting = signal(false);
  protected readonly showLog = signal(false);

  // 1s renderer heartbeat: keeps the visible timer ticking smoothly between
  // IPC progress events (which can lag when a CLI buffers its output).
  private readonly nowTick = signal(Date.now());
  private tickerId: ReturnType<typeof setInterval> | null = null;

  // Codebase target for the read-only analysis round (same source as git-writer:
  // workspaces + sessions with a resolvable local path).
  protected readonly workspaces = signal<WorkspaceSummary[]>([]);
  protected readonly sessions = signal<SessionSummary[]>([]);
  protected selectedTargetKey: string | null = null;
  private readonly subs = new Subscription();

  protected readonly linkableSessions = computed(() =>
    this.sessions().filter((s) => this.sessionPath(s) !== null),
  );

  // Two families of metrics, deliberately separated:
  //  - MODEL SPEED: the mode-free CLI throughput probe (same prompt for all),
  //    reported as one representative median sample so tok/s ≡ tokens ÷ time.
  //  - WORK QUALITY: the read-only agent task on the codebase — accuracy plus
  //    the honest "agent task time" (which INCLUDES tool calls and CLI harness).
  // "Total wall time" is the one number that matches what the user watched.
  protected readonly metricRows: {
    key: string;
    label: string;
    hint: string;
    lowerIsBetter: boolean;
    graded?: boolean;
    /** Shown only when some result carries this data (task round, cost estimate). */
    needs?: 'task' | 'cost';
    value: (r: SpeedTestModelResult) => number;
    display: (r: SpeedTestModelResult) => string;
    title?: (r: SpeedTestModelResult) => string | null;
  }[] = [
    {
      key: 'tps', label: 'SPEED_TEST.Metric tps', hint: 'SPEED_TEST.Metric tps hint',
      lowerIsBetter: false,
      value: (r) => this.speedOf(r)?.tokensPerSec ?? 0,
      display: (r) => this.tpsDisplay(r),
      title: (r) => this.estimatedNote(r),
    },
    {
      key: 'accuracy', label: 'SPEED_TEST.Metric accuracy', hint: 'SPEED_TEST.Metric accuracy hint',
      lowerIsBetter: false, graded: true,
      value: (r) => r.accuracyPct,
      display: (r) => `${r.accuracyPct}%`,
    },
    {
      key: 'task', label: 'SPEED_TEST.Metric task', hint: 'SPEED_TEST.Metric task hint',
      lowerIsBetter: true, needs: 'task',
      value: (r) => this.taskOf(r)?.ok ? this.taskOf(r)!.totalMs : 0,
      display: (r) => this.taskOf(r)?.ok ? this.secs(this.taskOf(r)!.totalMs) : '—',
    },
    {
      key: 'wall', label: 'SPEED_TEST.Metric wall', hint: 'SPEED_TEST.Metric wall hint',
      lowerIsBetter: true,
      value: (r) => r.wallMs ?? 0,
      display: (r) => r.wallMs ? this.secs(r.wallMs) : '—',
    },
    {
      key: 'price', label: 'SPEED_TEST.Metric price', hint: 'SPEED_TEST.Metric price hint',
      lowerIsBetter: true, needs: 'cost',
      value: (r) => r.cost?.outputPerM ?? 0,
      display: (r) => r.cost ? this.tr('Price display', { out: r.cost.outputPerM, in: r.cost.inputPerM }) : '—',
      title: (r) => r.cost ? this.tr('Priced as', { label: r.cost.pricingLabel }) : null,
    },
    {
      key: 'runcost', label: 'SPEED_TEST.Metric runcost', hint: 'SPEED_TEST.Metric runcost hint',
      lowerIsBetter: true, needs: 'cost',
      value: (r) => r.cost?.estRunCostUsd ?? 0,
      display: (r) => r.cost ? `~${this.usd(r.cost.estRunCostUsd)}` : '—',
      title: (r) => r.cost
        ? this.tr('Run cost title', { out: r.cost.estOutputTokens.toLocaleString(), in: r.cost.estInputTokens.toLocaleString(), label: r.cost.pricingLabel })
        : null,
    },
  ];

  /** Small-money formatter: runs usually cost fractions of a cent. */
  private usd(v: number): string {
    if (v >= 0.1) return `$${v.toFixed(2)}`;
    if (v >= 0.001) return `$${v.toFixed(3)}`;
    return `$${v.toFixed(4)}`;
  }

  /** tok/s of the representative sample, "~"-prefixed when tokens are estimated. */
  private tpsDisplay(r: SpeedTestModelResult): string {
    const s = this.speedOf(r);
    if (!s?.ok) return '—';
    return `${s.tokensEstimated ? '~' : ''}${s.tokensPerSec} tok/s`;
  }

  protected estimatedNote(r: SpeedTestModelResult): string | null {
    return this.speedOf(r)?.tokensEstimated
      ? this.tr('Estimated note')
      : null;
  }

  protected speedOf(r: SpeedTestModelResult) {
    return r.rounds.find((x) => x.round === 'speed');
  }

  protected taskOf(r: SpeedTestModelResult) {
    return r.rounds.find((x) => x.round === 'analysis');
  }

  /** ms → friendly seconds, e.g. 7341 → "7.3s", 182000 → "3m 2s". */
  protected secs(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s - m * 60)}s`;
  }

  /** The run graded accuracy only if the analysis round carried questions. */
  protected readonly gradedRun = computed(() =>
    this.svc.results().some((r) =>
      r.rounds.some((x) => x.round === 'analysis' && (x.questionsTotal ?? 0) > 0),
    ),
  );

  /** True when some model ran the read-only agent task (not in this edition's speed-only runs). */
  protected readonly hasTaskRound = computed(() =>
    this.svc.results().some((r) => r.rounds.some((x) => x.round === 'analysis')),
  );

  protected readonly visibleMetricRows = computed(() => {
    const hasCost = this.svc.results().some((r) => !!r.cost);
    return this.metricRows.filter(
      (row) =>
        (!row.graded || this.gradedRun()) &&
        (row.needs !== 'task' || this.hasTaskRound()) &&
        (row.needs !== 'cost' || hasCost),
    );
  });

  // Per-axis leaders — NEVER a single overall "winner". Each axis names a
  // leader only when its lead clears run-to-run noise (10% for speed/time; at
  // least one more correct answer for accuracy); otherwise it is an honest tie.
  private axisLeader(
    metric: (r: SpeedTestModelResult) => number,
    higherIsBetter: boolean,
    decisive: (best: number, second: number) => boolean,
  ): { result: SpeedTestModelResult; decisive: boolean } | null {
    const rows = this.svc.results()
      .filter((r) => r.ok)
      .map((r) => ({ r, v: metric(r) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => (higherIsBetter ? b.v - a.v : a.v - b.v));
    if (rows.length === 0) return null;
    if (rows.length === 1) return { result: rows[0].r, decisive: false };
    return { result: rows[0].r, decisive: decisive(rows[0].v, rows[1].v) };
  }

  /** 🚀 Fastest model by clean API tokens/sec (median), 10% margin gate. */
  protected readonly speedLeader = computed(() =>
    this.axisLeader(
      (r) => this.speedOf(r)?.tokensPerSec ?? 0,
      true,
      (best, second) => second > 0 && (best - second) / second >= 0.1,
    ),
  );

  /** ⏱️ Quickest end-to-end agent task (includes CLI overhead), 10% gate. */
  protected readonly timeLeader = computed(() =>
    this.axisLeader(
      (r) => (this.taskOf(r)?.ok ? this.taskOf(r)!.totalMs : 0),
      false,
      (best, second) => best > 0 && (second - best) / best >= 0.1,
    ),
  );

  /** 🎯 Most accurate on the read-only task; decisive = ≥1 more correct answer. */
  protected readonly accuracyLeader = computed(() => {
    const correctCounts = this.svc.results()
      .filter((r) => r.ok)
      .map((r) => this.taskOf(r)?.questionsCorrect ?? 0)
      .sort((a, b) => b - a);
    return this.axisLeader(
      (r) => r.accuracyPct,
      true,
      () => correctCounts.length >= 2 && correctCounts[0] - correctCounts[1] >= 1,
    );
  });

  /** Per-question audit matrix: ground truth vs each model's answer. */
  protected readonly accuracyAudit = computed(() => {
    const graded = this.svc.results().filter(
      (r) => (this.taskOf(r)?.accuracyBreakdown?.length ?? 0) > 0,
    );
    if (graded.length === 0) return null;
    const base = this.taskOf(graded[0])!.accuracyBreakdown!;
    const rows = base.map((q, i) => ({
      id: q.id,
      question: q.question,
      expected: q.expected,
      cells: graded.map((r) => {
        const b = this.taskOf(r)?.accuracyBreakdown?.[i];
        return { label: r.label, answer: b?.answer ?? '—', correct: !!b?.correct };
      }),
    }));
    return { models: graded.map((r) => r.label), rows };
  });

  protected readonly providers = computed(() => {
    const groups = new Map<string, { label: string; models: typeof models }>();
    const models = this.svc.models();
    for (const m of models) {
      if (!groups.has(m.provider)) groups.set(m.provider, { label: m.providerLabel, models: [] });
      groups.get(m.provider)!.models.push(m);
    }
    return [...groups.values()];
  });

  ngOnInit(): void {
    this.tickerId = setInterval(() => this.nowTick.set(Date.now()), 1000);
    void this.svc.loadModels();
    this.store.dispatch(loadWorkspaces());
    this.store.dispatch(loadSessions());
    this.subs.add(this.store.select(getWorkspaces).subscribe((ws) => this.workspaces.set(ws)));
    this.subs.add(this.store.select(getSessions).subscribe((ss) => this.sessions.set(ss)));
    // Restore the target chosen in a previous visit (kept in the service).
    this.selectedTargetKey = this.svc.target()?.key ?? null;
  }

  ngOnDestroy(): void {
    if (this.tickerId) clearInterval(this.tickerId);
    this.subs.unsubscribe();
  }

  ngAfterViewChecked(): void {
    const el = this.terminal?.nativeElement;
    if (el && this.svc.running()) el.scrollTop = el.scrollHeight;
  }

  protected sessionPath(s: SessionSummary): string | null {
    return s.workspace?.path ?? s.deviceWorkspace?.localPath ?? null;
  }

  protected onTargetChange(): void {
    if (!this.selectedTargetKey) {
      this.svc.target.set(null);
      return;
    }
    const sep = this.selectedTargetKey.indexOf(':');
    const kind = this.selectedTargetKey.slice(0, sep);
    const id = this.selectedTargetKey.slice(sep + 1);
    if (kind === 'workspace') {
      const ws = this.workspaces().find((w) => w.id === id);
      if (ws) {
        this.svc.target.set({ key: this.selectedTargetKey, name: ws.name, path: ws.projectPath });
      }
    } else {
      const s = this.sessions().find((x) => x.id === id);
      const path = s ? this.sessionPath(s) : null;
      if (s && path) {
        this.svc.target.set({ key: this.selectedTargetKey, name: s.name, path });
      }
    }
  }

  // ── Slot helpers (hdblog-compara style: 3 positional boxes) ───────────
  // Each box is a two-step picker: first a provider, then a model of that
  // provider. slotProvider holds the chosen provider per box (UI-only state).
  protected readonly slotIndexes = [0, 1, 2];
  protected readonly slotProvider = signal<(string | null)[]>([null, null, null]);

  /** Distinct providers, in catalog order. */
  protected readonly providerList = computed(() => {
    const seen = new Map<string, string>();
    for (const m of this.svc.models()) {
      if (!seen.has(m.provider)) seen.set(m.provider, m.providerLabel);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  });

  protected modelsForProvider(provider: string | null) {
    if (!provider) return [];
    return this.svc.models().filter((m) => m.provider === provider);
  }

  protected modelAt(i: number) {
    const id = this.svc.slots()[i];
    return id ? this.svc.models().find((m) => m.id === id) ?? null : null;
  }

  protected onProviderChange(i: number, ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value || null;
    const arr = [...this.slotProvider()];
    arr[i] = value;
    this.slotProvider.set(arr);
    // Provider changed → clear the model choice for this box.
    this.svc.setSlot(i, null);
  }

  protected onModelChange(i: number, ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;
    this.svc.setSlot(i, value || null);
  }

  protected clearSlot(i: number): void {
    this.svc.setSlot(i, null);
    const arr = [...this.slotProvider()];
    arr[i] = null;
    this.slotProvider.set(arr);
  }

  protected isChosenElsewhere(id: string, slot: number): boolean {
    return this.svc.slots().some((s, idx) => idx !== slot && s === id);
  }

  // Real provider icons (same source as the rest of the manager UI:
  // session-git-explorer PROVIDER_MAP), via <iconify-icon>.
  private static readonly PROVIDER_ICON: Record<string, { icon: string; color: string }> = {
    'claude-code-cli': { icon: 'simple-icons:anthropic', color: '#d4a27f' },
    'codex': { icon: 'simple-icons:openai', color: '#74aa9c' },
  };

  protected providerIcon(provider: string): string {
    return SpeedTestComponent.PROVIDER_ICON[provider]?.icon ?? 'mdi:robot';
  }

  protected providerColor(provider: string): string {
    return SpeedTestComponent.PROVIDER_ICON[provider]?.color ?? '#8b5cf6';
  }

  // ── Live queue state (one card per contender, sequential run) ─────────
  protected liveFor(id: string): SpeedTestLiveState {
    return this.svc.live()[id] ?? {
      status: 'pending', round: null, phase: null,
      elapsedMs: 0, timeoutMs: 0, modelElapsedMs: 0,
    };
  }

  protected raceModel(id: string) {
    return this.svc.models().find((m) => m.id === id) ?? null;
  }

  protected raceRoundLabel(id: string): string {
    const s = this.liveFor(id);
    if (s.status === 'pending') return this.tr('At start');
    const p = s.phase;
    if (!p && !s.round) return this.tr('Warming up');
    if (p?.kind === 'speed') return this.tr('Speed sample', { n: p.sample, total: p.samplesTotal });
    if (p?.kind === 'analysis') return this.analysisTaskLabel();
    if (s.round === 'speed') return this.tr('Model speed');
    return this.analysisTaskLabel();
  }

  private analysisTaskLabel(): string {
    const mode = this.svc.modes().find((m) => m.id === this.svc.modeId());
    return mode?.exercise ?? this.tr('Codebase analysis');
  }

  // ── The ONE run clock + wait entertainment ─────────────────────────────

  /** Single global timer for the whole run, mm:ss, driven by the 1s ticker. */
  protected runClock(): string {
    const started = this.svc.runStartedAt();
    if (!started) return '0:00';
    const s = Math.max(0, Math.floor((this.nowTick() - started) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** "2 of 3 still racing" — everyone starts together, finishers peel off. */
  protected runningInfo(): string {
    const states = Object.values(this.svc.live());
    const total = states.length || this.svc.selected().length;
    const racing = states.filter((s) => s.status === 'running').length;
    if (!racing) return total > 1 ? this.tr('Models many', { count: total }) : this.tr('Models one');
    if (racing === total) return total > 1 ? this.tr('Racing all', { count: total }) : this.tr('Racing one');
    return this.tr('Racing some', { racing, total });
  }

  /** Race progress 0–100: share of contenders across the line. */
  protected queuePct(): number {
    const states = Object.values(this.svc.live());
    if (!states.length) return 0;
    const finished = states.filter((s) =>
      ['done', 'failed', 'cli-missing', 'skipped'].includes(s.status),
    ).length;
    return Math.round((finished / states.length) * 100);
  }

  // Rotating wait quips (6s each) — long analysis rounds can run 5+ minutes,
  // the copy keeps the wait honest and a little entertaining.
  private static readonly SPEED_QUIPS = [
    'Quip speed 1',
    'Quip speed 2',
    'Quip speed 3',
    'Quip speed 4',
  ];
  private static readonly ANALYSIS_QUIPS = [
    'Quip analysis 1',
    'Quip analysis 2',
    'Quip analysis 3',
    'Quip analysis 4',
    'Quip analysis 5',
    'Quip analysis 6',
    'Quip analysis 7',
  ];

  protected waitQuip(id: string): string {
    const s = this.liveFor(id);
    if (s.status !== 'running') return '';
    const quips = s.phase?.kind === 'analysis'
      ? SpeedTestComponent.ANALYSIS_QUIPS
      : SpeedTestComponent.SPEED_QUIPS;
    const started = this.svc.runStartedAt() ?? this.nowTick();
    return this.tr(quips[Math.floor(Math.max(0, this.nowTick() - started) / 6000) % quips.length]);
  }

  /** True while CLI chunks are actively arriving for this model. */
  protected isStreaming(id: string): boolean {
    const s = this.liveFor(id);
    return s.status === 'running' && !!s.lastOutputAt && this.nowTick() - s.lastOutputAt < 2500;
  }

  /** Celebration window right after a model crosses the line. */
  protected justFinished(id: string): boolean {
    const s = this.liveFor(id);
    return s.status === 'done' && !!s.finishedAt && this.nowTick() - s.finishedAt < 3500;
  }

  protected readonly confettiPieces = Array.from({ length: 10 }, (_, i) => i);

  /** Progress ring 0–100 vs the round timeout; latency has none → indeterminate. */
  protected racePct(id: string): number {
    const s = this.liveFor(id);
    if (!s.timeoutMs) return 0;
    return Math.min(100, Math.round((s.elapsedMs / s.timeoutMs) * 100));
  }

  protected resultForModel(id: string): SpeedTestModelResult | undefined {
    return this.svc.results().find((r) => r.modelId === id);
  }

  protected selectMode(id: string): void {
    if (!this.svc.running()) this.svc.modeId.set(id);
  }

  // Iconify icon + color + one-line hint per mode — same visual language as
  // the sessions Action Center picker (action-center.component.ts modeList /
  // allModesList). Duplicated on purpose: importing a component file across
  // features would couple the pages. KEEP IN SYNC.
  private static readonly MODE_META: Record<string, { iconify: string; color: string; hint: string }> = {
    clean:     { iconify: 'solar:magic-stick-3-bold-duotone',  color: '#bc8cff', hint: 'Neutral baseline — no behavior directives, accuracy-first prompt' },
    plan_only: { iconify: 'solar:clipboard-list-bold-duotone', color: '#58a6ff', hint: 'Strategy without edits' },
    sprint:    { iconify: 'solar:bolt-bold-duotone',           color: '#d29922', hint: 'Fast, minimal reasoning' },
    architect: { iconify: 'solar:buildings-3-bold-duotone',    color: '#db61a2', hint: 'Deep analysis, structured' },
    detective: { iconify: 'solar:magnifer-bug-bold-duotone',   color: '#ffa657', hint: 'Focused investigation' },
    refactor:  { iconify: 'solar:code-bold-duotone',           color: '#3fb950', hint: 'Clean, structured changes' },
    paranoid:  { iconify: 'solar:shield-check-bold-duotone',   color: '#f85149', hint: 'Zero risk, verify all' },
    minimal:   { iconify: 'solar:target-bold-duotone',         color: '#39c5cf', hint: 'Code only, no talk' },
  };

  protected modeIcon(id: string): string {
    return SpeedTestComponent.MODE_META[id]?.iconify ?? 'solar:settings-minimalistic-bold-duotone';
  }

  protected modeColor(id: string): string {
    return SpeedTestComponent.MODE_META[id]?.color ?? '#8b5cf6';
  }

  protected modeHint(id: string): string {
    return SpeedTestComponent.MODE_META[id]?.hint ?? '';
  }

  /** All models' numeric values for a metric row — feeds the comparison bars. */
  protected metricValues(row: (typeof this.metricRows)[number]): number[] {
    return this.svc.results().map((r) => (r.ok ? row.value(r) : 0));
  }

  protected roundMetric(result: SpeedTestModelResult, round: string): string {
    const r = result.rounds.find((x) => x.round === round);
    if (!r) return '—';
    if (!r.ok) return this.tr('Failed');
    // Speed cell: the representative median sample + how many samples actually
    // ran and their TRUE cumulative time (what the timer showed).
    if (round === 'speed' && r.speedSamples) {
      const median = { s: (r.totalMs / 1000).toFixed(1), n: r.speedSamples };
      return r.samplesWallMs
        ? this.tr('Median sample total', { ...median, total: (r.samplesWallMs / 1000).toFixed(1) })
        : this.tr('Median sample', median);
    }
    return `${(r.totalMs / 1000).toFixed(1)}s`;
  }

  // ── Baseline verdict (measured vs the model class's expected band) ─────
  protected readonly hasBaselines = computed(() =>
    this.svc.results().some((r) => !!r.baseline),
  );

  protected tierLabel(tier: string): string {
    return ['fast', 'balanced', 'reasoning'].includes(tier) ? this.tr(`Tier ${tier}`) : tier;
  }

  protected baselineChipText(b: SpeedTestBaselineVerdict): string {
    const band = `${b.expectedTps.min}–${b.expectedTps.max} tok/s`;
    switch (b.classification) {
      case 'within': return this.tr('Baseline within', { band });
      case 'below': return this.tr('Baseline below', { band });
      case 'above': return this.tr('Baseline above', { band });
      default: return this.tr('Baseline none');
    }
  }

  // ── Share (same flow as the profile contribution heatmap) ─────────────
  // Renders the comparison surface to a PNG (html-to-image), then: direct
  // download, clipboard copy (desktop bridge → web API), or social share via
  // Web Share API with composer + guided-paste fallback.

  private async render(): Promise<string | null> {
    if (!this.shareSurface) return null;
    this.exporting.set(true);
    // Let the export-only title/footer paint before capture.
    await new Promise((r) => setTimeout(r, 60));
    try {
      return await toPng(this.shareSurface.nativeElement, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor:
          document.documentElement.getAttribute('data-bs-theme') === 'dark'
            ? '#0f172a'
            : '#ffffff',
      });
    } catch {
      return null;
    } finally {
      this.exporting.set(false);
    }
  }

  protected async downloadImage(): Promise<void> {
    const url = await this.render();
    if (url) this.triggerDownload(url);
  }

  protected async copyImage(): Promise<void> {
    const url = await this.render();
    if (url && (await this.copyDataUrl(url))) {
      this.swalService.success(
        this.translateService.instant('PROFILE.Image copied to clipboard'),
      );
    } else {
      // Clipboard image write unsupported — fall back to a download.
      await this.downloadImage();
    }
  }

  /**
   * Social networks can't preview a localhost / auth-gated page, so we share
   * the rendered image. Same robust chain as the contribution graph: Web Share
   * API with the file attached when supported, otherwise copy the PNG to the
   * clipboard and open the network's composer (opened synchronously on click
   * so the popup isn't blocked).
   */
  protected async shareToNetwork(network: 'facebook' | 'linkedin'): Promise<void> {
    const composer =
      network === 'facebook'
        ? 'https://www.facebook.com/'
        : `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(this.shareCaption())}`;

    const canFileShare = this.canFileShare();
    const win = canFileShare ? null : window.open(composer, '_blank', 'noopener');

    const url = await this.render();

    if (canFileShare && url && (await this.shareViaWebShare(url))) return;
    if (!win || win.closed) window.open(composer, '_blank', 'noopener');

    if (network === 'facebook') {
      const imageCopied = url ? await this.copyDataUrl(url) : false;
      if (url && !imageCopied) this.triggerDownload(url);
      this.showFacebookShareDialog(imageCopied);
      return;
    }

    let hint = 'PROFILE.Save then attach hint';
    if (url) {
      if (await this.copyDataUrl(url)) {
        hint = 'PROFILE.Paste image hint';
      } else {
        this.triggerDownload(url);
      }
    }
    this.swalService.success(this.translateService.instant(hint));
  }

  private async shareViaWebShare(dataUrl: string): Promise<boolean> {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'promptops-speed-test.png', { type: 'image/png' });
      const nav = navigator as any;
      if (!nav.canShare || !nav.canShare({ files: [file] })) return false;
      await nav.share({ files: [file], title: 'PromptOps', text: this.shareCaption() });
      return true;
    } catch {
      return false;
    }
  }

  private async copyDataUrl(dataUrl: string): Promise<boolean> {
    const bridge = (window as any).promptops;
    if (bridge?.clipboardWriteImage) {
      try {
        const res = await bridge.clipboardWriteImage(dataUrl);
        if (res?.ok) return true;
      } catch {
        // fall through to the web clipboard
      }
    }
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  private showFacebookShareDialog(imageCopied: boolean): void {
    const t = (k: string) => this.translateService.instant(k);
    const caption = this.shareCaption();
    const step1 = imageCopied
      ? t('PROFILE.FB step paste image')
      : t('PROFILE.FB step attach image');
    const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    this.swalService.open({
      variant: 'info',
      title: t('PROFILE.Share on Facebook'),
      html: `<ol class="text-start mb-2"><li>${step1}</li><li>${t('PROFILE.FB step copy text')}</li></ol>`
        + `<blockquote class="text-start small border rounded p-2 mb-0">${escape(caption)}</blockquote>`,
      confirmText: t('PROFILE.Copy text'),
    }).then((res) => {
      if (res.isConfirmed) {
        navigator.clipboard?.writeText(caption).catch(() => {});
        this.swalService.success(t('PROFILE.Text copied'));
      }
    });
  }

  /** Sync probe: can the platform share files via the Web Share API? */
  private canFileShare(): boolean {
    try {
      const nav = navigator as any;
      const probe = new File([], 'p.png', { type: 'image/png' });
      return !!(nav.canShare && nav.canShare({ files: [probe] }));
    } catch {
      return false;
    }
  }

  /**
   * English caption for the social composer (public copy, like the heatmap's).
   * No bare URL on purpose — a link preview card would block pasting the image.
   */
  private shareCaption(): string {
    const results = this.svc.results().filter((r) => r.ok);
    const names = results.map((r) => r.label).join(' vs ');
    const lines: string[] = [];

    const s = this.speedLeader();
    if (s) {
      lines.push(
        s.decisive
          ? this.tr('Caption fastest', { model: s.result.label, tps: this.tpsDisplay(s.result) })
          : this.tr('Caption speed tie'),
      );
    }
    const a = this.accuracyLeader();
    if (a && this.gradedRun()) {
      lines.push(
        a.decisive
          ? this.tr('Caption accurate', { model: a.result.label, pct: a.result.accuracyPct })
          : this.tr('Caption accuracy tie'),
      );
    }
    const t = this.hasTaskRound() ? this.timeLeader() : null;
    if (t) {
      lines.push(
        t.decisive
          ? this.tr('Caption quickest', { model: t.result.label, time: this.secs(this.taskOf(t.result)?.totalMs ?? 0) })
          : this.tr('Caption task tie'),
      );
    }

    const body = lines.length ? lines.join('\n') : this.tr('Caption fallback');
    const mode = this.hasTaskRound() ? this.svc.modes().find((m) => m.id === this.svc.modeId()) : null;
    const modeTag = mode && mode.id !== 'clean' ? this.tr('Caption mode', { mode: mode.label }) : '';
    return (
      `${this.tr('Caption intro', { names, mode: modeTag })}\n` +
      `${this.tr('Caption line2')}\n\n` +
      `${body}\n\n` +
      `#PromptOps #AI #Benchmark #LLM`
    );
  }

  private triggerDownload(dataUrl: string): void {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'promptops-speed-test.png';
    a.click();
  }
}
