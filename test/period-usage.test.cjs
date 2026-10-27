'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PeriodUsage, PERIODS, evaluateLimits, alertKey, sanitizeLimits, RETAIN_MS } = require('../src/main/periodUsage.cjs');

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

function row(agent, session, ts, input, output = 0, cacheCreation = 0, cacheRead = 0) {
  return { agent_id: agent, session_id: session, ts, input, output, cache_creation: cacheCreation, cache_read: cacheRead };
}

test('deltas between cumulative rows, cache reads kept out of work', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('kelly', 's1', NOW - 3 * H, 100, 50, 10, 1000));
  u.ingestRow(row('kelly', 's1', NOW - 2 * H, 300, 150, 30, 5000));
  const { floor, agents } = u.usage(NOW, PERIODS['5h']);
  assert.equal(agents.get('kelly').work, 480);
  assert.equal(agents.get('kelly').total, 5480);
  assert.deepEqual(floor, { work: 480, total: 5480 });
});

test('a counter that drops (app restart) counts from zero again', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('ryan', 's1', NOW - 4 * H, 1000));
  u.ingestRow(row('ryan', 's1', NOW - 3 * H, 1500));
  u.ingestRow(row('ryan', 's1', NOW - 2 * H, 200)); // restart under the same session
  u.ingestRow(row('ryan', 's1', NOW - 1 * H, 700));
  assert.equal(u.usage(NOW, PERIODS['5h']).agents.get('ryan').work, 1500 + 200 + 500);
});

test('sessions are independent and windows are rolling', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('a', 's1', NOW - 30 * H, 10_000)); // a day+ ago
  u.ingestRow(row('a', 's2', NOW - 1 * H, 2_000));
  u.ingestRow(row('b', 's9', NOW - 3 * 24 * H, 5_000));
  assert.equal(u.usage(NOW, PERIODS['5h']).floor.work, 2_000);
  assert.equal(u.usage(NOW, PERIODS.day).floor.work, 2_000);
  assert.equal(u.usage(NOW, PERIODS.week).floor.work, 17_000);
  assert.equal(u.usage(NOW, PERIODS.week).agents.get('b').work, 5_000);
});

test('malformed lines are ignored, valid JSONL lines are folded', () => {
  const u = new PeriodUsage();
  u.ingestLine('');
  u.ingestLine('{not json');
  u.ingestLine(JSON.stringify({ agent_id: '', ts: NOW }));
  u.ingestLine(JSON.stringify(row('x', 's', NOW - H, 42)));
  assert.equal(u.usage(NOW, PERIODS['5h']).floor.work, 42);
});

test('prune drops buckets beyond retention but keeps the month window intact', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('a', 's1', NOW - RETAIN_MS - 2 * H, 999));
  u.ingestRow(row('a', 's2', NOW - 29 * 24 * H, 100));
  u.prune(NOW);
  assert.equal(u.usage(NOW, RETAIN_MS * 2).floor.work, 100);
  assert.equal(u.usage(NOW, PERIODS.month).floor.work, 100);
});

test('office limit over 100% trips every listed agent; under warnAt nothing', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('kelly', 's1', NOW - H, 600_000));
  u.ingestRow(row('god', 'g1', NOW - H, 500_000)); // the orchestrator counts toward the office
  const cfg = { office: { '5h': 1_000_000 } };
  const r = evaluateLimits(u, cfg, ['kelly', 'phyllis'], NOW);
  assert.deepEqual([...r.trips.keys()].sort(), ['kelly', 'phyllis']);
  assert.match(r.trips.get('phyllis'), /office 5h token limit: 1,100,000 of 1,000,000/);
  assert.equal(r.over.length, 1);
  assert.equal(r.warnings.length, 0);

  const calm = evaluateLimits(u, { office: { day: 10_000_000 } }, ['kelly'], NOW);
  assert.equal(calm.trips.size, 0);
  assert.equal(calm.warnings.length, 0);
});

test('agent limit trips only that agent and warns from warnAt', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('kelly', 's1', NOW - H, 850));
  u.ingestRow(row('ryan', 's2', NOW - H, 1_200));
  const cfg = { agents: { kelly: { day: 1_000 }, ryan: { day: 1_000 } }, warnAt: 0.8 };
  const r = evaluateLimits(u, cfg, ['kelly', 'ryan'], NOW);
  assert.deepEqual([...r.trips.keys()], ['ryan']);
  assert.deepEqual(r.warnings.map((w) => w.agentId), ['kelly']);
  assert.equal(alertKey(r.warnings[0], 'warn'), 'warn:agent:kelly:day');
});

test('limits for agents not on the floor this beat are not evaluated', () => {
  const u = new PeriodUsage();
  u.ingestRow(row('gone', 's1', NOW - H, 5_000));
  const r = evaluateLimits(u, { agents: { gone: { '5h': 10 } } }, ['kelly'], NOW);
  assert.equal(r.trips.size, 0);
  assert.equal(r.over.length, 0);
});

test('no config → nothing to do', () => {
  const r = evaluateLimits(new PeriodUsage(), undefined, ['a'], NOW);
  assert.equal(r.trips.size, 0);
});

test('sanitizeLimits keeps only positive limits for known periods', () => {
  assert.deepEqual(sanitizeLimits({
    office: { '5h': 1_000_000.4, day: 0, year: 5, week: -3 },
    agents: { kelly: { day: 200_000 }, empty: { day: 0 }, '': { day: 1 } },
    warnAt: 0.85
  }), { office: { '5h': 1_000_000 }, agents: { kelly: { day: 200_000 } }, warnAt: 0.85 });
  assert.deepEqual(sanitizeLimits({ warnAt: 1.5 }), {});
  assert.deepEqual(sanitizeLimits(null), {});
});
