import { formatUiDate } from "@core/helper/ui-locale";
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnInit,
  signal,
  TemplateRef,
  ViewChild,
  ChangeDetectionStrategy
} from "@angular/core";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { NgbModal, NgbModalModule } from "@ng-bootstrap/ng-bootstrap";
import { SwalService } from "@core/services/swal.service";
import { PromptQueryService } from "../services/prompt-query.service";
import { PromptVersionInterface } from "@core/interfaces/prompt.interface";

@Component({
  selector: "app-prompt-version-history",
  standalone: true,
  imports: [TranslateModule, RouterModule, NgbModalModule],
  templateUrl: "./prompt-version-history.component.html",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .timeline-item {
      position: relative;
      padding-left: 2rem;
      padding-bottom: 1.5rem;
      border-left: 2px solid #e2e8f0;
    }
    .timeline-item:last-child {
      border-left: 2px solid transparent;
      padding-bottom: 0;
    }
    .timeline-dot {
      position: absolute;
      left: -0.55rem;
      top: 0.25rem;
      width: 1rem;
      height: 1rem;
      border-radius: 50%;
      background-color: var(--po-accent);
      border: 2px solid #fff;
      box-shadow: 0 0 0 2px var(--po-accent);
    }
    .timeline-dot.latest {
      background-color: #16a34a;
      box-shadow: 0 0 0 2px #16a34a;
    }
    .version-body-pre {
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.8rem;
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 0.5rem;
      padding: 1rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 400px;
      overflow-y: auto;
    }
  `,
})
export class PromptVersionHistoryComponent implements OnInit {
  protected versions = signal<PromptVersionInterface[]>([]);
  protected selectedVersion = signal<PromptVersionInterface | null>(null);
  protected promptId: number | null = null;
  protected loading = signal<boolean>(true);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryService = inject(PromptQueryService);
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);
  private readonly modalService = inject(NgbModal);

  @ViewChild("versionDetailTpl")
  protected versionDetailTpl!: TemplateRef<any>;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get("id");
    if (id) {
      this.promptId = +id;
      this.loadVersions();
    }
  }

  protected goBack(): void {
    this.router.navigate(["/admin/prompt-library"]);
  }

  protected openVersionDetail(version: PromptVersionInterface): void {
    this.selectedVersion.set(version);
    this.modalService.open(this.versionDetailTpl, {
      centered: true,
      size: "lg",
    });
  }

  protected restoreVersion(version: PromptVersionInterface): void {
    this.swalService.confirm(
      this.translateService.instant("PROMPTS.Restore version"),
      this.translateService.instant(
        "PROMPTS.Are you sure you want to restore version",
        { version: version.version_number }
      ),
      () => {
        this.queryService
          .restoreVersion(this.promptId!, version.id)
          .then(() => {
            this.swalService.success(
              this.translateService.instant(
                "PROMPTS.Version restored successfully"
              )
            );
            this.loadVersions();
          })
          .catch((err: any) => {
            this.swalService.error(
              err?.message ||
                this.translateService.instant("MESSAGE.Generic error")
            );
          });
      }
    );
  }

  protected getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      draft: "bg-warning",
      published: "bg-success",
      archived: "bg-secondary",
    };
    return classes[status] || "bg-secondary";
  }

  protected formatDate(dateStr: string): string {
    return formatUiDate(dateStr, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private async loadVersions(): Promise<void> {
    this.loading.set(true);
    try {
      const versions = await this.queryService.getVersionHistory(
        this.promptId!
      );
      this.versions.set(versions);
    } catch (err: any) {
      this.swalService.error(
        err?.message ||
          this.translateService.instant("MESSAGE.Generic error")
      );
    } finally {
      this.loading.set(false);
    }
  }
}
