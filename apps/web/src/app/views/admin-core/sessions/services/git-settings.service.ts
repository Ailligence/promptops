import { Injectable, signal } from '@angular/core';

/**
 * Controls the Git Settings modal. Kept separate from GitSetupService (which is
 * the "fix my remote/SSH" diagnostic flow). This modal hosts preferences that
 * shape how the Git tooling behaves — starting with the commit-message
 * convention, and designed to grow into more sections over time.
 */
export type GitSettingsSection = 'commit' | 'branch' | 'push';

@Injectable({ providedIn: 'root' })
export class GitSettingsService {
  visible = signal(false);
  activeSection = signal<GitSettingsSection>('commit');

  open(section: GitSettingsSection = 'commit'): void {
    this.activeSection.set(section);
    this.visible.set(true);
  }

  close(): void {
    this.visible.set(false);
  }
}
