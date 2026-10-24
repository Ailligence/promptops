import { TestBed } from "@angular/core/testing";
import { OrgPolicy, OrgPolicyService } from "@core/services/org-policy.service";
import { SessionService } from "../../views/admin-core/sessions/services/session.service";
import { InteractionService } from "../../views/admin-core/sessions/services/interaction.service";
import { PluginRuntimeService } from "../../views/admin-core/plugins/plugin-runtime.service";
import { PluginRegistryService } from "../../views/admin-core/plugins/plugin-registry.service";
import { BuiltinPluginsService } from "../../views/admin-core/plugins/builtin-plugins.service";

/** Enterprise agent policy: what the app refuses when the organization says so. */
describe("Organization policy enforcement", () => {
  let createSessionCalls: any[];
  let flagCalls: any[];
  let invokeCalls: string[];

  const setPolicy = async (policy: OrgPolicy | null) => {
    TestBed.inject(OrgPolicyService).apply(policy, "Acme");
  };

  beforeEach(() => {
    createSessionCalls = [];
    flagCalls = [];
    invokeCalls = [];
    (window as any).promptops = {
      createSession: (req: any) => {
        createSessionCalls.push(req);
        return Promise.resolve({ ok: true });
      },
      setAutoApproveFlags: (_id: string, flags: any) => {
        flagCalls.push(flags);
        return Promise.resolve();
      },
    };
    (window as any).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          invokeCalls.push(cmd);
          return Promise.resolve({});
        },
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PluginRegistryService, useValue: {} },
      ],
    });
  });

  afterEach(() => {
    delete (window as any).promptops;
    delete (window as any).__TAURI__;
  });

  it("allows everything without an organization", async () => {
    await setPolicy(null);
    const policy = TestBed.inject(OrgPolicyService);
    expect(policy.isProviderAllowed("codex")).toBeTrue();
    expect(policy.autoApproveAllowed()).toBeTrue();
    expect(policy.canInstallPlugins()).toBeTrue();
  });

  it("refuses a disallowed provider at the spawn chokepoint", async () => {
    await setPolicy({ allowed_providers: ["claude-code-cli"], auto_approve_allowed: true, plugins: "all" });
    const sessions = TestBed.inject(SessionService);

    const denied = await sessions.createSession({ provider: "codex" });
    expect(denied.ok).toBeFalse();
    expect(denied.error).toContain("Acme");
    expect(createSessionCalls.length).toBe(0);

    const allowed = await sessions.createSession({ provider: "claude-code-cli" });
    expect(allowed.ok).toBeTrue();
    expect(createSessionCalls.length).toBe(1);
  });

  it("strips auto-approve from new sessions and refuses turning it on", async () => {
    await setPolicy({ allowed_providers: null, auto_approve_allowed: false, plugins: "all" });

    await TestBed.inject(SessionService).createSession({ provider: "claude-code-cli", config: { autoApprove: true } });
    expect(createSessionCalls[0].config.autoApprove).toBeFalse();

    const interactions = TestBed.inject(InteractionService);
    await interactions.setFlags("s1", { quick: true, ai: true });
    expect(interactions.getFlags("s1")).toEqual({ modal: false, quick: false, ai: false });
    expect(flagCalls[0]).toEqual({ modal: false, quick: false, ai: false });

    expect(TestBed.inject(BuiltinPluginsService).isOn("auto-approve" as any)).toBeFalse();
  });

  it("blocks registry and local plugins unless allowed", async () => {
    await setPolicy({ allowed_providers: null, auto_approve_allowed: true, plugins: "builtin" });
    const runtime = TestBed.inject(PluginRuntimeService);

    await expectAsync(runtime.install({ plugin_id: "x" } as any)).toBeRejectedWithError(/policy/);
    await expectAsync(runtime.linkLocal("/tmp/x")).toBeRejectedWithError(/policy/);
    await expectAsync(runtime.setEnabled("x", true)).toBeRejectedWithError(/policy/);
    await runtime.setEnabled("x", false);
    expect(invokeCalls[0]).toBe("plugin_runtime_set_enabled");
    expect(invokeCalls).not.toContain("plugin_runtime_install");
    expect(invokeCalls).not.toContain("plugin_runtime_link_local");
  });

  it("filters provider lists", async () => {
    await setPolicy({ allowed_providers: ["codex"], auto_approve_allowed: true, plugins: "all" });
    const list = TestBed.inject(OrgPolicyService).filterProviders(
      [{ value: "claude-code-cli" }, { value: "codex" }],
      (p) => p.value
    );
    expect(list.map((p) => p.value)).toEqual(["codex"]);
  });
});
