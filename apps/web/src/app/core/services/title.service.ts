// title.service.ts
import { Injectable } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { ActivatedRoute, NavigationEnd, Router } from "@angular/router";
import { TranslateService } from "@ngx-translate/core";
import { filter } from "rxjs/operators";

@Injectable({
  providedIn: "root",
})
export class TitleService {
  constructor(
    private titleService: Title,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private translate: TranslateService,
  ) {}

  init(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updateTitle();
      });
    // The window title follows the chosen language, not only the next navigation.
    this.translate.onLangChange.subscribe(() => this.updateTitle());
  }

  /** Window title for a route's `data.title` (English), in the user's language when PAGE_TITLE has it. */
  titleFor(title: string): string {
    const key = `PAGE_TITLE.${title}`;
    const translated = this.translate.instant(key);
    return `${typeof translated === "string" && translated && translated !== key ? translated : title} | PromptOps`;
  }

  private updateTitle(): void {
    let route = this.activatedRoute;
    while (route.firstChild) {
      route = route.firstChild;
    }

    const title = route.snapshot.data["title"];
    if (title) this.titleService.setTitle(this.titleFor(title));
  }
}
