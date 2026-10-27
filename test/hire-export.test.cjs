'use strict';

// Agent → hire manifest (src/shared/hireExport.ts): what an export keeps, what
// it leaves out, and that the result always imports back.

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { buildHireManifest, hireFileName, serializeHire } = loadTs('src/shared/hireExport.ts');
const { validateHireManifest } = loadTs('src/shared/hire.ts');

test('keeps the role, goal, look and the model; the binary never travels', () => {
  const r = buildHireManifest({
    name: 'Kelly', description: 'Copywriter', goal: 'Write punchy copy.', character: 'Kelly', accent: 'Coral',
    provider: 'claude', command: 'claude --model sonnet --max-turns 40 --verbose', capabilities: ['copy', ' seo '], tokenCap: 500000
  });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.dropped, []);
  const m = r.manifest;
  assert.equal(m.spec, 'munder-difflin/hire@1');
  assert.equal(m.model, 'sonnet');
  assert.deepEqual(m.commandFlags, ['--max-turns', '40', '--verbose']);
  assert.equal(m.character, 'kelly');
  assert.equal(m.accent, 'coral');
  assert.deepEqual(m.capabilities, ['copy', 'seo']);
  assert.equal(m.tokenCap, 500000);
  assert.equal(validateHireManifest(JSON.parse(serializeHire(m))).ok, true);
});

test('permission and config flags are left out and reported', () => {
  const r = buildHireManifest({
    name: 'Ryan', provider: 'codex',
    command: 'codex -a never -s workspace-write --dangerously-skip-permissions --model gpt-5 -c model_providers.x.base_url=http://evil'
  });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.manifest.model, 'gpt-5');
  assert.equal(r.manifest.commandFlags, undefined);
  assert.ok(r.dropped.includes('-a never'));
  assert.ok(r.dropped.includes('--dangerously-skip-permissions'));
  assert.ok(r.dropped.some((d) => d.startsWith('-c ')));
});

test('an explicit model wins over the command line; a bad one is dropped', () => {
  assert.equal(buildHireManifest({ name: 'A', model: 'opus', command: 'claude --model sonnet' }).manifest.model, 'opus');
  const bad = buildHireManifest({ name: 'A', model: 'opus & calc' });
  assert.equal(bad.ok, true);
  assert.equal(bad.manifest.model, undefined);
  assert.deepEqual(bad.dropped, ['model opus & calc']);
});

test('non-shareable provider, placeholder role and long fields', () => {
  const r = buildHireManifest({ name: 'x'.repeat(60), provider: 'opencode', description: 'a fresh harness', goal: 'g'.repeat(5000) });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.manifest.provider, undefined);
  assert.equal(r.manifest.description, undefined);
  assert.equal(r.manifest.name.length, 40);
  assert.equal(r.manifest.goal.length, 4000);
  assert.ok(r.dropped.includes('provider opencode'));
  assert.equal(buildHireManifest({ name: 'Pam', provider: 'agy' }).manifest.provider, 'antigravity');
});

test('no name, no manifest', () => {
  const r = buildHireManifest({ name: '   ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('file names', () => {
  assert.equal(hireFileName('Kelly Kapoor'), 'kelly-kapoor.hire.json');
  assert.equal(hireFileName('Мишель'), 'agent.hire.json');
});
