'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../src/main/watchdog-core.cjs');

const MIN = 60_000;

test('a crash is a non-zero code or a signal; a clean exit is not', () => {
  assert.equal(w.isCrash(1, undefined), true);
  assert.equal(w.isCrash(0, 11), true, 'killed by a signal reports code 0');
  assert.equal(w.isCrash(0, 0), false);
  assert.equal(w.isCrash(0, undefined), false);
});

test('revives back off, then stop after maxPerHour', () => {
  const now = 10 * 60 * MIN;
  assert.deepEqual(w.decide([], now, undefined), { revive: true, delayMs: 5000, attempt: 1 });
  assert.deepEqual(w.decide([now - MIN], now, {}), { revive: true, delayMs: 30000, attempt: 2 });
  assert.deepEqual(w.decide([now - 2 * MIN, now - MIN], now, {}), { revive: true, delayMs: 120000, attempt: 3 });
  assert.deepEqual(w.decide([now - 3 * MIN, now - 2 * MIN, now - MIN], now, {}), { revive: false, reason: 'too-many', recent: 3 });
});

test('only the last hour counts', () => {
  const now = 10 * 60 * MIN;
  const old = [now - 61 * MIN, now - 70 * MIN, now - 90 * MIN];
  assert.equal(w.decide(old, now, {}).revive, true);
  assert.deepEqual(w.prune([...old, now - MIN], now), [now - MIN]);
});

test('settings: off, a custom cap, nonsense falls back', () => {
  const now = 10 * 60 * MIN;
  assert.deepEqual(w.decide([], now, { enabled: false }), { revive: false, reason: 'off', recent: 0 });
  assert.equal(w.decide([now - MIN], now, { maxPerHour: 1 }).revive, false);
  assert.equal(w.sanitize({ maxPerHour: 'lots' }).maxPerHour, 3);
  assert.equal(w.sanitize({ maxPerHour: 99 }).maxPerHour, 3);
  assert.equal(w.sanitize(null).enabled, true);
});

test('the crash excerpt keeps the last readable lines without terminal codes', () => {
  const tail = '\x1b[2J\x1b[H\x1b[32m✓ ready\x1b[0m\r\n\r\n   \r\nError: something broke\r\n    at main (cli.js:1:2)\r\n\x1b[?25h';
  assert.equal(w.crashExcerpt(tail), '✓ ready\nError: something broke\nat main (cli.js:1:2)');
  assert.equal(w.crashExcerpt(''), '');
  assert.ok(w.crashExcerpt('x'.repeat(50) + '\n' + 'y'.repeat(500), 100).length <= 100);
});

test('the give-up message names the agent, escapes HTML and quotes the excerpt', () => {
  const ru = w.formatGiveUp({ name: 'Kelly <QA>', agentId: 'kelly', exitCode: 1, recent: 3, excerpt: 'Error: <boom>' }, 'ru');
  assert.match(ru, /Kelly &lt;QA&gt;/);
  assert.match(ru, /code 1/);
  assert.match(ru, /<pre>Error: &lt;boom&gt;<\/pre>/);
  const en = w.formatGiveUp({ agentId: 'god', signal: 9, recent: 3, excerpt: '' }, 'en');
  assert.match(en, /god keeps crashing<\/b> \(signal 9\)/);
  assert.ok(!en.includes('<pre>'));
});
