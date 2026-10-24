import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { FccSetupComponent } from "./fcc-setup.component";

describe("FccSetupComponent save", () => {
  let previous: unknown;
  let bridge: Record<string, jasmine.Spy>;

  function create(): FccSetupComponent {
    TestBed.configureTestingModule({
      imports: [FccSetupComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    return TestBed.createComponent(FccSetupComponent).componentInstance;
  }

  beforeEach(() => {
    const w = window as unknown as { promptops?: unknown };
    previous = w.promptops;
    bridge = {
      saveFccConfig: jasmine.createSpy("save").and.resolveTo({ ok: false, error: "The encrypted local store is not available" }),
      testFccConnection: jasmine.createSpy("test").and.resolveTo({ ok: true, message: "ok" }),
    };
    w.promptops = bridge;
  });

  afterEach(() => {
    (window as unknown as { promptops?: unknown }).promptops = previous;
  });

  it("never reports a refused save as saved", async () => {
    const c = create();
    c.selectedProvider.set("ollama");
    c.selectedModel.set("qwen2.5-coder:7b");
    await c.save();
    expect(c.configured()).toBeFalse();
    expect(c.saveResult()).toBe("");
    expect(c.testResult()).toBe("The encrypted local store is not available");
    expect(c.saving()).toBeFalse();
  });

  it("releases the busy flags when a custom save fails", async () => {
    bridge["saveFccConfig"].and.rejectWith(new Error("boom"));
    const c = create();
    c.customModel.set("m");
    await c.testCustom();
    expect(c.saving()).toBeFalse();
    expect(c.testing()).toBeFalse();
    expect(c.configured()).toBeFalse();
    expect(bridge["testFccConnection"]).not.toHaveBeenCalled();
  });
});

describe("FccSetupComponent i18n", () => {
  it("renders install steps and labels from translation keys", async () => {
    const w = window as unknown as { promptops?: unknown };
    const previous = w.promptops;
    w.promptops = {
      getFccCatalog: () => Promise.resolve({ ok: true, data: [
        { id: "deepseek", name: "DeepSeek", tier: "cloud-paid", requiresApiKey: true, defaultBaseUrl: "", defaultModel: "", models: [] },
        { id: "ollama", name: "Ollama", tier: "local", requiresApiKey: false, defaultBaseUrl: "", defaultModel: "a:7b", models: ["a:7b", "b:32b"],
          modelDetails: [
            { id: "a:7b", tier: "low", ram: "~5 GB", recommended: true, label: "light" },
            { id: "b:32b", tier: "high", ram: "~22 GB", label: "quality" },
          ] },
      ] }),
      getFccConfig: () => Promise.resolve({ ok: true, data: { configured: false } }),
    };
    try {
      TestBed.configureTestingModule({
        imports: [FccSetupComponent, TranslateModule.forRoot()],
        providers: [provideRouter([])],
      });
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation("xx", { FCC_SETUP: {
        "G sign up": "Inscrivez-vous sur <b>{{site}}</b>",
        "G deepseek 2": "Créez une clé",
        "G deepseek 3": "Choisissez",
        "How to install": "Installer {{name}}",
        "CPU only": "CPU seul",
        "Full GPU": "GPU complet",
        "Model id hint": "XX model id hint for {{name}}",
        MODEL_LABEL: { quality: "Qualité maximale" },
      } });
      translate.use("xx");
      const fixture = TestBed.createComponent(FccSetupComponent);
      const c = fixture.componentInstance;
      await c.ngOnInit();
      c.activeTab.set("cloud-paid");
      c.selectedProvider.set("deepseek");
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const steps = Array.from(el.querySelectorAll(".guide-steps li")).map((li) => li.innerHTML);
      expect(steps).toEqual(["Inscrivez-vous sur <b>platform.deepseek.com</b>", "Créez une clé", "Choisissez"]);
      expect(el.querySelector(".guide-box summary")?.textContent).toContain("Installer DeepSeek");
      expect(c.fitLabel("gpu")).toBe("GPU complet");
      expect(c.gpuLabel({ gpus: [] } as never)).toBe("CPU seul");
      // No price or dated free-model id is hard-coded in the guide any more.
      expect(steps.join(" ")).not.toContain("$");
      // Cloud: no suggested ids, the user types the model (input + hint shown).
      expect(el.querySelector(".field-hint")?.textContent).toContain("XX model id hint for DeepSeek");
      expect(el.querySelector('input.form-input[type="text"]')).not.toBeNull();
      expect(el.querySelectorAll(".model-btn").length).toBe(0);

      // Local: model labels are translation ids.
      c.activeTab.set("local");
      c.selectProvider({ id: "ollama", defaultModel: "a:7b", defaultBaseUrl: "", requiresApiKey: false } as never);
      fixture.detectChanges();
      expect(el.querySelector(".model-label")?.textContent?.trim()).toBe("Qualité maximale");
    } finally {
      w.promptops = previous;
    }
  });
});

