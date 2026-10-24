import { Injectable, signal } from '@angular/core';

export interface AgentActionNotice {
  id: number;
  agentId: string;
  label: string;
  action: () => void;
}

/** Small transient notices, reusable by any agent action. */
@Injectable({ providedIn: 'root' })
export class AgentActionNoticeService {
  readonly notices = signal<AgentActionNotice[]>([]);
  private sequence = 0;

  show(agentId: string, label: string, action: () => void): void {
    const id = ++this.sequence;
    this.notices.update(list => [...list.filter(n => n.agentId !== agentId), { id, agentId, label, action }]);
    setTimeout(() => this.dismiss(id), 5000);
  }

  activate(notice: AgentActionNotice): void {
    this.dismiss(notice.id);
    notice.action();
  }

  private dismiss(id: number): void {
    this.notices.update(list => list.filter(n => n.id !== id));
  }
}
