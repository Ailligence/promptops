import { buildInstallScript, npmInstallCommand } from './install-scripts';

/**
 * Regression guard for the Windows execution-policy fix.
 *
 * On win32 the install terminal is PowerShell: a bare `npm` resolves to the
 * npm.ps1 shim, which the default execution policy blocks ("running scripts
 * is disabled on this system"). Every npm invocation generated for win32
 * must therefore call `npm.cmd`, while macOS/Linux keep the bare `npm`.
 */
describe('install-scripts — win32 npm.cmd invariant', () => {
  const NPM_PROVIDERS: Array<[string, string]> = [
    ['claude-code-cli', '@anthropic-ai/claude-code'],
    ['codex', '@openai/codex'],
    ['gemini-cli', '@google/gemini-cli'],
  ];

  for (const [provider, pkg] of NPM_PROVIDERS) {
    it(`win32 auto-install for ${provider} uses npm.cmd and never bare npm`, () => {
      const script = buildInstallScript(provider, 'win32');
      expect(script).toContain(`npm.cmd install -g ${pkg}`);
      expect(script).not.toContain('npm install -g');
    });

    it(`darwin/linux auto-install for ${provider} keeps bare npm (npm.cmd does not exist there)`, () => {
      for (const platform of ['darwin', 'linux']) {
        const script = buildInstallScript(provider, platform);
        expect(script).toContain(`npm install -g ${pkg}`);
        expect(script).not.toContain('npm.cmd');
      }
    });
  }

  it('win32 script is typed into the PTY line by line (CR-joined, trailing CR)', () => {
    const script = buildInstallScript('claude-code-cli', 'win32');
    expect(script.endsWith('\r')).toBeTrue();
    expect(script).not.toContain('\n');
  });

  it('copilot installs the copilot CLI the app runs (npm @github/copilot), not the gh extension', () => {
    const copilotWin = buildInstallScript('copilot', 'win32');
    expect(copilotWin).toContain('npm.cmd install -g @github/copilot');
    expect(copilotWin).not.toContain('gh extension');
    for (const platform of ['darwin', 'linux']) {
      expect(buildInstallScript('copilot', platform)).toContain('install -g @github/copilot');
    }
  });

  it('cursor scripts are npm-free', () => {

    const cursor = buildInstallScript('cursor', 'darwin');
    expect(cursor).toContain('https://cursor.com');
    expect(cursor).not.toContain('npm');
  });

  it('cursor installs the CLI the app runs (cursor-agent), not the editor, and has no Windows script', () => {
    for (const platform of ['darwin', 'linux']) {
      expect(buildInstallScript('cursor', platform)).toContain('curl https://cursor.com/install -fsS | bash');
    }
    expect(buildInstallScript('cursor', 'win32')).toBe('');
  });

  it('npm scripts keep the terminal on stdin (fd 3) and use sudo on Linux only for a root-owned prefix', () => {
    const mac = buildInstallScript('codex', 'darwin');
    expect(mac.startsWith("bash /dev/fd/3 3<< 'PROMPTOPS_INSTALL'")).toBeTrue();
    expect(mac).not.toContain('sudo npm');
    const linux = buildInstallScript('codex', 'linux');
    expect(linux).toContain('if [ -w "$(npm prefix -g)" ]; then npm install -g @openai/codex; else sudo npm install -g @openai/codex; fi');
    expect(linux).toContain('setup_22.x');
  });

  it('unknown provider yields an empty script', () => {
    expect(buildInstallScript('generic-shell', 'win32')).toBe('');
  });
});

describe('install-scripts — manual-tab npm command', () => {
  const pkg = '@anthropic-ai/claude-code';

  it('matches the platform pill: sudo on linux, npm.cmd on win32, bare npm on darwin', () => {
    expect(npmInstallCommand('linux', pkg)).toBe(`sudo npm install -g ${pkg}`);
    expect(npmInstallCommand('win32', pkg)).toBe(`npm.cmd install -g ${pkg}`);
    expect(npmInstallCommand('darwin', pkg)).toBe(`npm install -g ${pkg}`);
  });
});
