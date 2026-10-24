import { TestBed } from "@angular/core/testing";
import { TranslateModule } from "@ngx-translate/core";
import { AddNoteModalComponent } from "./add-note-modal.component";
import { NoteService, DocNote } from "@core/services/note.service";
import { SwalService } from "@core/services/swal.service";
import { DataBackend } from "@core/data/data-backend";

describe("AddNoteModalComponent", () => {
  let noteService: NoteService;
  let createMyNoteSpy: jasmine.Spy;
  let loadMyNotesSpy: jasmine.Spy;
  let deleteMyNoteSpy: jasmine.Spy;

  const note = (id: number, content = "hello"): DocNote =>
    ({ id, content, team_id: null, created_by: 1 } as DocNote);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddNoteModalComponent, TranslateModule.forRoot()],
      providers: [
        { provide: DataBackend, useValue: { call: () => Promise.reject({ code: "unavailable", message: "" }) } },
        { provide: SwalService, useValue: jasmine.createSpyObj<SwalService>("SwalService", ["autoClose", "error"]) },
      ],
    }).compileComponents();

    noteService = TestBed.inject(NoteService);
    createMyNoteSpy = spyOn(noteService, "createMyNote").and.resolveTo(note(7));
    loadMyNotesSpy = spyOn(noteService, "loadMyNotes").and.resolveTo([]);
    deleteMyNoteSpy = spyOn(noteService, "deleteMyNote").and.resolveTo();
  });

  function createComponent(): AddNoteModalComponent {
    return TestBed.createComponent(AddNoteModalComponent).componentInstance;
  }

  it("saves a personal note attached to the session, without any team", async () => {
    const cmp = createComponent();
    cmp.sessionId = "sess-123";
    cmp.noteContent = "my note";

    await cmp.saveNote();

    expect(createMyNoteSpy).toHaveBeenCalledWith({
      content: "my note",
      session_id: "sess-123",
      file_path: undefined,
    });
    expect(cmp.existingNotes()[0].id).toBe(7);
    expect(cmp.saving()).toBeFalse();
  });

  it("loads the session's existing notes on open", async () => {
    loadMyNotesSpy.and.resolveTo([note(1), note(2)]);
    const cmp = createComponent();
    cmp.sessionId = "sess-123";

    await cmp.open();

    expect(loadMyNotesSpy).toHaveBeenCalledWith({ session_id: "sess-123" });
    expect(cmp.existingNotes().length).toBe(2);
  });

  it("shows an error and re-enables Save when the API fails", async () => {
    createMyNoteSpy.and.rejectWith({ code: "storage", message: "boom" });
    const cmp = createComponent();
    cmp.sessionId = "sess-123";
    cmp.noteContent = "note";

    await cmp.saveNote();

    expect(TestBed.inject(SwalService).error).toHaveBeenCalled();
    expect(cmp.saving()).toBeFalse();
  });

  it("deletes a note and removes it from the list", async () => {
    const cmp = createComponent();
    cmp.existingNotes.set([note(1), note(2)]);

    await cmp.deleteNote(note(1));

    expect(deleteMyNoteSpy).toHaveBeenCalledWith(1);
    expect(cmp.existingNotes().map(n => n.id)).toEqual([2]);
  });

  it("does nothing when the note is empty", async () => {
    const cmp = createComponent();
    cmp.noteContent = "   ";

    await cmp.saveNote();

    expect(createMyNoteSpy).not.toHaveBeenCalled();
  });
});
