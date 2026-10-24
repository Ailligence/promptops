import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assetName, compareVersions, releaseBase, signatureMatchesVersion, signedVersion, tagFor, PUBLIC_KEY } from '../lib/release.mjs';
import { hasherFor, parsePublicKey, parseSignature, verifySignature } from '../lib/minisign.mjs';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/promptops.mjs', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** A minisign key pair and a signer producing Tauri-style (base64-wrapped) .sig files. */
function minisignKeys(keyId = Buffer.from('0123456789abcdef', 'hex')) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const pub = `untrusted comment: test key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`;
  const signFile = (data, file = 'f') => {
    const digest = createHash('blake2b512').update(data).digest();
    const signature = sign(null, digest, privateKey);
    const trusted = `timestamp:1\tfile:${file}`;
    const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey);
    const text = `untrusted comment: test\n${Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`;
    return Buffer.from(text).toString('base64');
  };
  return { pub: Buffer.from(pub).toString('base64'), signFile };
}

const digest = (sigText, data) => hasherFor(parseSignature(sigText)).update(data).digest();

test('the release tag and installer name follow the package version', () => {
  assert.equal(tagFor('2.1.7'), 'v2.1.7');
  assert.equal(releaseBase('2.1.7', {}), 'https://github.com/shellonback/promptops/releases/download/v2.1.7');
  assert.equal(assetName('2.1.7', 'darwin', 'arm64'), 'PromptOps-Desktop-v2-2.1.7-aarch64.app.tar.gz');
  assert.equal(assetName('2.1.7', 'win32', 'x64'), 'PromptOps-Desktop-v2-2.1.7-x64-setup.exe');
  assert.equal(assetName('2.1.7', 'linux', 'x64'), 'PromptOps-Desktop-v2-2.1.7-x86_64.AppImage');
  assert.equal(assetName('2.1.7', 'freebsd', 'x64'), null);
});

test('versions compare numerically', () => {
  assert.equal(compareVersions('2.1.10', '2.1.9'), 1);
  assert.equal(compareVersions('2.1.7', '2.1.7'), 0);
  assert.equal(compareVersions('2.0.13', '2.1.0'), -1);
});

test('the embedded release key parses', () => {
  assert.equal(parsePublicKey(PUBLIC_KEY).keyId.toString('hex'), 'f20f8259448ff57e');
});

test('a minisign signature verifies only for the same file and the same key', () => {
  const keys = minisignKeys();
  const other = minisignKeys();
  const sig = keys.signFile('installer bytes');
  const pub = parsePublicKey(keys.pub);
  assert.equal(verifySignature(pub, parseSignature(sig), digest(sig, 'installer bytes')), true);
  assert.equal(verifySignature(pub, parseSignature(sig), digest(sig, 'installer bytez')), false);
  assert.equal(verifySignature(parsePublicKey(other.pub), parseSignature(sig), digest(sig, 'installer bytes')), false);
});

test('a forged trusted comment breaks the signature', () => {
  const keys = minisignKeys();
  const sig = keys.signFile('x', 'PromptOps.exe');
  const forged = Buffer.from(Buffer.from(sig, 'base64').toString().replace('file:PromptOps.exe', 'file:other.exe')).toString('base64');
  assert.equal(verifySignature(parsePublicKey(keys.pub), parseSignature(forged), digest(forged, 'x')), false);
});

test('the version in a signed trusted comment must be the package version', () => {
  // Trusted comments of the real v2.1.7 release assets.
  assert.equal(signedVersion('timestamp:1792502162\tfile:PromptOps Desktop_2.1.7_x64-setup.exe'), '2.1.7');
  assert.equal(signedVersion('timestamp:1792503674\tfile:PromptOps Desktop_2.1.7_amd64.AppImage'), '2.1.7');
  assert.equal(signedVersion('timestamp:1792501788\tfile:PromptOps Desktop.app.tar.gz'), null);
  assert.equal(signedVersion('timestamp:1\tfile:PromptOps Desktop_2.2.0-beta.1_x64-setup.exe'), '2.2.0-beta.1');
  assert.equal(signatureMatchesVersion('timestamp:1\tfile:PromptOps Desktop_2.1.7_x64-setup.exe', '2.1.7'), true);
  assert.equal(signatureMatchesVersion('timestamp:1\tfile:PromptOps Desktop.app.tar.gz', '2.1.7'), true);
  assert.equal(signatureMatchesVersion('timestamp:1\tfile:PromptOps Desktop_2.1.6_x64-setup.exe', '2.1.7'), false);
});

function releaseServer(files) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('/').pop());
    if (!(name in files)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': Buffer.byteLength(files[name]) });
    res.end(files[name]);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const name = assetName(pkg.version, process.platform, process.arch);

test('an installer signed with any other key is refused and deleted', { skip: !name && 'no build for this platform' }, async (t) => {
  const attacker = minisignKeys(Buffer.from('f20f8259448ff57e', 'hex'));
  const server = await releaseServer({ [`${name}.sig`]: attacker.signFile('evil'), [name]: 'evil' });
  const home = mkdtempSync(join(tmpdir(), 'promptops-npm-'));
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });
  const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CACHE_HOME: home, PROMPTOPS_RELEASES_URL: `http://127.0.0.1:${server.address().port}` };
  await assert.rejects(run(process.execPath, [bin, '--download-only'], { env }), (error) => /not signed by the PromptOps release key/.test(error.stderr));
  const cache = process.platform === 'darwin' ? join(home, 'Library', 'Caches', 'promptops-npm') : process.platform === 'win32' ? join(home, 'promptops-npm') : join(home, 'promptops-npm');
  assert.deepEqual(existsSync(cache) ? readdirSync(cache) : [], [], 'nothing is left in the cache');
});

test('an installer signed for another version is refused before downloading it', { skip: !name && 'no build for this platform' }, async (t) => {
  const keys = minisignKeys(Buffer.from('f20f8259448ff57e', 'hex'));
  let installerRequested = false;
  const server = await releaseServer({ [`${name}.sig`]: keys.signFile('old', 'PromptOps Desktop_0.0.1_x64-setup.exe'), get [name]() { installerRequested = true; return 'old'; } });
  const home = mkdtempSync(join(tmpdir(), 'promptops-npm-'));
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });
  const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CACHE_HOME: home, PROMPTOPS_RELEASES_URL: `http://127.0.0.1:${server.address().port}` };
  await assert.rejects(run(process.execPath, [bin, '--download-only'], { env }), (error) => /is for PromptOps Desktop 0\.0\.1, not /.test(error.stderr));
  assert.equal(installerRequested, false);
});

test('a version without a download says so', { skip: !name && 'no build for this platform' }, async (t) => {
  const server = await releaseServer({});
  t.after(() => server.close());
  const env = { ...process.env, PROMPTOPS_RELEASES_URL: `http://127.0.0.1:${server.address().port}` };
  await assert.rejects(run(process.execPath, [bin, '--download-only'], { env }), (error) => /has no download for/.test(error.stderr));
});

test('--version prints the package version and unknown flags are refused', async () => {
  assert.equal((await run(process.execPath, [bin, '--version'])).stdout.trim(), pkg.version);
  await assert.rejects(run(process.execPath, [bin, '--nope']), (error) => /Unknown option: --nope/.test(error.stderr));
});
