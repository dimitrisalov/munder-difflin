'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { inDateRange, cardsForAgent } = loadTs('src/shared/taskFilters.ts');

const now = new Date(2026, 9, 27, 15, 0, 0); // local time
const iso = (d) => d.toISOString();

test('date ranges', () => {
  assert.equal(inDateRange(iso(new Date(2026, 9, 27, 0, 5)), 'today', now), true);
  assert.equal(inDateRange(iso(new Date(2026, 9, 26, 23, 55)), 'today', now), false);
  assert.equal(inDateRange(iso(new Date(2026, 9, 21, 16, 0)), 'week', now), true);
  assert.equal(inDateRange(iso(new Date(2026, 9, 19, 12, 0)), 'week', now), false);
  assert.equal(inDateRange(iso(new Date(2026, 9, 1, 12, 0)), 'month', now), true);
  assert.equal(inDateRange(iso(new Date(2026, 8, 20, 12, 0)), 'month', now), false);
  assert.equal(inDateRange('garbage', 'all', now), true);
  assert.equal(inDateRange('garbage', 'today', now), false);
  assert.equal(inDateRange(undefined, 'week', now), false);
});

test("an agent's cards, newest first", () => {
  const cards = [
    { id: 'a', assignee: 'kelly', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'b', assignee: 'ryan', createdAt: '2026-10-02T10:00:00Z' },
    { id: 'c', assignee: 'kelly', createdAt: '2026-10-03T10:00:00Z' },
    { id: 'd', assignee: 'kelly', createdAt: 'bad' }
  ];
  assert.deepEqual(cardsForAgent(cards, 'kelly').map((c) => c.id), ['c', 'a', 'd']);
  assert.deepEqual(cardsForAgent(cards, 'nobody'), []);
});
