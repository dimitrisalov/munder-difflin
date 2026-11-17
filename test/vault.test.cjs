// The owner's Obsidian vault as the knowledge base (vault-core.cjs): settings,
// what counts as a note, the snapshot message, and what agents are told.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/main/vault-core.cjs');

test('settings: a path turns it on, history on unless turned off', () => {
  assert.deepEqual(core.sanitizeVault(undefined), { path: null, history: true });
  assert.deepEqual(core.sanitizeVault({ path: '  ' }), { path: null, history: true });
  assert.deepEqual(core.sanitizeVault({ path: 'C:\\Users\\User\\iCloudDrive\\iCloud~md~obsidian\\Мой' }),
    { path: 'C:\\Users\\User\\iCloudDrive\\iCloud~md~obsidian\\Мой', history: true });
  assert.equal(core.sanitizeVault({ path: '/v', history: false }).history, false);
});

test('notes are Markdown outside hidden folders', () => {
  assert.equal(core.isNote('Grok/Рынок.md'), true);
  assert.equal(core.isNote('Inbox\\Idea.MD'), true);
  assert.equal(core.isNote('.obsidian/app.json'), false);
  assert.equal(core.isNote('.trash/Old.md'), false);
  assert.equal(core.isNote('Attachments/chart.png'), false);
});

test('the snapshot message counts changes and names the notes', () => {
  const s = core.summarize('A\tGrok/Рынок.md\nM\tПлан запуска.md\nM\t.obsidian/app.json\nD\tOld.md\nR100\tA.md\tB.md\n');
  assert.deepEqual(s.counts, { added: 1, modified: 2, deleted: 1, renamed: 1 });
  assert.equal(s.total, 5);
  assert.equal(s.message, 'vault: +1 ~2 -1 →1 — Рынок, План запуска, app.json, Old, B');
  assert.deepEqual(core.summarize(''), { total: 0, counts: { added: 0, modified: 0, deleted: 0, renamed: 0 }, message: '' });
  const many = Array.from({ length: 9 }, (_, i) => `M\tn${i}.md`).join('\n');
  assert.match(core.summarize(many).message, /n5, …$/);
});

test('agents are told where it is, to search it first, to write there, and what not to do', () => {
  const line = core.vaultPromptLine('C:\\Vault');
  assert.match(line, /Obsidian vault at C:\\Vault/);
  assert.match(line, /Search it FIRST/);
  assert.match(line, /\[\[Note name\]\]/);
  assert.match(line, /Never delete, move or rename/);
  assert.match(line, /\.obsidian/);
  assert.ok(core.EXCLUDES.includes('.obsidian/workspace*.json'));
});
