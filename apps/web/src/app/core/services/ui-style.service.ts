import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { changesidebarsize } from '@/store/layout/layout-action';
import { getSidebarsize } from '@/store/layout/layout-selector';
import { getUser } from '@/store/authentication/authentication.selector';
import { DataBackend } from '@core/data/data-backend';
import { UiPreferencesService } from '@core/services/ui-preferences.service';

/**
 * UI style variants. 'classic' is the default look; 'minimal' is the denser,
 * flatter skin (Linear/goodboy direction) layered on the --po-* tokens via
 * the html[data-po-ui="minimal"] attribute (see _minimal-ui.scss).
 *
 * Resolution order:
 *  1. manual choice from the topbar switcher — saved in the local profile as
 *     ui_preferences.ui_style;
 *  2. minimal is the default for everyone (A/B test retired — the new UI
 *     ships to all users from this release on).
 *  3. localStorage cache (anti-flash on boot) / minimal.
 */
export type UiStyle = 'classic' | 'minimal';

const STORAGE_KEY = 'promptops_ui_style';

/** Sidenav rail state forced while minimal is active (closed, hover-peek). */
const MINIMAL_SIDENAV_SIZE = 'sm-hover';

@Injectable({ providedIn: 'root' })
export class UiStyleService {
  /** Current UI style — reactive. */
  readonly style = signal<UiStyle>(readInitial());

  private readonly store = inject(Store);
  private readonly data = inject(DataBackend);
  private readonly uiPrefs = inject(UiPreferencesService);

  /** In-session manual choice — shields against stale store emissions. */
  private manualChoice: UiStyle | null = null;

  /** Last sidenav size chosen outside minimal, restored on switch back. */
  private lastFreeSidenavSize: string | null = null;

  constructor() {
    this.apply(this.style());

    // Server-driven alignment: manual override (ui_preferences.ui_style)
    // wins, otherwise everyone gets the minimal (new) UI. In-session manual
    // choice is already applied locally and persisted, so it takes precedence
    // over whatever the store still carries.
    this.store.select(getUser).subscribe((user: any) => {
      if (!user || this.manualChoice) return;

      // One skin only (the Signal Box panel): a stored 'classic' choice from
      // before the redesign is dropped rather than honored.
      this.clearCache();
      this.force('minimal');
    });

    // Minimal keeps the sidenav closed: the pin button is hidden by the skin,
    // and any dispatch that would reopen it (uiPrefs restore, other flows) is
    // remembered as the user's wish and immediately forced back to the rail.
    this.store.select(getSidebarsize).subscribe((size) => {
      if (this.style() === 'minimal' && size !== MINIMAL_SIDENAV_SIZE) {
        this.lastFreeSidenavSize = size;
        this.store.dispatch(changesidebarsize({ size: MINIMAL_SIDENAV_SIZE }));
      } else if (this.style() !== 'minimal') {
        this.lastFreeSidenavSize = size;
      }
    });
  }

  /** Manual switch (topbar icon): applies now and saves it in the local profile. */
  set(style: UiStyle): void {
    if (style !== 'minimal' || style === this.style()) return;
    this.manualChoice = style;
    this.cache(style);
    this.force(style);
    void this.persist(style);
  }

  private async persist(style: UiStyle): Promise<void> {
    try {
      await this.data.call('user.updateUiPreferences', { ui_style: style });
    } catch { /* not saved — the choice still holds for this session */ }
  }

  /** Boot anti-flash cache — only ever holds a *manual* choice. */
  private cache(style: UiStyle): void {
    try {
      localStorage.setItem(STORAGE_KEY, style);
    } catch { /* storage unavailable — style stays session-only */ }
  }

  private clearCache(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable */ }
  }

  private force(style: UiStyle): void {
    if (style === this.style()) return;
    this.style.set(style);
    this.apply(style);
    // Font ownership follows the skin (minimal = system stack, classic =
    // user preference): re-run the prefs application under the new attribute.
    this.uiPrefs.reapply();

    if (style === 'minimal') {
      this.store.dispatch(changesidebarsize({ size: MINIMAL_SIDENAV_SIZE }));
    } else if (this.lastFreeSidenavSize && this.lastFreeSidenavSize !== MINIMAL_SIDENAV_SIZE) {
      this.store.dispatch(changesidebarsize({ size: this.lastFreeSidenavSize }));
    }
  }

  private apply(style: UiStyle): void {
    if (style === 'minimal') {
      document.documentElement.setAttribute('data-po-ui', 'minimal');
    } else {
      document.documentElement.removeAttribute('data-po-ui');
    }
  }
}

function readInitial(): UiStyle {
  try {
    // Classic is retired: clear a stale opt-out so it cannot flash on boot.
    if (localStorage.getItem(STORAGE_KEY) === 'classic') localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
  return 'minimal';
}
