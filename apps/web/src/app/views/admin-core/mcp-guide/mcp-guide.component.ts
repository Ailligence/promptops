import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/** Demo video bundled with the app: it plays offline and never depends on the website. */
const VIDEO_URL = 'assets/videos/promptops-mcp-demo.mp4';
const POSTER_URL = 'assets/videos/promptops-mcp-demo-poster.jpg';

/** Tool of the `promptops` MCP server, in the order the guide explains them. */
const TOOLS = [
  { key: 'spawn', icon: 'ti-terminal-2' },
  { key: 'prompt', icon: 'ti-message-2' },
  { key: 'wait', icon: 'ti-hourglass' },
  { key: 'read', icon: 'ti-file-text' },
  { key: 'list', icon: 'ti-list-details' },
  { key: 'keys', icon: 'ti-keyboard' },
] as const;

/**
 * No 'ranking' entry: the open-source edition has no ranking (a cloud
 * feature), so "prompts through the MCP count for the ranking" would be false.
 */
export const LIMITS = ['scope', 'dialogs', 'attended', 'count'] as const;

/**
 * Mini guide for the PromptOps MCP: what it is, how an agent uses it to open
 * other agents in its session, and the limits that keep the user in control.
 */
@Component({
  selector: 'app-mcp-guide',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './mcp-guide.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './mcp-guide.component.scss',
})
export class McpGuideComponent {
  private readonly translate = inject(TranslateService);

  protected readonly videoUrl = VIDEO_URL;
  protected readonly posterUrl = POSTER_URL;
  protected readonly tools = TOOLS;
  protected readonly limits = LIMITS;
  /**
   * The video is published separately from the app. Until its metadata loads
   * the card stays out of the way; a load error means it is not there yet.
   */
  protected readonly videoState = signal<'loading' | 'ready' | 'missing'>('loading');
  protected readonly copied = signal(false);

  protected get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  protected get examplePrompt(): string {
    return this.translate.instant('MCP_GUIDE.Example prompt');
  }

  /** Desktop bridge first (the webview may refuse navigator.clipboard), then the browser API. */
  protected async copyPrompt(): Promise<void> {
    const text = this.examplePrompt;
    const bridge = (window as any).promptops;
    try {
      if (typeof bridge?.clipboardWrite === 'function') await bridge.clipboardWrite(text);
      else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else return;
    } catch {
      return; // the prompt stays visible to copy by hand
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
