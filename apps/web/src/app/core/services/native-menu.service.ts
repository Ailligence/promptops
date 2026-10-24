import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';

/**
 * Bridge to the native application menu (`src-tauri/src/commands/menu.rs`).
 *
 * Applies ONLY inside Tauri: elsewhere this
 * service is a complete no-op (no listeners, no invokes).
 *
 * The native menu does not run app actions: it emits `native:menu` and we
 * dispatch them here. Navigation items are handled directly with the Router; those
 * acting on the current session end up on `sessionAction$`, which
 * session-view subscribes to in order to call the methods it already has.
 */

/** Actions concerning the active session — consumed by session-view. */
export type NativeSessionAction =
  | 'session-new'
  | 'session-new-tab'
  | 'session-close'
  | 'session-rename'
  | 'session-standby'
  | 'session-prev'
  | 'session-next'
  | 'subagent-spawn'
  | 'workspace-open'
  | 'workspace:open-recent'
  | 'git-explorer'
  | 'db-explorer'
  | 'terminals';

export interface NativeMenuCommand {
  action: NativeSessionAction;
  /** Set only for `workspace:open-recent` (workspace path). */
  payload?: string | null;
}

/** native item id → i18n key. The keys live in `NATIVE_MENU` (en/it). */
const LABEL_KEYS: Record<string, string> = {
  'menu:file': 'NATIVE_MENU.File',
  'menu:edit': 'NATIVE_MENU.Edit',
  'menu:session': 'NATIVE_MENU.Session',
  'menu:view': 'NATIVE_MENU.View',
  'menu:window': 'NATIVE_MENU.Window',
  'menu:help': 'NATIVE_MENU.Help',
  'menu:recent': 'NATIVE_MENU.Recent Workspaces',
  'menu:recent-empty': 'NATIVE_MENU.No recent workspaces',
  'app:session-new': 'NATIVE_MENU.New Session',
  'app:session-new-tab': 'NATIVE_MENU.New Session Tab',
  'app:session-close': 'NATIVE_MENU.Close Session',
  'app:session-rename': 'NATIVE_MENU.Rename Session',
  'app:session-standby': 'NATIVE_MENU.Put on Standby',
  'app:session-prev': 'NATIVE_MENU.Previous Session',
  'app:session-next': 'NATIVE_MENU.Next Session',
  'app:subagent-spawn': 'NATIVE_MENU.Spawn Sub-agent',
  'app:workspace-open': 'NATIVE_MENU.Open Workspace',
  'app:git-explorer': 'NATIVE_MENU.Git Explorer',
  'app:db-explorer': 'NATIVE_MENU.Database Explorer',
  'app:terminals': 'NATIVE_MENU.Terminals',
  'app:settings': 'NATIVE_MENU.Settings',
  'app:docs': 'NATIVE_MENU.Documentation',
  'app:feedback': 'NATIVE_MENU.Send Feedback',
  'app:release-notes': 'NATIVE_MENU.Release Notes',
  'app:check-updates': 'NATIVE_MENU.Check for Updates',
  'native:reload': 'NATIVE_MENU.Reload',
  'native:devtools': 'NATIVE_MENU.Developer Tools',
  'native:zoom-in': 'NATIVE_MENU.Zoom In',
  'native:zoom-out': 'NATIVE_MENU.Zoom Out',
  'native:zoom-reset': 'NATIVE_MENU.Actual Size',
};

/** Pure navigation actions: resolved by the service, not by session-view. */
const ROUTE_ACTIONS: Record<string, string> = {
  settings: '/admin/settings',
  feedback: '/admin/feedback',
};

/**
 * The documentation has no internal route: Help > Documentation opens this
 * edition's docs (README and docs/ in the open-source repository), not the
 * hosted product's website, whose guides describe features this build does not have.
 */
export const DOCS_URL = 'https://github.com/shellonback/promptops#readme';

@Injectable({ providedIn: 'root' })
export class NativeMenuService implements OnDestroy {
  private router = inject(Router);
  private translate = inject(TranslateService);

  /** Actions to run on the current session (consumed by session-view). */
  readonly sessionAction$ = new Subject<NativeMenuCommand>();
  /** "Check for Updates…" — the updater lives in another service, here only the signal. */
  readonly checkUpdates$ = new Subject<void>();
  /** "Release Notes" — opens the existing modal in app.component. */
  readonly releaseNotes$ = new Subject<void>();

  private unsubscribe: (() => void) | null = null;
  private langSub: { unsubscribe(): void } | null = null;

  private get api(): any {
    return (window as any).promptops;
  }

  private get isTauri(): boolean {
    return !!(window as any).__TAURI__;
  }

  /** To call once at bootstrap. Idempotent and a no-op outside Tauri. */
  init(): void {
    if (!this.isTauri || this.unsubscribe !== null) return;
    if (typeof this.api?.onNativeMenu !== 'function') return;

    this.unsubscribe = this.api.onNativeMenu((event: { action: string; payload?: string | null }) => {
      this.dispatch(event?.action ?? '', event?.payload ?? null);
    });

    this.pushLabels();
    // The menu is built only once on the Rust side: on every language change it must be
    // rebuilt, otherwise it stays in the bootstrap language.
    this.langSub = this.translate.onLangChange.subscribe(() => this.pushLabels());
  }

  /** Updates the "Recent Workspaces" submenu after opening a workspace. */
  refreshRecents(): void {
    if (!this.isTauri || typeof this.api?.menuRefreshRecents !== 'function') return;
    this.api.menuRefreshRecents().catch(() => undefined);
  }

  private pushLabels(): void {
    if (typeof this.api?.menuApplyLabels !== 'function') return;
    const labels: Record<string, string> = {};
    for (const [id, key] of Object.entries(LABEL_KEYS)) {
      const translated = this.translate.instant(key);
      // ngx-translate returns the key itself when missing: in that case
      // better to let Rust use its English fallback.
      if (translated && translated !== key) labels[id] = translated;
    }
    this.api.menuApplyLabels(labels).catch(() => undefined);
    this.pushNotificationLabels();
    this.pushCloseConfirmationLabels();
  }

  /** The native confirmation must follow the language selected in the webapp. */
  private pushCloseConfirmationLabels(): void {
    if (typeof this.api?.dialogSetCloseLabels !== 'function') return;
    const pick = (key: string, fallback: string): string => {
      const value = this.translate.instant(key);
      return value && value !== key ? value : fallback;
    };
    this.api.dialogSetCloseLabels({
      message: pick('MESSAGE.Are you sure you want to close PromptOps?', 'Are you sure you want to close PromptOps?'),
      confirmLabel: pick('COMMON.Close', 'Close'),
      cancelLabel: pick('COMMON.Cancel', 'Cancel'),
    }).catch(() => undefined);
  }

  /**
   * System notification titles. Rust sends them when a request arrives
   * while the window is not focused, so the translations must be pushed
   * over there: they are the same labels the Action Center shows on screen.
   */
  private pushNotificationLabels(): void {
    if (typeof this.api?.notifySetLabels !== 'function') return;
    const pick = (key: string): string | null => {
      const value = this.translate.instant(key);
      return value && value !== key ? value : null;
    };
    this.api
      .notifySetLabels(pick('SESSIONS.Input Request'), pick('SESSIONS.Action Request'))
      .catch(() => undefined);
  }

  private dispatch(action: string, payload: string | null): void {
    if (!action) return;

    if (action === 'release-notes') {
      this.releaseNotes$.next();
      return;
    }
    if (action === 'check-updates') {
      this.checkUpdates$.next();
      return;
    }
    if (action === 'docs') {
      this.api?.openExternal?.(DOCS_URL);
      return;
    }

    const route = ROUTE_ACTIONS[action];
    if (route) {
      this.router.navigate([route]);
      return;
    }

    this.sessionAction$.next({ action: action as NativeSessionAction, payload });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.langSub?.unsubscribe();
  }
}
