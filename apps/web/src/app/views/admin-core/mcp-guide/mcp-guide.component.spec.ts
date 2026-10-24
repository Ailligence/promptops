import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LIMITS, McpGuideComponent } from './mcp-guide.component';

describe('McpGuideComponent', () => {
  afterEach(() => delete (window as any).promptops);

  it('does not claim a ranking the open-source edition does not have', () => {
    expect(LIMITS as readonly string[]).not.toContain('ranking');
  });

  it('copies the example prompt through the desktop bridge and survives a refusal', async () => {
    await TestBed.configureTestingModule({ imports: [McpGuideComponent, TranslateModule.forRoot()] }).compileComponents();
    const written: string[] = [];
    (window as any).promptops = { clipboardWrite: async (t: string) => { written.push(t); } };
    const fixture = TestBed.createComponent(McpGuideComponent);
    const cmp = fixture.componentInstance as any;
    await cmp.copyPrompt();
    expect(written).toEqual(['MCP_GUIDE.Example prompt']);
    expect(cmp.copied()).toBeTrue();
    (window as any).promptops = { clipboardWrite: async () => { throw new Error('denied'); } };
    cmp.copied.set(false);
    await expectAsync(cmp.copyPrompt()).toBeResolved();
    expect(cmp.copied()).toBeFalse();
  });
});
