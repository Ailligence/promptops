// Pure builders for the provider install guide. On win32 the install terminal
// is PowerShell, where a bare `npm` resolves to the npm.ps1 shim and the
// default execution policy blocks it ("running scripts is disabled on this
// system") — always call npm.cmd there.

const NPM_PACKAGES: Record<string, string> = {
  'claude-code-cli': '@anthropic-ai/claude-code',
  'codex': '@openai/codex',
  'gemini-cli': '@google/gemini-cli',
  // The app runs the `copilot` binary (session.rs provider_command), which
  // is this package — not `gh` with the old gh-copilot extension.
  'copilot': '@github/copilot',
};

/** One-line npm install command for the manual tab (shown text = executed text). */
export function npmInstallCommand(platform: string, pkg: string): string {
  if (platform === 'linux') return `sudo npm install -g ${pkg}`;
  if (platform === 'win32') return `npm.cmd install -g ${pkg}`;
  return `npm install -g ${pkg}`;
}

export function buildInstallScript(provider: string, platform: string): string {
  const pkg = NPM_PACKAGES[provider];

  if (pkg) {
    if (platform === 'win32') {
      return [
        '& {',
        '  $ErrorActionPreference = "Stop"',
        '  Write-Host "=== PromptOps Auto-Installer ===" -ForegroundColor Cyan',
        '  if (!(Get-Command node -ErrorAction SilentlyContinue)) {',
        '    Write-Host "Node.js not found. Installing..." -ForegroundColor Yellow',
        '    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
        '    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")',
        '  } else {',
        '    Write-Host "Node.js found" -ForegroundColor Green',
        '  }',
        `  Write-Host "Installing ${pkg}..." -ForegroundColor Yellow`,
        `  npm.cmd install -g ${pkg}`,
        '  Write-Host ""',
        '  Write-Host "Done! Click Retry to verify." -ForegroundColor Green',
        '}',
      ].join('\r') + '\r';
    }

    // macOS or Linux
    const nodeInstall = platform === 'darwin'
      ? [
          'if ! command -v node &>/dev/null; then',
          '  echo "Node.js not found. Installing via Homebrew..."',
          '  if ! command -v brew &>/dev/null; then',
          '    echo "Homebrew not found. Installing..."',
          '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          // Apple silicon installs to /opt/homebrew, Intel Macs to /usr/local.
          '    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"',
          '  fi',
          '  brew install node',
          'else',
          '  echo "Node.js $(node --version) found"',
          'fi',
        ]
      : [
          // NodeSource's setup script is Debian/Ubuntu only: use the distro's
          // own package on Fedora/RHEL and Arch, and stop with a clear message
          // elsewhere instead of failing halfway.
          'if ! command -v node &>/dev/null; then',
          '  if command -v apt-get &>/dev/null; then',
          '    echo "Node.js not found. Installing via NodeSource..."',
          '    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
          '    sudo apt-get install -y nodejs',
          '  elif command -v dnf &>/dev/null; then',
          '    echo "Node.js not found. Installing with dnf..."',
          '    sudo dnf install -y nodejs npm',
          '  elif command -v pacman &>/dev/null; then',
          '    echo "Node.js not found. Installing with pacman..."',
          '    sudo pacman -S --needed --noconfirm nodejs npm',
          '  else',
          '    echo "Node.js not found. Install Node.js 22 or newer (https://nodejs.org), then click Retry."',
          '    exit 1',
          '  fi',
          'else',
          '  echo "Node.js $(node --version) found"',
          'fi',
        ];

    // A system-wide Node (NodeSource, apt) has a root-owned global prefix:
    // use sudo only then, as the manual tab does on Linux.
    const npmInstall = platform === 'linux'
      ? [`if [ -w "$(npm prefix -g)" ]; then npm install -g ${pkg}; else sudo npm install -g ${pkg}; fi`]
      : [`npm install -g ${pkg}`];

    // Read the script from fd 3 so Homebrew, sudo and npm keep the PTY on
    // stdin: with the script on stdin the Homebrew installer runs
    // non-interactively and aborts at its sudo prompt.
    return [
      "bash /dev/fd/3 3<< 'PROMPTOPS_INSTALL'",
      'set -e',
      'echo "=== PromptOps Auto-Installer ==="',
      'echo ""',
      ...nodeInstall,
      'echo ""',
      `echo "Installing ${pkg}..."`,
      ...npmInstall,
      'echo ""',
      'echo "Done! Click Retry to verify."',
      'PROMPTOPS_INSTALL',
    ].join('\r') + '\r';
  }

  // Cursor: the app runs the Cursor CLI (`cursor-agent`), installed by
  // Cursor's script on macOS and Linux. On Windows it is installed by hand.
  if (provider === 'cursor') {
    if (platform === 'win32') return '';
    return [
      "bash /dev/fd/3 3<< 'PROMPTOPS_INSTALL'",
      'set -e',
      'echo "=== PromptOps Auto-Installer ==="',
      'echo ""',
      'echo "Installing the Cursor CLI (cursor-agent)..."',
      'curl https://cursor.com/install -fsS | bash',
      'echo ""',
      'echo "Done! Click Retry to verify."',
      'PROMPTOPS_INSTALL',
    ].join('\r') + '\r';
  }

  return '';
}
