export interface MenuShortcutInterface {
  id: number;
  user_id: number;
  prompt_id: number;
  label: string;
  icon: string;
  sort_order: number;
  type?: 'prompt' | 'session' | 'workspace';
  target_id?: string;
  prompt?: {
    id: number;
    title: string;
    status: string;
  };
  created_at?: string;
  updated_at?: string;
}
