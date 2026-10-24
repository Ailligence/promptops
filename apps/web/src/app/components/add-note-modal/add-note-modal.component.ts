import { formatRelativeTime, formatUiDate } from '@core/helper/ui-locale';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  Output,
  signal,
  ViewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NoteService, DocNote } from '@core/services/note.service';
import { SwalService } from '@core/services/swal.service';

@Component({
  selector: 'app-add-note-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (visible()) {
      <div class="note-modal-overlay po-modal-overlay" (click)="close()">
        <div class="note-modal po-modal" role="dialog" aria-modal="true" [attr.aria-label]="'DOCS.Quick note' | translate" (click)="$event.stopPropagation()">
          <div class="note-modal-header po-modal-header">
            <span><i class="ti ti-note"></i> {{ 'DOCS.Quick note' | translate }}</span>
            <button class="close-btn po-modal-close" (click)="close()" [attr.aria-label]="'BUTTONS.Close' | translate"><i class="ti ti-x"></i></button>
          </div>

          <div class="note-modal-body po-modal-body">
            <!-- Context info -->
            @if (sessionId) {
              <div class="context-info">
                <i class="ti ti-robot"></i>
                <span>{{ 'DOCS.Attached to session' | translate }}</span>
              </div>
            }
            @if (filePath) {
              <div class="context-info">
                <i class="ti ti-file-code"></i>
                <span>{{ filePath }}</span>
              </div>
            }

            <!-- Existing notes -->
            @if (loadingNotes()) {
              <div class="existing-notes-loading">
                <div class="spinner-border spinner-border-sm" role="status"></div>
              </div>
            } @else if (existingNotes().length > 0) {
              <div class="existing-notes">
                @for (note of existingNotes(); track note.id) {
                  <div class="existing-note-item">
                    <div class="existing-note-content">{{ note.content }}</div>
                    <div class="existing-note-meta">
                      <span>{{ note.creator?.first_name }} {{ note.creator?.last_name }}</span>
                      <span>{{ formatDate(note.created_at) }}</span>
                    </div>
                    <button class="existing-note-delete" (click)="deleteNote(note)" [attr.aria-label]="'BUTTONS.Delete' | translate" [title]="'BUTTONS.Delete' | translate">
                      <i class="ti ti-x"></i>
                    </button>
                  </div>
                }
              </div>
            }

            <textarea
              #noteTextarea
              class="note-textarea"
              [(ngModel)]="noteContent"
              [placeholder]="'DOCS.Write your note' | translate"
              [attr.aria-label]="'DOCS.Quick note' | translate"
              rows="4"
            ></textarea>
          </div>

          <div class="note-modal-footer po-modal-footer">
            <button class="btn-cancel" (click)="close()">{{ 'BUTTONS.Cancel' | translate }}</button>
            <button
              class="btn-save"
              (click)="saveNote()"
              [disabled]="!noteContent.trim() || saving()"
            >
              @if (saving()) {
                <div class="spinner-border spinner-border-sm" role="status"></div>
              } @else {
                <i class="ti ti-check"></i>
              }
              {{ 'DOCS.Save note' | translate }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .note-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1050;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .note-modal {
      width: 480px;
      max-width: 90vw;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      overflow: hidden;
    }
    :host-context([data-bs-theme="dark"]) .note-modal {
      background: #1e293b;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }
    .note-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(100, 116, 139, 0.1);
      font-size: 0.9rem;
      font-weight: 700;
    }
    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: rgba(100, 116, 139, 0.5);
      padding: 0.15rem;
    }
    .close-btn:hover { color: #ef4444; }
    .note-modal-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .context-info {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: rgba(100, 116, 139, 0.6);
      padding: 0.35rem 0.5rem;
      background: rgba(99, 102, 241, 0.04);
      border-radius: 6px;
    }
    .note-textarea {
      width: 100%;
      padding: 0.6rem;
      border: 1px solid rgba(100, 116, 139, 0.15);
      border-radius: 8px;
      font-size: 0.82rem;
      resize: none;
      min-height: 80px;
      background: transparent;
    }
    :host-context([data-bs-theme="dark"]) .note-textarea {
      background: rgba(30, 41, 59, 0.6);
      border-color: rgba(99, 102, 241, 0.15);
      color: #e2e8f0;
    }
    .note-textarea:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }
    .note-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid rgba(100, 116, 139, 0.08);
    }
    .btn-cancel {
      padding: 0.4rem 0.8rem;
      border: 1px solid rgba(100, 116, 139, 0.15);
      border-radius: 8px;
      background: transparent;
      font-size: 0.78rem;
      cursor: pointer;
      color: inherit;
    }
    .btn-save {
      padding: 0.4rem 0.8rem;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .btn-save:hover { background: #4f46e5; }
    .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
    .existing-notes-loading { text-align: center; padding: 0.5rem; }
    .existing-notes {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      max-height: 200px;
      overflow-y: auto;
      padding: 0.25rem 0;
    }
    .existing-note-item {
      position: relative;
      padding: 0.5rem 0.6rem;
      background: rgba(99, 102, 241, 0.04);
      border: 1px solid rgba(100, 116, 139, 0.08);
      border-radius: 8px;
      font-size: 0.78rem;
    }
    :host-context([data-bs-theme="dark"]) .existing-note-item {
      background: rgba(30, 41, 59, 0.5);
      border-color: rgba(99, 102, 241, 0.1);
    }
    .existing-note-content {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
      padding-inline-end: 1.2rem;
    }
    .existing-note-meta {
      display: flex;
      gap: 0.5rem;
      font-size: 0.68rem;
      color: rgba(100, 116, 139, 0.5);
      margin-top: 0.25rem;
    }
    .existing-note-delete {
      position: absolute;
      top: 0.35rem;
      inset-inline-end: 0.35rem;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.7rem;
      color: rgba(100, 116, 139, 0.3);
      padding: 0;
      line-height: 1;
    }
    .existing-note-delete:hover { color: #ef4444; }
  `,
})
export class AddNoteModalComponent {
  @Input() sessionId?: string;
  @Input() filePath?: string;
  @Output() noteSaved = new EventEmitter<DocNote>();

  visible = signal(false);
  saving = signal(false);
  loadingNotes = signal(false);
  existingNotes = signal<DocNote[]>([]);
  noteContent = '';

  @ViewChild('noteTextarea') noteTextareaRef?: ElementRef<HTMLTextAreaElement>;

  private readonly noteService = inject(NoteService);
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  async open(): Promise<void> {
    this.noteContent = '';
    this.existingNotes.set([]);
    this.visible.set(true);

    // Explicit focus: `autofocus` attribute does not reliably fire when the
    // element appears via @if on Windows (Chromium-based webview), so keystrokes
    // would be intercepted by the underlying terminal and the Save button
    // would stay disabled (noteContent never updates).
    setTimeout(() => this.noteTextareaRef?.nativeElement?.focus(), 0);

    this.loadExistingNotes();
  }

  close(): void {
    this.visible.set(false);
  }

  formatDate(date?: string): string {
    if (!date) return '';
    const d = new Date(date);
    if (Date.now() - d.getTime() < 7 * 86_400_000) return formatRelativeTime(d);
    return formatUiDate(d, { year: 'numeric', month: 'numeric', day: 'numeric' });
  }

  async saveNote(): Promise<void> {
    if (!this.noteContent.trim() || this.saving()) return;

    this.saving.set(true);
    try {
      const note = await this.noteService.createMyNote({
        content: this.noteContent.trim(),
        session_id: this.sessionId,
        file_path: this.filePath,
      });
      this.existingNotes.set([note, ...this.existingNotes()]);
      this.noteContent = '';
      this.noteSaved.emit(note);
      this.swalService.autoClose(
        this.translateService.instant('DOCS.Note saved'),
        this.translateService.instant('DOCS.Note saved message')
      );
    } catch (err: any) {
      this.swalService.error(err?.message || this.translateService.instant('MESSAGE.Generic error'));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteNote(note: DocNote): Promise<void> {
    try {
      await this.noteService.deleteMyNote(note.id);
      this.existingNotes.set(this.existingNotes().filter(n => n.id !== note.id));
    } catch (err: any) {
      this.swalService.error(err?.message || this.translateService.instant('MESSAGE.Generic error'));
    }
  }

  private async loadExistingNotes(): Promise<void> {
    this.loadingNotes.set(true);
    try {
      const filters: any = {};
      if (this.sessionId) filters.session_id = this.sessionId;
      if (this.filePath) filters.file_path = this.filePath;
      const notes = await this.noteService.loadMyNotes(filters);
      this.existingNotes.set(notes);
    } catch {
      // silent
    } finally {
      this.loadingNotes.set(false);
    }
  }
}
