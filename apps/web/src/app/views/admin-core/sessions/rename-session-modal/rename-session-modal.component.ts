import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, ViewChild, ElementRef, AfterViewInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-rename-session-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="modal-header">
      <h5 class="modal-title">{{ "USERS_ADMIN.Rename session" | translate }}</h5>
      <button type="button" class="btn-close btn-close-white" (click)="modal.dismiss()" [attr.aria-label]="'BUTTONS.Close' | translate"></button>
    </div>
    <div class="modal-body">
      <label class="form-label text-muted small" for="rename-session-name">{{ "USERS_ADMIN.Session name" | translate }}</label>
      <input
        #nameInput
        id="rename-session-name"
        type="text"
        class="form-control"
        [(ngModel)]="name"
        (keydown.enter)="submit()"
        [placeholder]="'USERS_ADMIN.Session name' | translate"
      />
    </div>
    <div class="modal-footer">
      <button class="btn btn-sm btn-secondary" (click)="modal.dismiss()">{{ "BUTTONS.Cancel" | translate }}</button>
      <button class="btn btn-sm btn-primary" (click)="submit()" [disabled]="!name.trim()">
        <iconify-icon icon="solar:check-circle-bold" width="14"></iconify-icon>
        {{ "BUTTONS.Save" | translate }}
      </button>
    </div>
  `,
})
export class RenameSessionModalComponent implements AfterViewInit, OnDestroy {
  modal = inject(NgbActiveModal);
  @ViewChild('nameInput') nameInput!: ElementRef<HTMLInputElement>;

  /** Set via componentInstance */
  sessionId = '';
  name = '';

  private focusTimer?: ReturnType<typeof setTimeout>;

  ngAfterViewInit(): void {
    this.focusTimer = setTimeout(() => {
      this.nameInput?.nativeElement.focus();
      this.nameInput?.nativeElement.select();
    }, 50);
  }

  ngOnDestroy(): void {
    clearTimeout(this.focusTimer);
  }

  submit(): void {
    const trimmed = this.name.trim();
    if (trimmed) {
      this.modal.close({ sessionId: this.sessionId, name: trimmed });
    }
  }
}
