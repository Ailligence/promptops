import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionAssetsService } from '../services/session-assets.service';
import { IntentService } from '../services/intent.service';
import { SessionAssetsPanelComponent } from './session-assets-panel.component';

describe('SessionAssetsPanelComponent (error handling)', () => {
  let fixture: ComponentFixture<SessionAssetsPanelComponent>;
  let component: SessionAssetsPanelComponent;
  let service: any;

  beforeEach(async () => {
    service = {
      assets: signal([{ name: 'a.png', relativePath: '.assets/a.png', isImage: false, size: 1 }, { name: 'b.txt', relativePath: '.assets/b.txt', isImage: false, size: 1 }]),
      lastUploadedNames: signal<string[]>([]),
      loadAssets: jasmine.createSpy('loadAssets').and.resolveTo(),
      uploadFiles: jasmine.createSpy('uploadFiles').and.rejectWith(new Error('disk full')),
      deleteAsset: jasmine.createSpy('deleteAsset'),
      openFolder: jasmine.createSpy('openFolder').and.rejectWith(new Error('no opener')),
      orderIntents: () => ['implement'],
      buildIntentPrompt: () => 'prompt',
      formatSize: () => '1 B',
    };
    await TestBed.configureTestingModule({
      imports: [SessionAssetsPanelComponent, TranslateModule.forRoot()],
      providers: [
        { provide: SessionAssetsService, useValue: service },
        { provide: IntentService, useValue: {} },
      ],
    })
      .overrideComponent(SessionAssetsPanelComponent, { set: { template: '' } })
      .compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      ASSETS: {
        'Upload failed': 'Upload failed: {{error}}',
        'Delete failed': 'Delete failed: {{error}}',
        'Open folder failed': 'Open folder failed: {{error}}',
      },
    });
    translate.use('en');
    fixture = TestBed.createComponent(SessionAssetsPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('workspacePath', '/ws');
    fixture.detectChanges();
  });

  it('shows a failed upload instead of swallowing it', async () => {
    await (component as any).handleUpload([new File(['x'], 'x.txt')]);
    expect(component.actionError()).toBe('Upload failed: disk full');
    expect(component.uploading()).toBeFalse();
  });

  it('reports a failed bulk delete and keeps the remaining files selected', async () => {
    service.deleteAsset.and.callFake(async (_ws: string, name: string) => {
      if (name === 'b.txt') throw new Error('locked');
      service.assets.update((l: any[]) => l.filter(a => a.name !== name));
    });
    component.selectAll();
    await component.deleteSelected();
    expect(component.actionError()).toBe('Delete failed: locked');
    expect([...component.selectedAssets()]).toEqual(['b.txt']);
  });

  it('catches a refused "open assets folder"', async () => {
    component.openAssetsFolder();
    await new Promise(r => setTimeout(r, 0));
    expect(component.actionError()).toBe('Open folder failed: no opener');
  });

  it('lets the image preview take Esc before the composer', () => {
    component.composerOpen.set(true);
    component.previewAsset.set({ name: 'a.png' } as any);
    component.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.composerOpen()).toBeTrue();

    component.previewAsset.set(null);
    component.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.composerOpen()).toBeFalse();
  });
});
