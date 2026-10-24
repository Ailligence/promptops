import { Injectable, inject } from '@angular/core';
import { DataBackend } from '@core/data/data-backend';

/** A quick note attached to a session or a file. */
export interface DocNote {
  id: number;
  session_id?: string;
  file_path?: string;
  content: string;
  team_id: number | null;
  created_by: number;
  creator?: { id: number; first_name: string; last_name: string; username?: string; avatar?: string };
  created_at?: string;
}

/** Personal notes, kept on this device: list, create, delete. */
@Injectable({ providedIn: 'root' })
export class NoteService {
  private data = inject(DataBackend);

  async loadMyNotes(filters?: { session_id?: string; file_path?: string; query?: string }): Promise<DocNote[]> {
    const params: Record<string, string> = {};
    if (filters?.session_id) params['session_id'] = filters.session_id;
    if (filters?.file_path) params['file_path'] = filters.file_path;
    if (filters?.query) params['search'] = filters.query;
    return this.data.call<DocNote[]>('notes.list', params);
  }

  async createMyNote(data: { content: string; session_id?: string; file_path?: string }): Promise<DocNote> {
    return this.data.call<DocNote>('notes.create', data);
  }

  async deleteMyNote(noteId: number): Promise<void> {
    await this.data.call('notes.delete', { id: noteId });
  }
}
