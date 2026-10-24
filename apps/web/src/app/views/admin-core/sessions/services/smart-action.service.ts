import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface SmartActionResult {
  detected: boolean;
  command: string | null;
  label: string | null;
  source: string | null;
  confidence: 'high' | 'medium' | 'low';
  alternatives?: SmartActionAlternative[];
}

export interface SmartActionAlternative {
  folderPath: string;
  folderName: string;
  fullCommand: string;
}

export interface FolderCommandEntry {
  folderPath: string;
  folderName: string;
  commands: {
    npmScripts: Record<string, string>;
    hasDockerCompose: boolean;
    hasMakefile: boolean;
    makeTargets: string[];
    scriptFiles: string[];
    packageManager: 'npm' | 'yarn' | 'pnpm';
  };
}

export type FolderCommandMap = FolderCommandEntry[];

/**
 * Service for detecting and executing Smart Actions.
 * Smart Actions detect when a user prompt maps to a direct terminal command
 * (e.g. "deploy" → "npm run deploy") and offer to run it without an AI agent.
 */
@Injectable({ providedIn: 'root' })
export class SmartActionService {
  /** Shared entry point: Quick Actions opens the existing Commands modal. */
  readonly commandsModalRequested = new Subject<void>();

  openCommands(): void {
    this.commandsModalRequested.next();
  }

  /** Current folder map for the active workspace. */
  folderMap = signal<FolderCommandMap>([]);

  /** Whether a folder scan is in progress. */
  scanning = signal(false);

  /** Last workspace path used for scanning (for re-scan without needing to resolve it again). */
  lastWorkspacePath = signal<string | null>(null);

  private get api(): any {
    return (window as any).promptops;
  }

  get isDesktop(): boolean {
    return !!this.api?.detectSmartAction;
  }

  /**
   * Detect if a prompt maps to a terminal command.
   * Returns null if not in the desktop app or detection fails.
   */
  async detect(prompt: string, workspacePath: string): Promise<SmartActionResult | null> {
    if (!this.isDesktop) return null;
    try {
      const res = await this.api.detectSmartAction(prompt, workspacePath);
      if (res.ok && res.result?.detected) {
        return res.result;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Execute a smart action command directly in a session's terminal.
   */
  async execute(sessionId: string, command: string): Promise<boolean> {
    if (!this.isDesktop) return false;
    try {
      const res = await this.api.executeSmartAction(sessionId, command);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Scan all sub-folders for available commands.
   * Called at session init and on-demand via re-map button.
   */
  async scanFolders(workspacePath: string, forceRefresh = false): Promise<FolderCommandMap> {
    if (!this.isDesktop || !workspacePath) {
      return [];
    }
    this.lastWorkspacePath.set(workspacePath);
    this.scanning.set(true);
    try {
      const res = await this.api.scanWorkspaceFolders(workspacePath, forceRefresh);
      if (res.ok) {
        this.folderMap.set(res.folderMap);
        return res.folderMap;
      }
      return [];
    } catch {
      return [];
    } finally {
      this.scanning.set(false);
    }
  }
}
