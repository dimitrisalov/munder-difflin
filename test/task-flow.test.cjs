'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/main/taskFlow-core.cjs');

const NOW = '2026-10-27T15:00:00.000Z';
const card = (id, extra = {}) => ({ id, title: id.toUpperCase(), status: 'todo', dependsOn: [], ...extra });
const kinds = (r) => r.actions.map((a) => `${a.kind}:${a.taskId}`);

test('a waiting card is unblocked once, when its last dependency is done, with results', () => {
  let tasks = [
    card('research', { status: 'done', assignee: 'phyllis', result: '5 competitors in research.md' }),
    card('brief', { status: 'doing', assignee: 'phyllis' }),
    card('copy', { assignee: 'kelly', dependsOn: ['research', 'brief'] }),
  ];
  let r = f.planFlow(tasks, null, NOW);
  assert.deepEqual(kinds(r), [], 'brief is not done yet');
  tasks[1] = { ...tasks[1], status: 'done', result: 'brief.md' };
  r = f.planFlow(tasks, r.ledger, NOW);
  assert.deepEqual(kinds(r), ['unblock:copy']);
  assert.equal(r.actions[0].to, 'kelly');
  assert.deepEqual(r.actions[0].deps.map((d) => d.result), ['5 competitors in research.md', 'brief.md']);
  assert.deepEqual(kinds(f.planFlow(tasks, r.ledger, NOW)), [], 'not told twice');
});

test('a card with no assignee goes to god; one already moving or waiting on the human is left alone', () => {
  const tasks = [
    card('a', { status: 'done' }),
    card('b', { dependsOn: ['a'] }),
    card('c', { dependsOn: ['a'], status: 'doing' }),
    card('d', { dependsOn: ['a'], status: 'blocked', humanQA: [{ q: 'which tone?' }] }),
    card('e', { dependsOn: ['a'], status: 'blocked', humanQA: [{ q: 'ok?', a: 'yes' }] }),
  ];
  const r = f.planFlow(tasks, null, NOW);
  assert.deepEqual(kinds(r), ['unblock:b', 'unblock:e']);
  assert.equal(r.actions[0].to, null);
});

test('a reopened dependency lets the card be told again later', () => {
  let tasks = [card('a', { status: 'done' }), card('b', { dependsOn: ['a'], assignee: 'kelly' })];
  let r = f.planFlow(tasks, null, NOW);
  assert.deepEqual(kinds(r), ['unblock:b']);
  tasks = [{ ...tasks[0], status: 'doing' }, tasks[1]];
  r = f.planFlow(tasks, r.ledger, NOW);
  tasks = [{ ...tasks[0], status: 'done' }, tasks[1]];
  assert.deepEqual(kinds(f.planFlow(tasks, r.ledger, NOW)), ['unblock:b']);
});

test('missing dependencies never unblock', () => {
  assert.deepEqual(kinds(f.planFlow([card('b', { dependsOn: ['ghost'] })], null, NOW)), []);
});

test('review: requested → reviewer asked; changes → assignee told; approved → quiet', () => {
  let t = card('copy', { status: 'doing', assignee: 'kelly', reviewer: 'phyllis', result: 'draft v1' });
  let r = f.planFlow([t], null, NOW);
  assert.deepEqual(kinds(r), []);
  t = { ...t, review: { state: 'requested' } };
  r = f.planFlow([t], r.ledger, NOW);
  assert.deepEqual(kinds(r), ['review-requested:copy']);
  assert.equal(r.actions[0].to, 'phyllis');
  assert.equal(r.actions[0].result, 'draft v1');
  assert.deepEqual(kinds(f.planFlow([t], r.ledger, NOW)), [], 'asked once');
  t = { ...t, review: { state: 'changes', by: 'phyllis', notes: 'shorter headline' } };
  r = f.planFlow([t], r.ledger, NOW);
  assert.deepEqual(kinds(r), ['changes-requested:copy']);
  assert.equal(r.actions[0].to, 'kelly');
  assert.equal(r.actions[0].notes, 'shorter headline');
  t = { ...t, review: { state: 'requested' }, result: 'draft v2' };
  r = f.planFlow([t], r.ledger, NOW);
  assert.deepEqual(kinds(r), ['review-requested:copy'], 'second round asks again');
  t = { ...t, status: 'done', review: { state: 'approved', by: 'phyllis' } };
  assert.deepEqual(kinds(f.planFlow([t], r.ledger, NOW)), []);
});

test('closed without approval: reopened as a review request', () => {
  const t = card('copy', { status: 'done', assignee: 'kelly', reviewer: 'phyllis', result: 'v1' });
  const r = f.planFlow([t], null, NOW);
  assert.deepEqual(kinds(r), ['reopen-for-review:copy', 'review-requested:copy']);
});

test('awaiting review: not settled, not announced; a dependent waits for the approval', () => {
  const pending = card('copy', { status: 'done', reviewer: 'phyllis' });
  const approved = { ...pending, review: { state: 'approved' } };
  assert.equal(f.isAwaitingReview(pending), true);
  assert.equal(f.isSettled(pending), false);
  assert.equal(f.isAwaitingReview(approved), false);
  assert.equal(f.isSettled(approved), true);
  assert.equal(f.isAwaitingReview(card('plain', { status: 'done' })), false);
  const next = card('post', { dependsOn: ['copy'], assignee: 'kelly' });
  assert.ok(!kinds(f.planFlow([pending, next], null, NOW)).includes('unblock:post'));
  assert.ok(kinds(f.planFlow([approved, next], null, NOW)).includes('unblock:post'));
});

test('the ledger forgets cards that are gone', () => {
  const r1 = f.planFlow([card('a', { status: 'done' }), card('b', { dependsOn: ['a'] }),
    card('c', { reviewer: 'x', review: { state: 'requested' } })], null, NOW);
  const r2 = f.planFlow([], r1.ledger, NOW);
  assert.deepEqual(r2.ledger, { version: 1, unblocked: [], review: {} });
});

test('messages name the ticket key, carry results and notes, and are clipped', () => {
  const key = (id) => ({ copy: 'OF-7', research: 'OF-6' }[id] || '');
  const u = f.messageFor({ kind: 'unblock', taskId: 'copy', deps: [{ id: 'research', title: 'Research', result: 'x'.repeat(3000) }] }, key);
  assert.equal(u.subject, 'Unblocked: OF-7');
  assert.match(u.body, /OF-6 "Research" \(research\): x+…/);
  assert.ok(u.body.length < 1600);
  const rq = f.messageFor({ kind: 'review-requested', taskId: 'copy', title: 'Copy', from: 'kelly', result: '' }, key);
  assert.match(rq.subject, /Review requested: OF-7/);
  assert.match(rq.body, /done by kelly/);
  assert.match(rq.body, /\(empty — ask for one\)/);
  const ch = f.messageFor({ kind: 'changes-requested', taskId: 'copy', title: 'Copy', by: 'phyllis', notes: 'fix it' });
  assert.equal(ch.subject, 'Changes requested: copy');
  assert.match(ch.body, /phyllis sent "Copy" \(copy\) back/);
  assert.equal(f.messageFor({ kind: 'reopen-for-review', taskId: 'copy' }), null);
});
