'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const c = require('../src/main/capabilities-core.cjs');

const entry = (over = {}) => ({
  id: 'sentry', name: 'Sentry MCP', kind: 'mcp-server', maker: 'Sentry', tier: 'vendor',
  source: 'https://github.com/getsentry/sentry-mcp', what: 'Reads issues and events.',
  purposes: ['observability'], worksWith: ['claude', 'codex'], licence: 'MIT', checkedAt: '2026-10-14',
  can: { reads: true, writes: false }, signIn: { kind: 'oauth', secretNames: [] },
  install: { door: 'command', steps: [{ argv: ['claude', 'mcp', 'add', '--transport', 'http', 'sentry', '--scope', 'user', 'https://mcp.sentry.dev/mcp'], label: 'Add it' }], manual: ['By hand: …'] },
  ...over
});

function signed(catalogObj, keys, over = {}) {
  const catalog = JSON.stringify(catalogObj);
  const issuedAt = '2026-10-16T16:56:30.784Z';
  const digest = crypto.createHash('sha256').update(catalog, 'utf8').digest('hex');
  const signature = crypto.sign(null, Buffer.from([c.FORMAT, issuedAt, digest].join('\n'), 'utf8'), keys.privateKey).toString('base64');
  return { format: c.FORMAT, issuedAt, catalog, signature, ...over };
}

test('envelope: signature over format, time and catalog digest', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const pub = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const env = c.readEnvelope(signed({ version: 1, entries: [] }, keys));
  assert.ok(env);
  assert.equal(c.verifyEnvelope(env, crypto, pub), true);
  assert.equal(c.verifyEnvelope({ ...env, catalog: env.catalog + ' ' }, crypto, pub), false);
  assert.equal(c.verifyEnvelope({ ...env, issuedAt: '2026-10-17T16:56:30.784Z' }, crypto, pub), false);
  // Signed by someone else: the published key refuses it.
  assert.equal(c.verifyEnvelope(env, crypto), false);
  assert.equal(c.readEnvelope({ ...signed({}, keys), format: 'other' }), null);
  assert.equal(c.readEnvelope({ ...signed({}, keys), issuedAt: 'yesterday' }), null);
  assert.equal(c.readEnvelope(null), null);
});

test('rows are cleaned; unusable ones dropped, duplicates once', () => {
  const cat = c.parseCatalog(JSON.stringify({
    version: 1, checkedAt: '2026-10-14',
    purposes: [{ id: 'observability', label: 'Monitoring' }, { bad: 1 }],
    featured: ['sentry', 'missing'],
    entries: [entry(), entry(), { id: 'Bad Id', name: 'x', kind: 'mcp-server' }, entry({ id: 'k', kind: 'rocket' }),
      entry({ id: 'evil', source: 'javascript:alert(1)', install: { door: 'command', steps: [{ argv: ['claude', 'mcp', 'add', 'x;rm', '-rf'] }] } })]
  }));
  assert.equal(cat.entries.length, 2);
  assert.deepEqual(cat.featured, ['sentry']);
  assert.equal(cat.purposes.length, 1);
  const evil = cat.entries.find((e) => e.id === 'evil');
  assert.equal(evil.source, undefined);
  assert.deepEqual(evil.install.steps, []);
  assert.equal(c.parseCatalog('not json'), null);
  assert.equal(c.parseCatalog(JSON.stringify({ version: 2, entries: [] })), null);
});

test('one-press policy: only claude mcp add / plugin install / marketplace add', () => {
  assert.equal(c.stepAllowed(['claude', 'mcp', 'add', 'sentry', 'https://x']), true);
  assert.equal(c.stepAllowed(['claude', 'plugin', 'install', 'superpowers@claude-plugins-official']), true);
  assert.equal(c.stepAllowed(['claude', 'plugin', 'marketplace', 'add', 'obra/superpowers-marketplace']), true);
  assert.equal(c.stepAllowed(['npm', 'install', '-g', 'thing']), false);
  assert.equal(c.stepAllowed(['claude', 'mcp', 'remove', 'x']), false);
  assert.equal(c.stepAllowed(['claude', 'mcp', 'add', 'x', '--dangerously-skip-permissions']), false);
  assert.equal(c.stepAllowed(['claude', 'mcp', 'add', 'x', 'a&b']), false);
  const clean = c.sanitizeEntry(entry());
  assert.equal(c.oneClickSteps(clean).length, 1);
  assert.deepEqual(c.oneClickSteps(c.sanitizeEntry(entry({ checkedAt: undefined }))), [], 'listed, not reviewed: manual only');
  const mixed = c.sanitizeEntry(entry({ install: { door: 'command', steps: [
    { argv: ['claude', 'plugin', 'marketplace', 'add', 'a/b'] }, { argv: ['npm', 'i', '-g', 'x'] }] } }));
  assert.deepEqual(c.oneClickSteps(mixed), [], 'one manual step makes the whole sequence manual');
});

test('what a step adds, and whether it is already here', () => {
  assert.equal(c.mcpNameOf(['claude', 'mcp', 'add', '--transport', 'http', 'sentry', '--scope', 'user', 'https://x']), 'sentry');
  assert.equal(c.mcpNameOf(['claude', 'mcp', 'add', '-s', 'user', 'ctx', '--', 'npx', 'pkg']), 'ctx');
  assert.equal(c.pluginNameOf(['claude', 'plugin', 'install', 'superpowers@market']), 'superpowers');
  const e = c.sanitizeEntry(entry());
  assert.equal(c.installedState(e, { mcpServers: new Set(['sentry']) }), true);
  assert.equal(c.installedState(e, { mcpServers: new Set(['other']) }), false);
  const sk = c.sanitizeEntry(entry({ id: 'sc', kind: 'skill', install: { door: 'skill-folder', url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator' } }));
  assert.equal(c.installedState(sk, { skills: new Set(['skill-creator']) }), true);
});

test('filters', () => {
  const list = [c.sanitizeEntry(entry()), c.sanitizeEntry(entry({ id: 'tool1', name: 'Grep tool', kind: 'tool', checkedAt: undefined, purposes: ['devtools'], worksWith: ['codex'] }))];
  assert.equal(c.filterEntries(list, { reviewedOnly: true }).length, 1);
  assert.equal(c.filterEntries(list, { kind: 'tool' }).length, 1);
  assert.equal(c.filterEntries(list, { purpose: 'observability' }).length, 1);
  assert.equal(c.filterEntries(list, { engine: 'claude' }).length, 1);
  assert.equal(c.filterEntries(list, { q: 'GREP' })[0].id, 'tool1');
});
