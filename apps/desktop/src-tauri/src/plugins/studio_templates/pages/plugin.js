// pages template: Release Notes.
//
// A `pages` plugin adds an entry to the PromptOps menu. It never draws anything: `open` and `event`
// return a description of the page, as plain data, and PromptOps draws it with its own components.
(() => {
  'use strict';

  const PAGE = 'release-notes';
  // The state lives here, inside the sandbox, for as long as PromptOps is open.
  const state = { repo: null, commits: [], version: '', audience: 'users', notes: '', fileName: '', notice: null };

  const AUDIENCES = [
    { value: 'users', label: 'For users', icon: 'ti-users', hint: 'What changes for them', text: 'the people who use the product: plain language, no implementation details' },
    { value: 'developers', label: 'For developers', icon: 'ti-code', hint: 'What changed and where', text: 'developers: concrete, with the names of the modules that changed' },
  ];

  /** Values come from the page: treat them as data from outside and keep only what you expect. */
  function absorb(values) {
    if (!values || typeof values !== 'object') return;
    if ('version' in values) state.version = String(values.version || '').slice(0, 40);
    if ('audience' in values && AUDIENCES.some((a) => a.value === values.audience)) state.audience = values.audience;
    if ('notes' in values) state.notes = String(values.notes || '').slice(0, 200000);
    if ('fileName' in values) state.fileName = String(values.fileName || '').slice(0, 120);
  }

  function prompt() {
    const audience = AUDIENCES.find((a) => a.value === state.audience).text;
    return [
      'Write release notes in Markdown' + (state.version ? ' for version ' + state.version : '') + '.',
      'Audience: ' + audience + '.',
      'Start with a single "# " title, then group under "## New", "## Changed" and "## Fixed". Use only the groups that apply.',
      'One short bullet per change. Skip merges, version bumps and CI chores. Never invent a change.',
      'Output ONLY the Markdown document.',
      '',
      'Commits of the repository "' + state.repo.name + '":',
      ...state.commits.map((c) => '- ' + c.shortHash + ' ' + c.message + ' (' + c.relativeDate + ')'),
    ].join('\n');
  }

  function view() {
    const left = [
      // `repo` is drawn by PromptOps. The person picks a folder and the plugin receives a handle, never a path.
      { type: 'field', kind: 'repo', id: 'repo', label: 'Repository', live: true, value: state.repo, help: 'The release notes are written from its recent commits.' },
    ];
    if (state.repo) {
      left.push({ type: 'list', empty: 'This repository has no commits yet.', items: state.commits.map((c) => ({ title: c.message, subtitle: c.shortHash + ' · ' + c.relativeDate, icon: 'ti-git-commit' })) });
      left.push({ type: 'field', kind: 'text', id: 'version', label: 'Version', placeholder: '1.4.0', half: true, value: state.version });
      left.push({ type: 'field', kind: 'choice', id: 'audience', label: 'Who reads them?', value: state.audience, options: AUDIENCES.map((a) => ({ value: a.value, label: a.label, icon: a.icon, hint: a.hint })) });
      left.push({ type: 'actions', items: [{ id: 'generate', label: state.notes ? 'Write again' : 'Write release notes', style: 'primary', icon: 'ti-sparkles', disabled: !state.commits.length }] });
    }

    const right = [];
    if (state.notice) right.push({ type: 'notice', tone: state.notice.tone, text: state.notice.text });
    if (!state.notes) {
      right.push({ type: 'text', muted: true, text: 'The release notes appear here. You see the full prompt and confirm it before anything runs.' });
    } else {
      right.push({ type: 'output', id: 'notes', label: 'Markdown', text: state.notes, editable: true, mono: true });
      right.push({ type: 'field', kind: 'text', id: 'fileName', label: 'Save in docs/ of ' + state.repo.name, value: state.fileName });
      right.push({ type: 'actions', items: [{ id: 'save', label: 'Save to repository', icon: 'ti-device-floppy' }] });
    }
    return { title: 'Release Notes', subtitle: 'From the commits of a repository to release notes, on your own Claude.', blocks: [{ type: 'columns', columns: [left, right] }] };
  }

  promptops.pages.register({
    // The person opened the menu entry. Return the page.
    async open(pageId) {
      if (pageId !== PAGE) throw new Error('unknown page');
      state.notice = null;
      return view();
    },

    // The person clicked a button (`action`) or changed a `live` field (`change`). `values` holds the whole form.
    async event(pageId, ev, sdk) {
      if (pageId !== PAGE) throw new Error('unknown page');
      const values = (ev && ev.values) || {};
      absorb(values);
      state.notice = null;
      try {
        if ('repo' in values && (values.repo && values.repo.handle) !== (state.repo && state.repo.handle)) {
          state.repo = values.repo && typeof values.repo.handle === 'string' ? { handle: values.repo.handle, name: String(values.repo.name || '').slice(0, 120) } : null;
          state.commits = state.repo ? await sdk.git.log(state.repo.handle, 15) : [];
        }
        if (ev.type === 'action' && ev.id === 'generate') {
          // PromptOps shows this prompt to the person and runs it only on a yes. The model has no tools.
          const res = await sdk.ai.generate({ prompt: prompt() });
          state.notes = String(res.text || '').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
          if (!state.fileName) state.fileName = 'release-' + (state.version || 'notes').replace(/[^A-Za-z0-9._-]/g, '-') + '.md';
        }
        if (ev.type === 'action' && ev.id === 'save') {
          const name = state.fileName.trim().replace(/[\\/\s]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '') || 'release-notes.md';
          const path = 'docs/' + (/\.(md|markdown|txt)$/i.test(name) ? name : name + '.md');
          // Only docs/ can be written, and the person confirms every file.
          await sdk.workspace.writeFile(state.repo.handle, path, state.notes.replace(/\s+$/, '') + '\n');
          state.notice = { tone: 'success', text: 'Saved as ' + state.repo.name + '/' + path };
        }
      } catch (e) {
        const message = String(e && e.message || e);
        // A "no" from the person is not a failure.
        state.notice = /^(user_denied|confirm_timeout)\b/.test(message) ? { tone: 'info', text: 'Canceled. Nothing was run or written.' } : { tone: 'danger', text: message };
      }
      return view();
    },
  });
})();
