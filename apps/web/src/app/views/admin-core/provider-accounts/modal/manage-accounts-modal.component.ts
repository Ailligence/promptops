import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  inject,
} from "@angular/core";
import { NgbActiveModal, NgbModal, NgbModalRef } from "@ng-bootstrap/ng-bootstrap";
import { ProviderAccountsComponent } from "../provider-accounts.component";
import { TranslateModule } from "@ngx-translate/core";

@Component({
  selector: "po-manage-accounts-modal",
  standalone: true,
  imports: [ProviderAccountsComponent, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-header py-2">
      <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
        <iconify-icon icon="solar:users-group-rounded-bold-duotone" width="22"></iconify-icon>
        <h5 class="modal-title mb-0 text-truncate">{{ 'PROVIDER_ACCOUNTS.Manage title' | translate }}</h5>
      </div>
      <button type="button" class="btn-close" [attr.aria-label]="'COMMON.Close' | translate" (click)="close()"></button>
    </div>
    <div class="modal-body p-0 po-manage-body">
      <po-provider-accounts />
    </div>
  `,
  styles: [
    `
      .po-manage-body {
        max-height: calc(90vh - 56px);
        overflow-y: auto;
      }
    `,
  ],
})
export class ManageAccountsModalComponent {
  private activeModal = inject(NgbActiveModal);

  close(): void {
    this.activeModal.dismiss();
  }
}

export function openManageAccountsModal(modalService: NgbModal): NgbModalRef {
  return modalService.open(ManageAccountsModalComponent, {
    size: "xl",
    centered: true,
    scrollable: false,
    backdrop: true,
  });
}
