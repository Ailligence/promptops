// SDK injected by PromptOps into every plugin iframe, BEFORE the bundle.
// The only channel to the outside is postMessage to the host page.
(() => {
  'use strict';
  const pending = new Map();
  const activators = [];
  const actions = new Map();
  const contributions = new Map(); // section -> contract implementation
  const listeners = new Map();     // event -> [handler]
  let seq = 0;

  const contribute = (kind) => (impl) => { if (impl && typeof impl === 'object') contributions.set(kind, impl); };

  const call = (method, params) => new Promise((resolve, reject) => {
    const callId = ++seq;
    pending.set(callId, { resolve, reject });
    parent.postMessage({ __po: 'call', callId, method, params: params || {} }, '*');
  });

  addEventListener('message', async (ev) => {
    if (ev.source !== parent || !ev.data || typeof ev.data !== 'object') return;
    const msg = ev.data;
    if (msg.__po === 'result') {
      const p = pending.get(msg.callId);
      if (!p) return;
      pending.delete(msg.callId);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'denied'));
    } else if (msg.__po === 'action') {
      const fn = actions.get(msg.actionId);
      if (!fn) return;
      try { await fn(msg.context || {}, sdk); } catch (e) { call('log', { message: 'action ' + msg.actionId + ' failed: ' + (e && e.message || e) }); }
    } else if (msg.__po === 'invoke') {
      // The app calls a method of the section contract; the result is DATA only:
      // the app draws it, the plugin never brings its own UI.
      let reply;
      try {
        const impl = contributions.get(msg.kind);
        if (!impl || typeof impl[msg.method] !== 'function') throw new Error('not implemented: ' + msg.kind + '.' + msg.method);
        const result = await impl[msg.method](...(Array.isArray(msg.args) ? msg.args : []), sdk);
        reply = { ok: true, result: result === undefined ? null : result };
      } catch (e) {
        reply = { ok: false, error: String(e && e.message || e) };
      }
      parent.postMessage(Object.assign({ __po: 'invokeResult', invokeId: msg.invokeId }, reply), '*');
    } else if (msg.__po === 'event') {
      for (const fn of listeners.get(msg.name) || []) {
        try { await fn(msg.payload || {}, sdk); } catch (e) { call('log', { message: 'event ' + msg.name + ' failed: ' + (e && e.message || e) }); }
      }
    }
  });

  const sdk = Object.freeze({
    http: Object.freeze({ fetch: (url, init) => call('http.fetch', Object.assign({ url: String(url) }, init || {})) }),
    storage: Object.freeze({
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.set', { key, value: null }),
    }),
    config: Object.freeze({ get: () => call('config.get') }),
    notify: Object.freeze({ toast: (message) => call('notify.toast', { message: String(message) }) }),
    prompt: Object.freeze({ propose: (text, title) => call('prompt.propose', { text: String(text), title: title ? String(title) : '' }) }),
    // `pages` section. `repo` is the handle that comes from the `repo` field type: the user picks it.
    git: Object.freeze({
      status: (repo) => call('git.status', { repo }),
      log: (repo, limit) => call('git.log', { repo, limit: limit || 20 }),
      diff: (repo, opts) => call('git.diff', { repo, staged: !!(opts && opts.staged) }),
    }),
    // Only `docs/*.md|markdown|txt`. The user sees the content and confirms every file.
    workspace: Object.freeze({ writeFile: (repo, path, content) => call('workspace.writeFile', { repo, path: String(path), content: String(content) }) }),
    // The model runs without tools and returns text. The user sees the prompt and confirms every request.
    ai: Object.freeze({
      generate: (opts) => call('ai.generate', typeof opts === 'string' ? { prompt: opts } : { prompt: String(opts && opts.prompt || ''), model: opts && opts.model || undefined }),
      // Speed measurements. The prompt belongs to PromptOps: the plugin picks the models from the list and receives only numbers.
      // Progress arrives via promptops.events.on('benchmark.progress', handler).
      benchmarkModels: () => call('ai.benchmarkModels'),
      benchmark: (models) => call('ai.benchmark', { models: Array.isArray(models) ? models.map(String) : [] }),
    }),
    pages: Object.freeze({ update: (pageId, view) => call('pages.update', { pageId: String(pageId), view }) }),
    log: (...args) => call('log', { message: args.map(String).join(' ') }),
  });

  Object.defineProperty(globalThis, 'promptops', {
    value: Object.freeze({
      sdk,
      onActivate: (fn) => { if (typeof fn === 'function') activators.push(fn); },
      actions: Object.freeze({ register: (id, fn) => { if (typeof fn === 'function') actions.set(String(id), fn); } }),
      // Contracts per section. A plugin can register only the one of its OWN category.
      tasks: Object.freeze({ registerSource: contribute('tasks') }),
      context: Object.freeze({ registerProvider: contribute('context') }),
      code: Object.freeze({ registerHost: contribute('code') }),
      data: Object.freeze({ registerExplorer: contribute('data') }),
      providers: Object.freeze({ registerUsage: contribute('providers') }),
      // A menu item of its own: the plugin describes the page as DATA, the app draws it.
      pages: Object.freeze({ register: contribute('pages') }),
      // Buttons in the row below the composer. `action(buttonId, ctx)` answers with ONE proposal:
      // { insert } | { prompt, target } | { spawn } | { panel } | { toast }. The app runs it, with confirmation.
      session: Object.freeze({ registerButtons: contribute('session') }),
      // App events: metadata only, never prompt text, responses or code.
      events: Object.freeze({ on: (name, fn) => {
        if (typeof fn !== 'function') return;
        const key = String(name);
        listeners.set(key, (listeners.get(key) || []).concat(fn));
      } }),
    }),
    writable: false, configurable: false,
  });

  // After the bundle has registered its handlers
  addEventListener('load', () => setTimeout(async () => {
    for (const fn of activators) {
      try { await fn(sdk); } catch (e) { call('log', { message: 'activate failed: ' + (e && e.message || e) }); }
    }
    parent.postMessage({
      __po: 'ready',
      contributions: Array.from(contributions, ([kind, impl]) => ({ kind, methods: Object.keys(impl).filter((k) => typeof impl[k] === 'function') })),
      events: Array.from(listeners.keys()),
      actions: Array.from(actions.keys()),
    }, '*');
  }, 0));
})();
