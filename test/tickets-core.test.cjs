'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../src/main/tickets-core.cjs');

const tasks = [
  { id: 'bmt-1', title: 'Landing copy' },
  { id: 'bmt-2', title: 'Research   competitors\nin detail' },
  { title: 'no id' },
  { id: 'bmt-1', title: 'duplicate id' }
];

test('prefix: letters and digits, starts with a letter, default otherwise', () => {
  assert.equal(k.sanitizePrefix('v53'), 'V53');
  assert.equal(k.sanitizePrefix('9x'), 'OF');
  assert.equal(k.sanitizePrefix('TOOLONG7'), 'OF');
  assert.equal(k.sanitizePrefix(undefined), 'OF');
});

test('numbers are handed out in ledger order, once per id', () => {
  const first = k.assignTickets(null, tasks);
  assert.equal(first.changed, true);
  assert.deepEqual(first.book.byId, { 'bmt-1': 1, 'bmt-2': 2 });
  const again = k.assignTickets(first.book, tasks);
  assert.equal(again.changed, false);
  const more = k.assignTickets(first.book, [{ id: 'bmt-3' }, ...tasks]);
  assert.equal(more.book.byId['bmt-3'], 3);
  assert.deepEqual(k.keysFor(more.book, 'of'), { 'bmt-1': 'OF-1', 'bmt-2': 'OF-2', 'bmt-3': 'OF-3' });
});

test('numbers are never reused, even after a card is gone', () => {
  const a = k.assignTickets(null, [{ id: 'x' }, { id: 'y' }]).book;
  const b = k.assignTickets(a, [{ id: 'z' }]).book;
  assert.equal(b.byId.z, 3);
  // A damaged book still continues past its highest number.
  const fixed = k.readBook({ next: 1, byId: { x: 7, y: 'bad' } });
  assert.deepEqual(fixed, { version: 1, next: 8, byId: { x: 7 } });
});

test('a full book forgets cards that left the board', () => {
  const byId = {};
  for (let i = 1; i <= k.MAX_BOOK; i++) byId[`old-${i}`] = i;
  const r = k.assignTickets({ next: k.MAX_BOOK + 1, byId }, [{ id: 'old-5' }, { id: 'new' }]);
  assert.deepEqual(r.book.byId, { 'old-5': 5, new: k.MAX_BOOK + 1 });
  assert.equal(r.book.next, k.MAX_BOOK + 2);
});

test('ticket refs in free text, and the footnote for the orchestrator', () => {
  assert.deepEqual(k.findTicketRefs('по of-2 и OF-12, ещё раз OF-2; не TOF-3 и не OF-1234567', 'OF'), [2, 12]);
  const book = k.assignTickets(null, tasks).book;
  assert.equal(k.ticketFootnote('доделай OF-2 и OF-9', book, tasks, 'OF'),
    '[tickets] OF-2 = task "bmt-2" (Research competitors in detail)');
  assert.equal(k.ticketFootnote('nothing here', book, tasks, 'OF'), '');
});
