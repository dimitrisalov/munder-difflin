'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/main/temps-core.cjs');
const { PeriodUsage, evaluateLimits } = require('../src/main/periodUsage.cjs');

const on = t.sanitizeTempsConfig({ enabled: true });

test('config: off by default, bad values fall back, ranges clamped', () => {
  assert.deepEqual(t.sanitizeTempsConfig(undefined), { enabled: false, maxPerAgent: 2, maxTotal: 4, tokenCap: 1_000_000 });
  assert.deepEqual(
    t.sanitizeTempsConfig({ enabled: true, maxPerAgent: 99, maxTotal: 0, tokenCap: -5 }),
    { enabled: true, maxPerAgent: 8, maxTotal: 1, tokenCap: 0 }
  );
  assert.equal(t.sanitizeTempsConfig({ enabled: 'yes' }).enabled, false);
});

test('temp ids are filesystem-safe and carry the parent', () => {
  assert.equal(t.tempId('kelly', 'Draft A'), 'temp-kelly-draft-a');
  assert.equal(t.tempId('ryan', '../../etc'), 'temp-ryan-etc');
  assert.equal(t.tempId('', ''), 'temp-agent-job');
  assert.ok(t.tempId('x'.repeat(100), 'y'.repeat(100)).length <= 5 + 40 + 1 + 24);
});

test('requests: objective required, command refused, model shape checked', () => {
  assert.equal(t.readTempRequest(null).ok, false);
  assert.equal(t.readTempRequest([]).ok, false);
  assert.match(t.readTempRequest({}).error, /objective/);
  assert.match(t.readTempRequest({ objective: 'x', command: 'rm -rf /' }).error, /command/);
  assert.match(t.readTempRequest({ objective: 'x', model: 'opus --dangerously' }).error, /model/);
  assert.match(t.readTempRequest({ objective: 'x'.repeat(t.MAX_OBJECTIVE + 1) }).error, /longer/);
  const ok = t.readTempRequest({ objective: '  find 5 sources  ', name: 'Scout\nOne', clone: true, model: 'sonnet', tokenCap: 2000.4, isolate: 1 });
  assert.deepEqual(ok, { ok: true, objective: 'find 5 sources', name: 'Scout One', clone: true, model: 'sonnet', isolate: false, tokenCap: 2000 });
});

test('who may start temps', () => {
  assert.equal(t.parentEligible(undefined, 'god').ok, false);
  assert.equal(t.parentEligible({ id: 'god', isGod: true }, 'god').ok, false);
  assert.equal(t.parentEligible({ id: 'pam', isAssistant: true }, 'god').ok, false);
  assert.equal(t.parentEligible({ id: 'kelly', archived: true }, 'god').ok, false);
  assert.equal(t.parentEligible({ id: 'temp-kelly-a', parent: 'kelly' }, 'god').ok, false);
  assert.equal(t.parentEligible({ id: 'kelly' }, 'god').ok, true);
});

test('admission: switch, limits per agent and office, token limit', () => {
  const eligible = { ok: true };
  assert.equal(t.admit({ cfg: t.sanitizeTempsConfig({}), parentId: 'kelly', eligible, live: [] }).verdict, 'wait');
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible: { ok: false, reason: 'r' }, live: [] }).verdict, 'fail');
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible, live: [], limitTrip: 'day token limit' }).verdict, 'fail');
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible, live: [{ parent: 'kelly' }] }).verdict, 'run');
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible, live: [{ parent: 'kelly' }, { parent: 'kelly' }] }).verdict, 'wait');
  // God's own workers (no parent) do not use temp slots.
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible, live: [{}, {}, {}, {}, {}] }).verdict, 'run');
  const full = [{ parent: 'a' }, { parent: 'b' }, { parent: 'c' }, { parent: 'd' }];
  assert.equal(t.admit({ cfg: on, parentId: 'kelly', eligible, live: full }).verdict, 'wait');
});

test('token cap: the tighter one wins, 0 means none', () => {
  assert.equal(t.effectiveCap(undefined, 1000), 1000);
  assert.equal(t.effectiveCap(500, 1000), 500);
  assert.equal(t.effectiveCap(5000, 1000), 1000);
  assert.equal(t.effectiveCap(5000, 0), 5000);
  assert.equal(t.effectiveCap(undefined, 0), 0);
});

test('brief names the parent as the one to report done to', () => {
  const b = t.tempBrief({ parentId: 'kelly', parentName: 'Kelly', objective: 'Write 3 headlines', clone: true });
  assert.match(b, /CLONE of Kelly/);
  assert.match(b, /Write 3 headlines/);
  assert.match(b, /"kelly" with "act":"done"/);
});

test('ledger keeps temp → parent, bounded', () => {
  let l = { version: 1, temps: {} };
  for (let i = 0; i < t.MAX_LEDGER + 5; i++) l = t.recordTemp(l, `temp-k-${i}`, { parent: 'kelly', name: 'k', spawnedAt: i });
  assert.equal(Object.keys(l.temps).length, t.MAX_LEDGER);
  assert.equal(l.temps['temp-k-0'], undefined);
  const m = t.parentMap(l);
  assert.equal(m.get(`temp-k-${t.MAX_LEDGER + 4}`), 'kelly');
  assert.equal(t.parentMap(null).size, 0);
});

test('limits: a temp spends on its parent, and a parent over its limit stops its temps', () => {
  const now = Date.UTC(2026, 9, 27, 12);
  const u = new PeriodUsage();
  const row = (agent, input) => ({ agent_id: agent, session_id: 's', ts: now - 60_000, input, output: 0, cache_creation: 0, cache_read: 0 });
  u.ingestRow(row('kelly', 600));
  u.ingestRow(row('temp-kelly-a', 500));
  u.ingestRow(row('ryan', 100));
  const cfg = { agents: { kelly: { '5h': 1000 } } };
  const parents = new Map([['temp-kelly-a', 'kelly']]);

  const without = evaluateLimits(u, cfg, ['kelly', 'temp-kelly-a', 'ryan'], now);
  assert.equal(without.trips.size, 0);

  const withTemps = evaluateLimits(u, cfg, ['kelly', 'temp-kelly-a', 'ryan'], now, parents);
  assert.ok(withTemps.trips.get('kelly'));
  assert.match(withTemps.trips.get('temp-kelly-a'), /parent kelly/);
  assert.equal(withTemps.trips.has('ryan'), false);

  // The parent is no longer on the floor: its temp still stops.
  const orphan = evaluateLimits(u, cfg, ['temp-kelly-a'], now, parents);
  assert.match(orphan.trips.get('temp-kelly-a'), /parent kelly/);
});
