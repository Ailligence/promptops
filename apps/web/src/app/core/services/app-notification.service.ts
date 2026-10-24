/** An in-app notification, as shown by the notification center. */
export interface AppNotification {
  id: string;
  type: string;
  data: {
    type: string;
    [key: string]: any;
  };
  read_at: string | null;
  created_at: string;
}
