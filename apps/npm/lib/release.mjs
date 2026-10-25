// Pure helpers for the launcher: where the PromptOps Desktop release of this
// package's version lives, and which installer fits this machine. No network
// or file access here, so the rules are easy to test.

export const REPO = 'shellonback/promptops';

/**
 * Public key of the PromptOps Desktop updater. Every installer in a release
 * has a <file>.sig made with the matching private key, which only the
 * PromptOps release pipeline holds.
 */
export const PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdFRjU4RjQ0NTk4MjBGRjIKUldUeUQ0SlpSSS8xZnB2cURTNWUxRjhEOHR3a0R4ZjNvOFlMMExvdW9nS1pUdks3Mmt0QW1RVTQK';

/** Release tag for an app version: the npm package and the app share it. */
export function tagFor(version) {
  return `v${version}`;
}

/** Base URL of the release downloads (PROMPTOPS_RELEASES_URL overrides it, for tests). */
export function releaseBase(version, env = process.env) {
  const base = env.PROMPTOPS_RELEASES_URL || `https://github.com/${REPO}/releases/download`;
  return `${base.replace(/\/+$/, '')}/${tagFor(version)}`;
}

const SUFFIXES = {
  'darwin-arm64': 'aarch64.app.tar.gz',
  'darwin-x64': 'x86_64.app.tar.gz',
  'win32-x64': 'x64-setup.exe',
  'win32-arm64': 'arm64-setup.exe',
  'linux-x64': 'x86_64.AppImage',
  'linux-arm64': 'aarch64.AppImage',
};

/** Installer file name for this platform and CPU, or null when there is no build for it. */
export function assetName(version, platform, arch) {
  const suffix = SUFFIXES[`${platform}-${arch}`];
  return suffix ? `PromptOps-Desktop-v2-${version}-${suffix}` : null;
}

/**
 * Version named by a signature's trusted comment, or null when it names none.
 * The release pipeline signs each installer under its build name, such as
 * "file:PromptOps Desktop_2.1.7_x64-setup.exe" (the macOS archive carries no
 * version), and the trusted comment is covered by the signature.
 */
export function signedVersion(trustedComment) {
  const file = /(?:^|\t)file:([^\t]*)/.exec(String(trustedComment))?.[1] ?? '';
  return /_(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)_/.exec(file)?.[1] ?? null;
}

/**
 * False when the signature was made for another version: a validly signed
 * older installer served in place of this one is a downgrade, not this release.
 */
export function signatureMatchesVersion(trustedComment, version) {
  const signed = signedVersion(trustedComment);
  return signed === null || signed === version;
}

/** Compares release versions, including prereleases: -1, 0 or 1. */
export function compareVersions(a, b) {
  const parse = (version) => {
    const value = String(version).split('+', 1)[0];
    const dash = value.indexOf('-');
    return {
      core: (dash < 0 ? value : value.slice(0, dash)).split('.').map(Number),
      pre: dash < 0 ? null : value.slice(dash + 1).split('.'),
    };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const x = left.core[i] || 0;
    const y = right.core[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (left.pre === null || right.pre === null) {
    return left.pre === right.pre ? 0 : left.pre === null ? 1 : -1;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const x = left.pre[i];
    const y = right.pre[i];
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    const order = xNumeric ? Number(x) - Number(y) : x === y ? 0 : x < y ? -1 : 1;
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}
