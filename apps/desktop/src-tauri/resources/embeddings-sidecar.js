#!/usr/bin/env node
/**
 * embeddings-sidecar.js — Node sidecar for the semantic module (semantic.rs).
 *
 * Contract (see semantic.rs, "SIDECAR seam" section):
 *   stdin  → { "texts": ["...", "..."] }        (one JSON line)
 *   stdout ← { "vectors": [[f32; 384], ...] }   (same order)
 *   error  ← { "error": "message" }
 *
 * Model: Xenova/all-MiniLM-L6-v2, quantized,
 * pooling 'mean', normalize true (dim 384). The first run downloads ~80MB into
 * the transformers.js cache dir, then it stays cached.
 *
 * Resolution of @xenova/transformers (in order):
 *   1. env PROMPTOPS_SIDECAR_NODE_MODULES (path to a node_modules folder)
 *   2. node_modules next to the script
 *
 * Never the process cwd: the app inherits whatever directory it was launched
 * from (a cloned repository, $HOME), and importing a package found there
 * would run that directory's code inside the sidecar.
 */
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');
const { createRequire } = require('module');

function fail(message) {
  process.stdout.write(JSON.stringify({ error: String(message) }) + '\n');
  process.exit(0); // the contract is "error on stdout", not exit code
}

function resolveTransformers() {
  const candidates = [];
  if (process.env.PROMPTOPS_SIDECAR_NODE_MODULES) {
    candidates.push(process.env.PROMPTOPS_SIDECAR_NODE_MODULES);
  }
  candidates.push(path.join(__dirname, 'node_modules'));
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      const req = createRequire(path.join(dir, 'noop.js'));
      return req.resolve('@xenova/transformers');
    } catch (_) {
      /* try the next one */
    }
  }
  return null;
}

async function main() {
  // Read all of stdin (the caller closes the stream after the JSON line).
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return fail('empty request');

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    return fail('bad request JSON: ' + err.message);
  }
  const texts = Array.isArray(request.texts) ? request.texts : null;
  if (!texts) return fail("request missing 'texts' array");
  if (texts.length === 0) {
    process.stdout.write(JSON.stringify({ vectors: [] }) + '\n');
    return;
  }

  const resolved = resolveTransformers();
  if (!resolved) {
    return fail(
      '@xenova/transformers not found — set PROMPTOPS_SIDECAR_NODE_MODULES ' +
        'or npm install it next to the sidecar',
    );
  }

  let pipeline;
  try {
    ({ pipeline } = await import(url.pathToFileURL(resolved).href));
  } catch (err) {
    return fail('import transformers failed: ' + err.message);
  }

  try {
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    // Batches of 32 texts per pipeline call.
    const vectors = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      const dims = output.dims; // [batch, 384]
      const flat = output.data;
      for (let row = 0; row < dims[0]; row++) {
        vectors.push(Array.from(flat.slice(row * dims[1], (row + 1) * dims[1])));
      }
    }
    process.stdout.write(JSON.stringify({ vectors: vectors }) + '\n');
  } catch (err) {
    return fail('embedding failed: ' + err.message);
  }
}

main().catch((err) => fail(err && err.message ? err.message : err));
