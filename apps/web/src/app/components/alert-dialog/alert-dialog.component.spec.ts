import { sanitizeDialogHtml } from './alert-dialog.component';

describe('sanitizeDialogHtml', () => {
  it('keeps the formatting that translations use', () => {
    expect(sanitizeDialogHtml('Delete <strong>notes.md</strong>?')).toBe('Delete <strong>notes.md</strong>?');
    expect(sanitizeDialogHtml('<ol class="text-start mb-2"><li>one</li><li>two</li></ol>'))
      .toBe('<ol class="text-start mb-2"><li>one</li><li>two</li></ol>');
  });

  it('turns images, links and handlers from interpolated names into plain text', () => {
    const name = '<img src="https://example.com/x.png" onerror="alert(1)">evil<a href="https://example.com">click</a>';
    const out = sanitizeDialogHtml(`Close session <strong>${name}</strong>?`);
    expect(out).toBe('Close session <strong>evilclick</strong>?');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('href');
  });

  it('drops attributes other than a plain class list, and script or style bodies', () => {
    expect(sanitizeDialogHtml('<span style="color:red" class="x" onclick="y()">t</span>')).toBe('<span class="x">t</span>');
    expect(sanitizeDialogHtml('<span class="a&quot;b">t</span>')).toBe('<span>t</span>');
    expect(sanitizeDialogHtml('a<script>alert(1)</script><style>*{}</style>b')).toBe('ab');
  });

  it('keeps already escaped text escaped', () => {
    expect(sanitizeDialogHtml('&lt;b&gt;not bold&lt;/b&gt;')).toBe('&lt;b&gt;not bold&lt;/b&gt;');
  });
});
