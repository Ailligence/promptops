/**
 * Renderer-side guard that watches outbound xterm data, buffering printable
 * characters and bracketed-paste blocks. When a complete command line matches
 * a shell pattern, it signals the caller to intercept (open SmartActionModal).
 *
 * MUST stay in sync with DIRECT_COMMAND_REGEX in
 * apps/desktop/src-tauri/src/commands/smart_context.rs (`matches_direct_command`).
 */
const DIRECT_COMMAND_REGEX =
  /^(npm\s+(run\s+)?|yarn\s+|pnpm\s+(run\s+)?|npx\s+|make\s*|docker\s+(compose\s+)?|node\s+|python3?\s+|pip3?\s+|cargo\s+|go\s+|\.\/|sh\s+|bash\s+|zsh\s+|git\s+|curl\s+|wget\s+|php\s+|artisan\s+|composer\s+)/i;

const SHELL_PREFIX_FIRST_CHARS = new Set([
  'n', 'y', 'p', 'm', 'd', 'g', 'c', 'w', 's', 'b', 'z', '.', '/', 'a', 'f',
  // Uppercase variants for safety on TUIs that send uppercase
  'N', 'Y', 'P', 'M', 'D', 'G', 'C', 'W', 'S', 'B', 'Z', 'A', 'F',
]);

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface GuardResult {
  /** Bytes the caller should still forward to the PTY. May be empty. */
  forward: string;
  /** Present when a command is detected and modal should be shown. */
  intercept?: {
    command: string;
    isPaste: boolean;
  };
}

export class TerminalCommandGuard {
  private typingBuffer = '';
  private typingActive = false;

  processOutbound(data: string): GuardResult {
    // Bracketed-paste detection: handle complete paste blocks first.
    // Single-call paste is the common case for xterm.js.
    if (data.startsWith(PASTE_START) && data.endsWith(PASTE_END)) {
      const inner = data.slice(PASTE_START.length, data.length - PASTE_END.length);
      if (!inner.includes('\n') && !inner.includes('\r') && DIRECT_COMMAND_REGEX.test(inner)) {
        // Reset typing too, in case paste arrived mid-typing.
        this.resetTyping();
        return { forward: '', intercept: { command: inner, isPaste: true } };
      }
      // Multiline or non-command paste → forward intact.
      this.resetTyping();
      return { forward: data };
    }

    // Typing path (single char from keystroke).
    if (data === '\r') {
      const command = this.typingBuffer;
      this.resetTyping();
      if (command && DIRECT_COMMAND_REGEX.test(command)) {
        return { forward: '', intercept: { command, isPaste: false } };
      }
      return { forward: '\r' };
    }

    if (data.length === 1 && data >= ' ' && data <= '~') {
      // Printable ASCII char.
      if (!this.typingActive) {
        if (SHELL_PREFIX_FIRST_CHARS.has(data)) {
          this.typingActive = true;
          this.typingBuffer = data;
        }
      } else {
        this.typingBuffer += data;
      }
      return { forward: data };
    }

    // Anything non-printable while typing → reset (backspace, arrows, Esc, Ctrl-U, Ctrl-C, …).
    if (this.typingActive) {
      this.resetTyping();
    }
    return { forward: data };
  }

  private resetTyping(): void {
    this.typingBuffer = '';
    this.typingActive = false;
  }
}
