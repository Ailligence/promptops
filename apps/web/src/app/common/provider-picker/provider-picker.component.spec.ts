import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { TranslateModule } from "@ngx-translate/core";
import { ProviderService } from "@core/services/provider.service";
import { ProviderCapability } from "@core/providers/provider-capability";
import { ProviderPickerComponent } from "./provider-picker.component";

function manifest(id: ProviderCapability["id"], tier: "cloud" | "local"): ProviderCapability {
  return {
    id,
    displayName: id,
    tier,
    requiresApiKey: tier === "cloud",
    offlineCapable: tier === "local",
    cli: { command: id, installHintKey: `${id}.HINT`, detectable: false },
    capabilities: { reasoning: true, execution: true, longContext: false, toolUse: true },
    i18n: { bestForKey: `${id}.BEST`, limitationsKey: `${id}.LIM`, microcopyKey: `${id}.MICRO` },
    ui: { icon: "ti-x", accent: "slate" },
  };
}

describe("ProviderPickerComponent", () => {
  const list = [manifest("claude-code-cli", "cloud"), manifest("codex", "cloud"), manifest("opencode", "local")];

  async function create(): Promise<ProviderPickerComponent> {
    TestBed.configureTestingModule({
      imports: [ProviderPickerComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ProviderService,
          useValue: { listProviders: () => Promise.resolve(list), detected: signal(new Set()) },
        },
      ],
    });
    const fixture = TestBed.createComponent(ProviderPickerComponent);
    await fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  }

  it("describes the provider just picked, not the first one", async () => {
    const picker = await create();
    expect(picker.selected()?.id).toBe("claude-code-cli");
    picker.select("codex");
    expect(picker.selected()?.id).toBe("codex");
  });

  it("follows a value set from outside (the parent's [value] binding)", async () => {
    const picker = await create();
    picker.value = "opencode";
    expect(picker.selected()?.i18n.microcopyKey).toBe("opencode.MICRO");
  });

  it("states installed / missing in text and marks the picked tile as pressed", async () => {
    const detectable = list.map((m) => ({ ...m, cli: { ...m.cli, detectable: true } }));
    TestBed.configureTestingModule({
      imports: [ProviderPickerComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ProviderService,
          useValue: { listProviders: () => Promise.resolve(detectable), detected: signal(new Set(["codex"])) },
        },
      ],
    });
    const fixture = TestBed.createComponent(ProviderPickerComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.value = "codex";
    fixture.detectChanges();
    const tiles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll(".provider-tile"));
    const byName = (n: string) => tiles.find((t) => t.querySelector(".tile-name")?.textContent?.trim() === n)!;
    expect(byName("codex").querySelector(".visually-hidden")?.textContent?.trim()).toBe("PROVIDERS.STATUS.INSTALLED");
    expect(byName("opencode").querySelector(".visually-hidden")?.textContent?.trim()).toBe("PROVIDERS.STATUS.NOT_INSTALLED");
    expect(byName("codex").getAttribute("aria-pressed")).toBe("true");
    expect(byName("opencode").getAttribute("aria-pressed")).toBe("false");
  });
});
