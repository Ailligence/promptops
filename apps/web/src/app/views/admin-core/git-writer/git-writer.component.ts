import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { getSessions } from '@/store/sessions/session.selectors';
import { getWorkspaces } from '@/store/workspaces/workspace.selectors';
import { loadSessions } from '@/store/sessions/session.actions';
import { loadWorkspaces } from '@/store/workspaces/workspace.actions';
import { SessionSummary } from '@/store/sessions/session.state';
import { WorkspaceSummary } from '@/store/workspaces/workspace.state';
import {
  ARTIFACT_TYPES,
  ArtifactType,
  GitWriterService,
  WriterLanguage,
  WriterTone,
} from './git-writer.service';

@Component({
  selector: 'app-git-writer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './git-writer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './git-writer.component.scss',
})
export class GitWriterComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  protected readonly writer = inject(GitWriterService);

  protected readonly workspaces = signal<WorkspaceSummary[]>([]);
  protected readonly sessions = signal<SessionSummary[]>([]);
  private readonly subs = new Subscription();

  protected readonly copiedField = signal<'subject' | 'body' | 'markdown' | null>(null);
  protected refineText = '';
  protected selectedTargetKey: string | null = null;

  protected readonly artifactTypes = ARTIFACT_TYPES;

  protected readonly hasResult = computed(
    () => !!(this.writer.resultSubject().trim() || this.writer.resultBody().trim()),
  );

  protected readonly tones: { value: WriterTone; icon: string }[] = [
    { value: 'professional', icon: 'ti-briefcase' },
    { value: 'formal', icon: 'ti-building-bank' },
    { value: 'informal', icon: 'ti-mood-smile' },
  ];

  // One-shot capable CLIs only (PROVIDER_COMMANDS in provider-cli.ts).
  protected readonly providers = [
    { value: 'claude-code-cli', label: 'Claude', icon: 'ti-brand-prisma' },
    { value: 'codex', label: 'Codex', icon: 'ti-brand-openai' },
    { value: 'gemini-cli', label: 'Gemini', icon: 'ti-diamond' },
    { value: 'grok', label: 'Grok', icon: 'ti-bolt' },
  ];

  protected readonly languages: WriterLanguage[] = ['auto', 'en', 'it', 'de', 'fr', 'es'];

  // Only sessions with a resolvable local path can feed git context.
  protected readonly linkableSessions = computed(() =>
    this.sessions().filter((s) => this.sessionPath(s) !== null),
  );

  ngOnInit(): void {
    this.store.dispatch(loadWorkspaces());
    this.store.dispatch(loadSessions());
    this.subs.add(this.store.select(getWorkspaces).subscribe((ws) => this.workspaces.set(ws)));
    this.subs.add(this.store.select(getSessions).subscribe((ss) => this.sessions.set(ss)));

    const linked = this.writer.linked();
    this.selectedTargetKey = linked ? `${linked.kind}:${linked.id}` : null;
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  protected selectType(type: ArtifactType): void {
    this.writer.artifactType.set(type);
  }

  protected sessionPath(s: SessionSummary): string | null {
    return s.workspace?.path ?? s.deviceWorkspace?.localPath ?? null;
  }

  protected onTargetChange(): void {
    if (!this.selectedTargetKey) {
      this.writer.unlink();
      return;
    }
    const sep = this.selectedTargetKey.indexOf(':');
    const kind = this.selectedTargetKey.slice(0, sep);
    const id = this.selectedTargetKey.slice(sep + 1);
    if (kind === 'workspace') {
      const ws = this.workspaces().find((w) => w.id === id);
      if (ws) {
        void this.writer.link({ kind: 'workspace', id: ws.id, name: ws.name, path: ws.projectPath });
      }
    } else {
      const s = this.sessions().find((x) => x.id === id);
      const path = s ? this.sessionPath(s) : null;
      if (s && path) {
        void this.writer.link({ kind: 'session', id: s.id, name: s.name, path });
      }
    }
  }

  protected unlink(): void {
    this.selectedTargetKey = null;
    this.writer.unlink();
  }

  protected toggleRepo(path: string): void {
    void this.writer.toggleRepo(path);
  }

  protected generate(): void {
    void this.writer.generate();
  }

  protected save(): void {
    void this.writer.saveToRepo();
  }

  protected async refine(): Promise<void> {
    const instructions = this.refineText.trim();
    if (!instructions) return;
    await this.writer.refine(instructions);
    if (!this.writer.error()) this.refineText = '';
  }

  protected async copyField(field: 'subject' | 'body' | 'markdown'): Promise<void> {
    if (field === 'subject') {
      await navigator.clipboard.writeText(this.writer.resultSubject());
    } else if (field === 'markdown') {
      await navigator.clipboard.writeText(this.writer.resultBody());
    } else {
      // Copy both flavors: mail clients paste the formatted HTML, plain-text
      // targets get the clean text version.
      const html = this.writer.resultBody();
      const plain = this.writer.getBodyPlainText();
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } catch {
        await navigator.clipboard.writeText(plain);
      }
    }
    this.copiedField.set(field);
    setTimeout(() => this.copiedField.set(null), 2000);
  }

  protected onBodyInput(event: Event): void {
    this.writer.resultBody.set((event.target as HTMLElement).innerHTML);
  }

  /**
   * Toolbar actions on the contenteditable editor. mousedown + preventDefault
   * keeps the text selection alive while the button is clicked.
   */
  protected format(event: Event, command: string): void {
    event.preventDefault();
    document.execCommand(command, false);
  }

  protected autoGrow(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 380) + 'px';
  }
}
