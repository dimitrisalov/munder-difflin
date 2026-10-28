// Every pure .cjs core the main process requires at run time must be copied
// into out/main by tools/copy-main-assets.cjs: the bundler leaves a bare
// require('./x.cjs') alone, so a core missing from that list builds fine and
// then the office dies on start with "Cannot find module" (hang-guard-core.cjs
// on the PC, 28.10).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const MAIN = join(ROOT, 'src', 'main');

test('every .cjs the main process requires is copied into out/main', () => {
  const copier = readFileSync(join(ROOT, 'tools', 'copy-main-assets.cjs'), 'utf8');
  const required = new Set();
  for (const f of readdirSync(MAIN).filter((n) => n.endsWith('.ts'))) {
    for (const m of readFileSync(join(MAIN, f), 'utf8').matchAll(/require\(\s*['"]\.\/([\w.-]+\.cjs)['"]\s*\)/g)) required.add(m[1]);
  }
  assert.ok(required.size > 5, 'found the cores');
  for (const name of required) {
    assert.ok(copier.includes(`'src/main/${name}', 'out/main/${name}'`), `${name} is missing from tools/copy-main-assets.cjs`);
  }
});
