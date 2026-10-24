import { Injectable, signal } from '@angular/core';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

@Injectable({ providedIn: 'root' })
export class DockerService {
  private get api(): any {
    return (window as any).promptops;
  }

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  // State
  status = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  containers = signal<DockerContainer[]>([]);
  allContainers = signal<DockerContainer[]>([]);
  projectName = signal<string>('');
  error = signal<string | null>(null);

  /** Bumped by each load: an answer for a folder the user left is dropped. */
  private loadSeq = 0;

  async loadContainers(cwd: string): Promise<void> {
    if (!this.isDesktop || !cwd) return;
    const seq = ++this.loadSeq;

    this.status.set('loading');
    this.error.set(null);

    try {
      const result = await this.api.dockerPs(cwd);
      if (seq !== this.loadSeq) return;
      if (!result.ok) {
        this.status.set('error');
        this.error.set(result.error);
        return;
      }

      this.containers.set(result.containers ?? []);
      this.allContainers.set(result.allContainers ?? []);
      this.projectName.set(result.projectName || '');
      this.status.set('loaded');
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.status.set('error');
      this.error.set((err as Error).message);
    }
  }

  reset(): void {
    this.status.set('idle');
    this.containers.set([]);
    this.allContainers.set([]);
    this.projectName.set('');
    this.error.set(null);
  }
}
