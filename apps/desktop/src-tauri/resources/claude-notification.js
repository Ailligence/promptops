#!/usr/bin/env node
/**
 * PromptOps Claude Code Hook Script
 *
 * Called by Claude Code CLI for Notification, Stop, and PreToolUse events.
 * Reads JSON from stdin, forwards it to the PromptOps HookServer via HTTP.
 *
 * Environment variables (embedded in the command by PromptOps):
 *   PROMPTOPS_HOOK_PORT     – HookServer HTTP port
 *   PROMPTOPS_SESSION_ID    – PromptOps session ID
 *   PROMPTOPS_WORKSPACE     – Workspace path
 *   PROMPTOPS_HOOK_HOSTS    – optional comma-separated host candidates
 *                             (WSL: the server runs on the Windows side, so
 *                             127.0.0.1 only works on WSL1/mirrored — NAT
 *                             needs the vEthernet gateway IP). Defaults to
 *                             127.0.0.1.
 */

const http = require('http');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    // Timeout safety — never hang Claude CLI
    setTimeout(() => resolve(data), 4000);
  });
}

function postOnce(hostname, port, body, timeout) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname,
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          // Per-launch token of the app: only processes it started can post events.
          'X-PromptOps-Token': process.env.PROMPTOPS_CTL_TOKEN || '',
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', () => resolve(null)); // Silently fail — never crash Claude
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

async function postToServer(hosts, port, payload) {
  const body = JSON.stringify(payload);
  // Short per-host timeout when there are fallbacks: the total must stay
  // under the 5s hook timeout Claude enforces on blocking PreToolUse.
  const timeout = hosts.length > 1 ? 1500 : 3000;
  for (const host of hosts) {
    const data = await postOnce(host, port, body, timeout);
    if (data !== null) return data;
  }
  return undefined;
}

// ── Gemini CLI / Antigravity (`--provider gemini|agy --event <name>`) ──────
// Installed in the CLI's GLOBAL hook config (~/.gemini/settings.json,
// ~/.gemini/config/hooks.json), so it also runs outside PromptOps: there it
// must be a pure no-op. Events are translated into the Claude Code shape the
// HookServer already understands.

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] || '' : '';
}

const GEMINI_EVENTS = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  BeforeAgent: 'UserPromptSubmit',
  AfterAgent: 'Stop',
  BeforeTool: 'PreToolUse',
  AfterTool: 'PostToolUse',
  Notification: 'Notification',
};
const AGY_EVENTS = {
  SessionStart: 'SessionStart',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  Stop: 'Stop',
};

/** Neutral stdout per CLI: agy REQUIRES a decision on PreToolUse and Stop. */
function providerReply(flavor, nativeEvent, autoApprove) {
  if (flavor !== 'agy') return '{}';
  // "allow" = no opinion (next hook / default policy); "auto_approve" still
  // honors explicit user rules.
  if (nativeEvent === 'PreToolUse') return JSON.stringify({ decision: autoApprove ? 'auto_approve' : 'allow' });
  if (nativeEvent === 'Stop') return JSON.stringify({ decision: 'stop' });
  return '{}';
}

/** Native event → Claude-shaped event, or null when there is nothing to report. */
function normalizeProviderEvent(flavor, nativeEvent, ev) {
  if (flavor === 'gemini') {
    const name = GEMINI_EVENTS[nativeEvent || ev.hook_event_name];
    if (!name) return null;
    return {
      hook_event_name: name,
      promptops_provider: 'gemini-cli',
      // No session_id: gemini cannot resume by id (`--resume latest|<index>`),
      // so it must never become the session's resume key.
      provider_session_id: ev.session_id,
      cwd: ev.cwd,
      tool_name: ev.tool_name,
      tool_input: ev.tool_input,
      last_assistant_message: typeof ev.prompt_response === 'string' ? ev.prompt_response : undefined,
      notification_type: ev.notification_type === 'ToolPermission' ? 'permission_prompt' : ev.notification_type,
      message: ev.message,
      title: ev.notification_type === 'ToolPermission' ? 'Gemini requires input' : undefined,
      reason: ev.reason,
    };
  }
  if (flavor === 'agy') {
    const name = AGY_EVENTS[nativeEvent];
    if (!name) return null;
    // Stop with background tasks still running is not "finished".
    if (name === 'Stop' && ev.fullyIdle === false) return null;
    const call = ev.toolCall || {};
    return {
      hook_event_name: name,
      promptops_provider: 'antigravity',
      // `agy --conversation <id>` resumes by id: this IS the resume key.
      session_id: ev.conversationId,
      cwd: Array.isArray(ev.workspacePaths) ? ev.workspacePaths[0] : undefined,
      tool_name: call.name,
      tool_input: call.args,
      reason: ev.terminationReason,
      // Model actually serving the turn (follows `/model` inside the TUI).
      model: typeof ev.modelName === 'string' ? ev.modelName : undefined,
    };
  }
  return null;
}

async function providerMain(flavor) {
  const nativeEvent = argValue('--event');
  let autoApprove = false;
  try {
    const raw = await readStdin();
    const port = parseInt(process.env.PROMPTOPS_HOOK_PORT, 10);
    // Only the PromptOps session running THIS CLI reports: a gemini/agy run
    // nested in another session's terminal inherits PROMPTOPS_SESSION_ID and
    // would otherwise hijack that session's status and resume key.
    if (port && process.env.PROMPTOPS_HOOK_PROVIDER === flavor && raw && raw.trim()) {
      const event = normalizeProviderEvent(flavor, nativeEvent, JSON.parse(raw));
      if (event) {
        const hosts = String(process.env.PROMPTOPS_HOOK_HOSTS || '127.0.0.1')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean);
        const response = await postToServer(hosts, port, {
          type: 'claude.hook',
          sessionId: process.env.PROMPTOPS_SESSION_ID || '',
          workspace: process.env.PROMPTOPS_WORKSPACE || '',
          timestamp: new Date().toISOString(),
          event,
        });
        if (response && event.hook_event_name === 'PreToolUse') {
          try {
            autoApprove = !!JSON.parse(response).autoApprove;
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // Never break the CLI
  }
  process.stdout.write(providerReply(flavor, nativeEvent, autoApprove));
  process.exit(0);
}

async function main() {
  const flavor = argValue('--provider');
  if (flavor) return providerMain(flavor);
  try {
    const port = parseInt(process.env.PROMPTOPS_HOOK_PORT, 10);
    const sessionId = process.env.PROMPTOPS_SESSION_ID || '';
    const workspace = process.env.PROMPTOPS_WORKSPACE || '';
    const hosts = String(process.env.PROMPTOPS_HOOK_HOSTS || '127.0.0.1')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    if (!port) {
      process.exit(0); // No port → nothing to do
    }

    const raw = await readStdin();
    if (!raw || !raw.trim()) {
      process.exit(0);
    }

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      process.exit(0); // Malformed JSON → skip silently
    }

    const payload = {
      type: 'claude.hook',
      sessionId,
      workspace,
      timestamp: new Date().toISOString(),
      event,
    };

    const response = await postToServer(hosts, port, payload);

    // PreToolUse: if the server says auto-approve, tell Claude Code to skip the permission prompt.
    //
    // Current Claude Code contract (the one that actually works on recent CLIs):
    //   { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
    // The legacy top-level `{ decision: 'approve' }` is silently ignored by recent
    // versions — emitting it alone is why auto-approve stopped working after a CLI
    // upgrade. We emit BOTH keys: new CLIs read `hookSpecificOutput`, older CLIs read
    // `decision`. The keys are independent, so this is safe across versions.
    if (response && event.hook_event_name === 'PreToolUse') {
      try {
        const parsed = JSON.parse(response);
        if (parsed.autoApprove) {
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: 'Auto-approved by PromptOps',
              },
              decision: 'approve',
            }),
          );
        }
      } catch {
        // Response not parseable — continue normally
      }
    }
  } catch {
    // Never crash Claude CLI
  }

  process.exit(0);
}

main();
