import { Injectable, inject, computed } from '@angular/core';
import { AppNotification } from './app-notification.service';
import { AgentActivityNotificationService } from './agent-activity-notification.service';
import { formatRelativeTime } from '@core/helper/ui-locale';

export interface UnifiedNotification {
  id: string;
  title: string;
  message: string;
  icon: string;
  iconColor: string;
  timestamp: Date;
  read: boolean;
  raw: AppNotification;
}

/**
 * Notification center: what your agents did (finished, failed, exited) while
 * you were looking elsewhere. Built from session states on this device and
 * kept in memory only; nothing is fetched or sent.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private agentActivity = inject(AgentActivityNotificationService);

  /** Notifications, newest first. */
  readonly notifications = computed<UnifiedNotification[]>(() =>
    this.agentActivity
      .items()
      .map((n) => this.mapAgentActivity(n))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  );

  readonly totalCount = computed(() => this.agentActivity.unreadCount());
  readonly hasPending = computed(() => this.totalCount() > 0);

  /** Starts listening to session states (idempotent). */
  start(): void {
    this.agentActivity.start();
  }

  markAsRead(notificationId: string): void {
    this.agentActivity.markAsRead(notificationId);
  }

  markAllAsRead(): void {
    this.agentActivity.markAllAsRead();
  }

  goToAgentSession(notification: AppNotification): void {
    this.agentActivity.open(notification);
  }

  /** "5m ago", "now"… in the UI language. */
  getTimeAgo(date: Date): string {
    return formatRelativeTime(date);
  }

  private mapAgentActivity(n: AppNotification): UnifiedNotification {
    const status = n.data['status'];
    return {
      id: n.id,
      title: n.data['session_name'] ?? '',
      message: n.data['message'] ?? '',
      icon: status === 'completed' ? 'ti ti-circle-check' : status === 'error' ? 'ti ti-alert-circle' : 'ti ti-player-stop',
      iconColor: status === 'completed' ? 'text-info' : status === 'error' ? 'text-danger' : 'text-secondary',
      timestamp: new Date(n.created_at),
      read: !!n.read_at,
      raw: n,
    };
  }
}
