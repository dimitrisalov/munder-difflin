'use strict';
/**
 * The knowledge base as the team's shared notebook (wave 6): Cyrillic text is
 * searchable with its word forms, and agents save notes with `kg add`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const kg = require('../src/main/kg-core.cjs');

const CLI = path.join(__dirname, '..', 'resources', 'kg.cjs');
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kg-shared-'));
const run = (root, args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', env: { ...process.env, KG_ROOT: root, AGENT_NAME: 'Phyllis', ...(opts.env || {}) }, input: opts.input
});

test('Cyrillic words are tokens now, not dropped', () => {
  const toks = kg.tokenize('Исследование конкурентов: 5 продуктов и их цены');
  assert.ok(toks.includes('исследован'));
  assert.ok(toks.includes('конкурент'));
  assert.ok(toks.includes('5') === false, 'one-character numbers are dropped like before');
  assert.ok(!toks.includes('и'), 'Russian stop-word');
});

test('word forms meet: агент / агента / агентов / агентам', () => {
  const forms = ['агент', 'агента', 'агентов', 'агентам', 'агентами'].map((w) => kg.tokenize(w)[0]);
  assert.equal(new Set(forms).size, 1, forms.join(','));
  assert.equal(kg.tokenize('новость')[0], kg.tokenize('новости')[0]);
  assert.equal(kg.tokenize('ёлка')[0], kg.tokenize('елки')[0]);
});

test('English tokens are exactly as before', () => {
  assert.deepEqual(kg.tokenize('The Refund-Policy is valid for 30 days'), ['refund', 'policy', 'valid', '30', 'days']);
});

test('a Russian query finds a Russian note in another word form', () => {
  const root = tmpRoot();
  kg.ingest(root, { title: 'Конкуренты', text: 'Мы сравнили пять продуктов конкурентов. Самый дешёвый тариф у Альфы — 9 евро.' });
  kg.ingest(root, { title: 'Weather', text: 'It rained all week in Berlin.' });
  const hits = kg.search(root, 'тарифы конкурента');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'Конкуренты');
  assert.match(hits[0].snippet, /конкурентов/);
});

test('an agent saves a note from a file; it is attributed and searchable', () => {
  const root = tmpRoot();
  const note = path.join(root, '..', `note-${process.pid}.md`);
  fs.writeFileSync(note, '# Источники по рынку\n\nОтчёт Statista 2026: рынок ИИ-агентов вырос вдвое.');
  const r = run(root, ['add', '--title', 'Рынок ИИ-агентов', '--tags', 'research,market', '--file', note]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Saved to the knowledge base: "Рынок ИИ-агентов"/);
  const [doc] = kg.list(root);
  assert.deepEqual(doc.tags, ['research', 'market', 'by:Phyllis']);
  assert.match(doc.source, /^Phyllis: note-/);
  assert.equal(kg.search(root, 'рынок агентов')[0].title, 'Рынок ИИ-агентов');
});

test('an agent saves a note from its text or stdin', () => {
  const root = tmpRoot();
  assert.equal(run(root, ['add', '--title', 'Тон', 'Пишем', 'на', '«ты»,', 'без', 'канцелярита.']).status, 0);
  assert.equal(run(root, ['add', '--title', 'Цены'], { input: 'Базовый тариф — 10 евро в месяц.' }).status, 0);
  assert.equal(kg.list(root).length, 2);
  assert.equal(kg.search(root, 'канцелярит')[0].title, 'Тон');
  assert.equal(kg.search(root, 'тарифа')[0].title, 'Цены');
});

test('kg add without anything to save fails with usage', () => {
  const root = tmpRoot();
  const r = run(root, ['add', '--title', 'Empty'], { input: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: kg add/);
  const missing = run(root, ['add', '--file', path.join(root, 'nope.md')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no such file/);
});
