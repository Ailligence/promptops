#!/usr/bin/env node
// `npx @shellonback/promptops`: installs and opens PromptOps Desktop, the
// ready-to-run edition, at the version of this package. The installer comes
// from GitHub Releases and must carry a valid signature from the PromptOps
// release key before anything is installed. Nothing else is sent anywhere.
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { once } from 'node:events';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { assetName, compareVersions, releaseBase, signatureMatchesVersion, signedVersion, tagFor, PUBLIC_KEY, REPO } from '../lib/release.mjs';
import { hasherFor, parsePublicKey, parseSignature, verifySignature } from '../lib/minisign.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version;
const args = process.argv.slice(2);
const OPTIONS = ['--download-only', '--install-only'];

const HELP = `PromptOps Desktop ${version}

Usage: npx @shellonback/promptops [options]

Downloads PromptOps Desktop ${version} for this computer from
https://github.com/${REPO}/releases/tag/${tagFor(version)},
checks its signature against the PromptOps release key, then installs and opens it.

Options:
  --download-only   download and verify the installer, print its path, stop
  --install-only    install (macOS) or prepare it, without opening it
  --version         print the version
  --help            show this help
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cacheDir() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'promptops-npm');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'promptops-npm');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'promptops-npm');
}

async function fetchText(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) fail(`Download failed (${response.status}): ${url}`);
  return response.text();
}

async function digestOf(path, signature) {
  const hash = hasherFor(signature);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest();
}

async function download(url, target, publicKey, signature) {
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`Download failed (${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const part = `${target}.part`;
  const out = createWriteStream(part);
  const hash = hasherFor(signature);
  let received = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
    if (process.stderr.isTTY && total) process.stderr.write(`\rDownloading PromptOps Desktop ${Math.floor((received / total) * 100)}%`);
  }
  out.end();
  await once(out, 'finish');
  if (process.stderr.isTTY && total) process.stderr.write('\n');
  if (!verifySignature(publicKey, signature, hash.digest())) {
    rmSync(part, { force: true });
    fail('The download is not signed by the PromptOps release key, so it was deleted. Nothing was installed.');
  }
  renameSync(part, target);
}

function macVersion(app) {
  try {
    return execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** An installed PromptOps Desktop at this version or newer, if any. */
function installedMacApp() {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    const app = join(dir, 'PromptOps Desktop.app');
    const found = macVersion(app);
    if (found && compareVersions(found, version) >= 0) return { app, version: found };
  }
  return null;
}

function installMac(archive) {
  const work = mkdtempSync(join(tmpdir(), 'promptops-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', work]);
    const app = readdirSync(work).find((name) => name.endsWith('.app'));
    if (!app) fail('The archive does not contain the app.');
    const target = join(homedir(), 'Applications', app);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    execFileSync('ditto', [join(work, app), target]);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** True when libfuse 2, which an AppImage needs to mount itself, is installed. */
function hasFuse2() {
  try {
    if (/libfuse\.so\.2\b/.test(execFileSync('ldconfig', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))) return true;
  } catch {
    // no ldconfig on PATH: look in the usual places
  }
  return ['/lib', '/usr/lib', '/lib64', '/usr/lib64', `/usr/lib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu`, `/lib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu`]
    .some((dir) => existsSync(join(dir, 'libfuse.so.2')));
}

function launch(command, commandArgs = [], env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore', env });
    child.once('error', (error) => fail(`Could not open ${command}: ${error.message}`));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) return process.stdout.write(HELP);
  if (args.includes('--version') || args.includes('-v')) return process.stdout.write(`${version}\n`);
  const unknown = args.filter((a) => !OPTIONS.includes(a));
  if (unknown.length) fail(`Unknown option: ${unknown[0]}\n\n${HELP}`);
  const downloadOnly = args.includes('--download-only');
  const open = !downloadOnly && !args.includes('--install-only');

  if (process.platform === 'darwin' && !downloadOnly) {
    const installed = installedMacApp();
    if (installed) {
      if (open) await launch('open', [installed.app]);
      return process.stdout.write(`PromptOps Desktop ${installed.version} is already installed in ${installed.app}.${open ? ' Opening it.' : ''}\n`);
    }
  }

  const name = assetName(version, process.platform, process.arch);
  if (!name) fail(`PromptOps Desktop has no build for ${process.platform}/${process.arch}.\nThe open-source edition builds from source: https://github.com/${REPO}#open-source-edition--build-it-yourself`);
  const base = releaseBase(version);
  const signatureText = await fetchText(`${base}/${name}.sig`);
  if (signatureText === null) fail(`PromptOps Desktop ${version} has no download for ${process.platform}/${process.arch}.\nSee https://github.com/${REPO}/releases`);
  const publicKey = parsePublicKey(PUBLIC_KEY);
  const signature = parseSignature(signatureText);
  if (!signatureMatchesVersion(signature.trustedComment, version)) {
    fail(`The signature on the server is for PromptOps Desktop ${signedVersion(signature.trustedComment)}, not ${version}. Nothing was installed.`);
  }

  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  if (!existsSync(file) || !verifySignature(publicKey, signature, await digestOf(file, signature))) {
    await download(`${base}/${name}`, file, publicKey, signature);
  }
  if (downloadOnly) return process.stdout.write(`${file}\n`);

  if (process.platform === 'darwin') {
    const app = installMac(file);
    if (open) await launch('open', [app]);
    return process.stdout.write(`PromptOps Desktop ${version} is in ${app}.${open ? ' Opening it.' : ''}\n`);
  }
  if (process.platform === 'win32') {
    if (open) await launch(file);
    return process.stdout.write(open ? `The PromptOps Desktop ${version} installer is open.\n` : `Installer ready: ${file}\n`);
  }
  chmodSync(file, 0o755);
  // Without libfuse 2 (not installed by default on recent Ubuntu) the AppImage
  // exits at once; extracting it to a temporary folder works without FUSE.
  if (open) await launch(file, [], hasFuse2() ? process.env : { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' });
  process.stdout.write(`${open ? 'Opening' : 'Ready:'} PromptOps Desktop ${version} from ${file}.\n`);
}

main().catch((error) => fail(`PromptOps: ${error?.message || error}`));
