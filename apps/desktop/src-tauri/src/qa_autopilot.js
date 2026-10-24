// QA autopilot: runs a plan of UI steps inside the app, for end-to-end checks.
//
// Compiled into debug builds only, and active only with PROMPTOPS_DEMO=1 (a
// sandbox HOME) and PROMPTOPS_QA_PLAN=<plan.json>; see demo_mode.rs. The plan
// is data: a fixed set of DOM actions, no code to evaluate.
//
// Plan: { "run": "unique-id", "steps": [ ... ] }. Steps:
//   { "wait": 500 }                              pause (ms)
//   { "waitText": "Sessions", "timeout": 15000 } wait until the page shows the text
//   { "waitSelector": "css", "timeout": 15000 }  wait until an element exists
//   { "click": "css" }                           click the first match
//   { "clickText": "New workspace", "within": "css" }  click the visible element with that text
//   { "type": "hello", "into": "css" }           set the value of an input (or the focused one)
//   { "key": "Enter" }                           key press on the focused element
//   { "check": "css" } / { "uncheck": "css" }    set a checkbox, if it is not already
//   { "expectText": "text" }                     fail unless the page shows the text
//   { "expectNoText": "text" }                   fail if the page shows the text
//   { "stubFolder": "/path/to/dir" }             the folder picker returns this folder
//   { "stubFile": "/path/to/file" }              the backup file dialog returns this path
//   { "scroll": "css" }                          scroll the first match into view
//   { "note": "label" }                          label shown in the overlay
// Any step can carry "optional": true: if it fails, the plan goes on.
// The overlay in the bottom-right corner shows progress and the final result,
// so a window screenshot is enough to read it.
(function () {
  var plan = window.__PROMPTOPS_QA_PLAN__;
  if (!plan || !Array.isArray(plan.steps)) return;
  var doneKey = 'promptops.qa.done.' + String(plan.run || 'default');
  try { if (sessionStorage.getItem(doneKey)) return; } catch (e) {}

  var overlay;
  function show(text, tone) {
    if (!document.body) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-qa-overlay', '');
      overlay.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;padding:8px 12px;border-radius:8px;font:12px/1.4 ui-monospace,monospace;color:#fff;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(overlay);
    }
    overlay.style.background = tone === 'fail' ? '#b42318' : tone === 'ok' ? '#067647' : 'rgba(20,20,30,0.85)';
    overlay.textContent = text;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pageText() { return document.body ? document.body.innerText : ''; }
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  async function until(check, timeout, what) {
    var end = Date.now() + (timeout || 15000);
    while (Date.now() < end) {
      var v = check();
      if (v) return v;
      await sleep(150);
    }
    throw new Error('timed out waiting for ' + what);
  }
  function byText(text, within) {
    var root = within ? document.querySelector(within) : document;
    if (!root) return null;
    var nodes = root.querySelectorAll('button, a, [role="button"], [role="menuitem"], label, li, span, div');
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || (el.innerText || '').trim() !== text) continue;
      // Prefer the deepest match, then climb to the clickable ancestor.
      if (!best || best.contains(el)) best = el;
    }
    return best ? (best.closest('button, a, [role="button"], [role="menuitem"]') || best) : null;
  }
  function setValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function step(s) {
    if ('wait' in s) return sleep(Number(s.wait) || 0);
    if ('note' in s) return;
    if ('waitText' in s) return until(function () { return pageText().indexOf(s.waitText) >= 0; }, s.timeout, '"' + s.waitText + '"');
    if ('waitSelector' in s) return until(function () { return document.querySelector(s.waitSelector); }, s.timeout, s.waitSelector);
    if ('click' in s) {
      var el = await until(function () { return document.querySelector(s.click); }, s.timeout, s.click);
      el.click();
      return;
    }
    if ('clickText' in s) {
      var target = await until(function () { return byText(s.clickText, s.within); }, s.timeout, 'text "' + s.clickText + '"');
      target.click();
      return;
    }
    if ('type' in s) {
      var input = s.into ? await until(function () { return document.querySelector(s.into); }, s.timeout, s.into) : document.activeElement;
      if (!input || !('value' in input)) throw new Error('no input to type into');
      input.focus();
      setValue(input, String(s.type));
      return;
    }
    if ('check' in s || 'uncheck' in s) {
      var sel = s.check || s.uncheck;
      var box = await until(function () { return document.querySelector(sel); }, s.timeout, sel);
      if (box.checked !== ('check' in s)) box.click();
      return;
    }
    if ('key' in s) {
      var t = document.activeElement || document.body;
      ['keydown', 'keyup'].forEach(function (type) {
        t.dispatchEvent(new KeyboardEvent(type, { key: s.key, bubbles: true, cancelable: true }));
      });
      return;
    }
    if ('expectText' in s) {
      if (pageText().indexOf(s.expectText) < 0) throw new Error('missing text "' + s.expectText + '"');
      return;
    }
    if ('expectNoText' in s) {
      if (pageText().indexOf(s.expectNoText) >= 0) throw new Error('unexpected text "' + s.expectNoText + '"');
      return;
    }
    if ('stubFolder' in s) {
      var path = String(s.stubFolder);
      var name = path.split('/').filter(Boolean).pop() || path;
      window.promptops.selectWorkspace = function () { return Promise.resolve({ path: path, name: name }); };
      return;
    }
    if ('scroll' in s) {
      var box2 = await until(function () { return document.querySelector(s.scroll); }, s.timeout, s.scroll);
      box2.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if ('stubFile' in s) {
      var file = String(s.stubFile);
      window.promptops.localBackupPickFile = function () { return Promise.resolve(file); };
      return;
    }
    throw new Error('unknown step ' + JSON.stringify(s));
  }

  async function run() {
    await until(function () { return document.body && window.promptops; }, 30000, 'the app');
    var label = '';
    for (var i = 0; i < plan.steps.length; i++) {
      var s = plan.steps[i];
      if (s.note) label = s.note;
      show('QA ' + (plan.run || '') + ' · ' + (i + 1) + '/' + plan.steps.length + (label ? ' · ' + label : ''));
      try {
        await step(s);
      } catch (e) {
        if (s.optional) continue;
        window.__PROMPTOPS_QA_RESULT__ = { ok: false, step: i + 1, error: String(e && e.message || e) };
        show('QA FAILED at step ' + (i + 1) + (label ? ' (' + label + ')' : '') + '\n' + (e && e.message || e), 'fail');
        return;
      }
    }
    window.__PROMPTOPS_QA_RESULT__ = { ok: true, steps: plan.steps.length };
    show('QA passed: ' + plan.steps.length + ' steps', 'ok');
    try { sessionStorage.setItem(doneKey, '1'); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
