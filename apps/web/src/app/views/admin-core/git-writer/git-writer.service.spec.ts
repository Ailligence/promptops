import { TestBed } from '@angular/core/testing';
import { GitWriterService } from './git-writer.service';

/** The mail body is AI-written HTML rendered in a contenteditable editor. */
describe('GitWriterService mail HTML', () => {
  it('keeps the allowed formatting and drops links, images and handlers', () => {
    const writer: any = TestBed.inject(GitWriterService);
    writer.applyResult(
      'Subject: Release\n<p>Hi <strong>team</strong> <img src="x" onerror="alert(1)"><a href="https://evil.example">click</a></p><ul><li>one</li></ul><script>alert(2)</script>',
      'mail',
    );
    const body: string = writer.resultBody();
    expect(writer.resultSubject()).toBe('Release');
    expect(body).toContain('<strong>team</strong>');
    expect(body).toContain('<ul><li>one</li></ul>');
    expect(body).toContain('click');
    expect(body).not.toMatch(/<img|<a |onerror|href|<script|alert\(2\)/);
  });
});
