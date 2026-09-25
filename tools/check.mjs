#!/usr/bin/env node
/**
 * Static verification for the extension.
 *
 * There is no Chrome in this environment, so this stands in for "does it load":
 * it syntax-checks every module, resolves every import and every asset path,
 * validates the manifest, and enforces the Manifest V3 content-security rules
 * that silently break an extension at load time (inline scripts, inline
 * handlers). Run it before every commit.
 *
 *   node tools/check.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');

const errors = [];
const warnings = [];
const notes = [];

const fail = (file, message) => errors.push(`${relative(ROOT, file)}: ${message}`);
const warn = (file, message) => warnings.push(`${relative(ROOT, file)}: ${message}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(EXT);
const scripts = files.filter((file) => extname(file) === '.js');
const pages = files.filter((file) => extname(file) === '.html');
const styles = files.filter((file) => extname(file) === '.css');

// ----------------------------------------------------------------- 1. syntax

const scratch = mkdtempSync(join(tmpdir(), 'billed-check-'));

for (const file of scripts) {
  const temp = join(scratch, `${Buffer.from(relative(EXT, file)).toString('hex')}.mjs`);
  writeFileSync(temp, readFileSync(file));
  try {
    execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '' } });
  } catch (error) {
    const detail = String(error.stderr || error.message).split('\n').filter(Boolean).slice(0, 4).join(' | ');
    fail(file, `syntax error → ${detail}`);
  }
}

// ----------------------------------------------------------------- 2. imports

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  const specifiers = new Set();
  for (const match of source.matchAll(IMPORT_RE)) specifiers.add(match[1]);
  for (const match of source.matchAll(DYNAMIC_RE)) specifiers.add(match[1]);

  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      fail(file, `bare import "${specifier}" — an extension has no bundler, every import must be relative`);
      continue;
    }
    const target = resolve(dirname(file), specifier);
    if (!existsSync(target)) fail(file, `import target missing: ${specifier}`);
  }

  // Duplicate named imports from the same module are a hard SyntaxError in
  // strict ESM, and easy to introduce while refactoring.
  const seen = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    for (const name of names) {
      if (seen.has(name)) fail(file, `"${name}" imported twice (from ${seen.get(name)} and ${match[2]})`);
      else seen.set(name, match[2]);
    }
  }
}

// ----------------------------------------------------------------- 3. pages

for (const file of pages) {
  const source = readFileSync(file, 'utf8');

  for (const match of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1];
    const body = match[2].trim();
    if (body) fail(file, 'inline <script> body — blocked by the Manifest V3 CSP');
    if (!/\ssrc\s*=/.test(attrs)) fail(file, '<script> without src');
    if (!/type\s*=\s*["']module["']/.test(attrs)) {
      warn(file, '<script> is not type="module"; imports will fail');
    }
  }

  for (const match of source.matchAll(/\son[a-z]+\s*=\s*["']/g)) {
    fail(file, `inline event handler (${match[0].trim()}) — blocked by the Manifest V3 CSP`);
  }

  for (const match of source.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']/g)) {
    const value = match[1];
    if (/^(https?:|data:|mailto:|chrome-extension:)/.test(value) || !value) continue;
    const target = resolve(dirname(file), value);
    if (!existsSync(target)) fail(file, `asset missing: ${value}`);
  }
}

// ----------------------------------------------------------------- 4. manifest

const manifestPath = join(EXT, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(manifestPath, `invalid JSON: ${error.message}`);
}

if (manifest) {
  const required = ['manifest_version', 'name', 'version', 'description', 'icons', 'background', 'action'];
  for (const key of required) {
    if (manifest[key] === undefined) fail(manifestPath, `missing required key: ${key}`);
  }
  if (manifest.manifest_version !== 3) fail(manifestPath, 'manifest_version must be 3');

  // Chrome Web Store hard limits.
  if (String(manifest.name).length > 45) fail(manifestPath, `name is ${manifest.name.length} chars, limit is 45`);
  if (String(manifest.description).length > 132) {
    fail(manifestPath, `description is ${manifest.description.length} chars, limit is 132`);
  }
  if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) fail(manifestPath, 'version must be 1-4 dot-separated integers');

  const referenced = [];
  for (const path of Object.values(manifest.icons || {})) referenced.push(path);
  for (const path of Object.values(manifest.action?.default_icon || {})) referenced.push(path);
  if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);
  if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
  if (manifest.options_ui?.page) referenced.push(manifest.options_ui.page);
  for (const script of manifest.content_scripts || []) {
    referenced.push(...(script.js || []), ...(script.css || []));
  }

  for (const path of referenced) {
    if (!existsSync(join(EXT, path))) fail(manifestPath, `references a missing file: ${path}`);
  }

  if (manifest.background && manifest.background.type !== 'module') {
    fail(manifestPath, 'background.type must be "module" because the worker uses ES imports');
  }

  // Permission hygiene: anything broad needs a deliberate justification.
  const broad = ['<all_urls>', 'webNavigation', 'history', 'cookies', 'debugger', 'management', 'proxy'];
  for (const permission of [...(manifest.permissions || []), ...(manifest.host_permissions || [])]) {
    if (broad.includes(permission)) warn(manifestPath, `broad permission "${permission}" will slow review`);
  }
  if (manifest.host_permissions?.length) {
    warn(manifestPath, 'host_permissions at install time; prefer optional_host_permissions');
  }
  notes.push(`permissions: ${(manifest.permissions || []).join(', ') || 'none'}`);
  notes.push(`optional: ${[...(manifest.optional_permissions || []), ...(manifest.optional_host_permissions || [])].join(', ') || 'none'}`);
}

// ----------------------------------------------------------------- 5. css refs

for (const file of styles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const value = match[1];
    if (/^(https?:|data:)/.test(value)) continue;
    if (!existsSync(resolve(dirname(file), value))) fail(file, `css url() missing: ${value}`);
  }
}

// ----------------------------------------------------------------- 6. enum contracts

/**
 * Catch `MSG.typo` and `STOP_REASONS.blurred` — property accesses on the
 * enum-like objects that carry the message and state contracts. These fail
 * silently at runtime (undefined, not an error), which is the worst kind.
 * Aliases map a local import name onto the object that defines the keys.
 */
const ENUMS = {
  MSG: 'MSG',
  ACTIONS: 'ACTIONS',
  REASONS: 'REASONS',
  STOP_REASONS: 'REASONS',
  LICENSE_STATUS: 'LICENSE_STATUS',
  KEYS: 'KEYS',
};

const enumKeys = new Map();
for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  for (const name of new Set(Object.values(ENUMS))) {
    // Match `export const NAME = { ... };` up to the first closing brace at
    // the start of a line, which is enough for these flat objects.
    const match = source.match(new RegExp(`export const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`));
    if (!match) continue;
    const keys = [...match[1].matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*:/g)].map((entry) => entry[1]);
    if (keys.length) enumKeys.set(name, new Set(keys));
  }
}

for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  for (const [alias, target] of Object.entries(ENUMS)) {
    const keys = enumKeys.get(target);
    if (!keys) continue;
    for (const match of source.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)\\b`, 'g'))) {
      const key = match[1];
      if (!keys.has(key)) fail(file, `${alias}.${key} does not exist on ${target}`);
    }
  }
}

if (enumKeys.size) notes.push(`enum contracts verified: ${[...enumKeys.keys()].join(', ')}`);

// ----------------------------------------------------------------- 7. landing page

const WEB = join(ROOT, 'web');
if (existsSync(WEB)) {
  const webFiles = walk(WEB);
  for (const file of webFiles.filter((entry) => extname(entry) === '.html')) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
      const value = match[1];
      if (/^(https?:|data:|mailto:|#)/.test(value) || !value) continue;
      const target = resolve(dirname(file), value.split('#')[0]);
      if (!existsSync(target)) fail(file, `asset missing: ${value}`);
    }
  }
  for (const file of webFiles.filter((entry) => extname(entry) === '.js')) {
    const temp = join(scratch, `web-${Buffer.from(relative(WEB, file)).toString('hex')}.js`);
    writeFileSync(temp, readFileSync(file));
    try {
      execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '' } });
    } catch (error) {
      const detail = String(error.stderr || error.message).split('\n').filter(Boolean).slice(0, 4).join(' | ');
      fail(file, `syntax error → ${detail}`);
    }
    if (readFileSync(file, 'utf8').includes('PLACEHOLDER')) {
      notes.push(`${relative(ROOT, file)} still contains PLACEHOLDER values (see docs/PAYMENTS_SETUP.md)`);
    }
  }
}

// ----------------------------------------------------------------- 7. launch TODOs

for (const file of [...scripts, ...pages]) {
  const source = readFileSync(file, 'utf8');
  if (source.includes('PLACEHOLDER')) {
    notes.push(`${relative(ROOT, file)} still contains PLACEHOLDER values (see docs/PAYMENTS_SETUP.md)`);
  }
}

// ----------------------------------------------------------------- report

const counts = `${scripts.length} modules, ${pages.length} pages, ${styles.length} stylesheets`;
console.log(`Checked ${counts}\n`);

if (notes.length) {
  console.log('Notes:');
  for (const note of notes) console.log(`  · ${note}`);
  console.log('');
}

if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log('');
}

if (errors.length) {
  console.log('Errors:');
  for (const error of errors) console.log(`  ✗ ${error}`);
  console.log(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}

console.log('No problems found.');
