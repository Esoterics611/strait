#!/usr/bin/env node
/**
 * ARCH-1 Phase 2, rule (c): no raw `process.env` access in src/ outside the
 * two sanctioned env boundaries. CLAUDE.md §12 makes ISecretProvider the
 * Vault swap point; the ConfigModule factory is the only other place env is
 * read (it produces the typed AppConfig). Every other module must go through
 * ISecretProvider.get() or injected AppConfig — never process.env directly.
 *
 * dependency-cruiser can't see this (process.env is not an import edge), so
 * this tiny zero-dependency check enforces it. Run by `npm run lint:boundaries`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// The only files allowed to read process.env directly.
const ALLOW = new Set(
  [
    'src/secrets/env-secret.provider.ts', // the ISecretProvider impl (Vault swap point)
    'src/config/app-config.factory.ts', // the ConfigModule typed factory
  ].map((p) => p.replace(/\//g, path.sep)),
);

/** @type {string[]} */
const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue; // tests may stub env
    const rel = path.relative(ROOT, full);
    if (ALLOW.has(rel)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (/process\.env\b/.test(text)) offenders.push(rel.replace(/\\/g, '/'));
  }
}

walk(SRC);

if (offenders.length > 0) {
  console.error(
    'BOUNDARY VIOLATION (c): raw process.env outside the sanctioned config ' +
      'boundary. Use ISecretProvider.get() or injected AppConfig instead.\n' +
      offenders.map((f) => '  - ' + f).join('\n'),
  );
  process.exit(1);
}

console.log('boundaries: process.env check OK (only the sanctioned config boundary reads env)');
