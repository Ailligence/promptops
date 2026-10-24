// Verifies the minisign signatures that the Tauri updater attaches to every
// PromptOps Desktop installer (<file>.sig). Only Node's crypto is used.
//
// Public key text:  "untrusted comment: ...\n" + base64("Ed" | key id (8) | Ed25519 key (32))
// Signature text:   "untrusted comment: ...\n" + base64(alg (2) | key id (8) | signature (64))
//                   + "\ntrusted comment: ...\n" + base64(global signature (64))
// "ED" signs BLAKE2b-512(file); the global signature covers signature | trusted comment.
import { createHash, createPublicKey, verify } from 'node:crypto';

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

function lines(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Tauri stores both the key and the .sig files base64-encoded once more. */
function unwrap(text) {
  const raw = String(text).trim();
  if (raw.startsWith('untrusted comment:')) return raw;
  return Buffer.from(raw, 'base64').toString('utf8');
}

export function parsePublicKey(text) {
  const [, b64] = lines(unwrap(text));
  const bytes = Buffer.from(b64 || '', 'base64');
  if (bytes.length !== 42 || bytes.subarray(0, 2).toString() !== 'Ed') throw new Error('not a minisign public key');
  return {
    keyId: bytes.subarray(2, 10),
    key: createPublicKey({ key: Buffer.concat([SPKI_ED25519, bytes.subarray(10)]), format: 'der', type: 'spki' }),
  };
}

export function parseSignature(text) {
  const all = lines(unwrap(text));
  const bytes = Buffer.from(all[1] || '', 'base64');
  const trusted = all[2] || '';
  if (bytes.length !== 74 || !trusted.startsWith('trusted comment: ')) throw new Error('not a minisign signature');
  return {
    algorithm: bytes.subarray(0, 2).toString(),
    keyId: bytes.subarray(2, 10),
    signature: bytes.subarray(10),
    trustedComment: trusted.slice('trusted comment: '.length),
    globalSignature: Buffer.from(all[3] || '', 'base64'),
  };
}

/** Hash a file needs for a signature: BLAKE2b-512 for "ED" (prehashed), none for legacy "Ed". */
export function hasherFor(signature) {
  if (signature.algorithm === 'ED') return createHash('blake2b512');
  throw new Error(`unsupported signature algorithm ${signature.algorithm}`);
}

/** True when `digest` (from hasherFor) is signed by the key, trusted comment included. */
export function verifySignature(publicKey, signature, digest) {
  if (!publicKey.keyId.equals(signature.keyId)) return false;
  if (!verify(null, digest, publicKey.key, signature.signature)) return false;
  const signedComment = Buffer.concat([signature.signature, Buffer.from(signature.trustedComment)]);
  return verify(null, signedComment, publicKey.key, signature.globalSignature);
}
