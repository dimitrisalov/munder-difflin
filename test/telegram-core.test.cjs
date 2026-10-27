'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/main/telegram-core.cjs');

const OWNER = 111;
const STRANGER = 222;

function update(fromId, text, extra = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      from: { id: fromId, is_bot: false, username: 'owner' },
      chat: { id: fromId, type: 'private' },
      text,
      ...extra
    }
  };
}

test('pairing code: unambiguous alphabet and requested length', () => {
  const code = core.newPairingCode();
  assert.equal(code.length, core.PAIRING_CODE_LENGTH);
  assert.match(code, /^[A-HJ-NP-Z2-9]+$/);
});

test('codesMatch ignores case, spaces and dashes, rejects mismatches and empties', () => {
  assert.equal(core.codesMatch('abcd-efgh', 'ABCDEFGH'), true);
  assert.equal(core.codesMatch(' ab cd ef gh ', 'ABCDEFGH'), true);
  assert.equal(core.codesMatch('ABCDEFGX', 'ABCDEFGH'), false);
  assert.equal(core.codesMatch('ABC', 'ABCDEFGH'), false);
  assert.equal(core.codesMatch('', ''), false);
  assert.equal(core.codesMatch(undefined, 'ABCDEFGH'), false);
});

test('parseCommand handles args and the @BotName suffix', () => {
  assert.deepEqual(core.parseCommand('/start ABCD'), { cmd: 'start', args: 'ABCD' });
  assert.deepEqual(core.parseCommand('/Status@MyOfficeBot'), { cmd: 'status', args: '' });
  assert.equal(core.parseCommand('hello /start'), null);
  assert.equal(core.parseCommand(undefined), null);
});

test('a stranger is ignored, even with a command', () => {
  assert.equal(core.classifyUpdate(update(STRANGER, 'do something'), OWNER, null).kind, 'ignore');
  assert.equal(core.classifyUpdate(update(STRANGER, '/status'), OWNER, null).kind, 'ignore');
  assert.equal(core.classifyUpdate(update(STRANGER, '/start WRONGCODE'), OWNER, 'ABCDEFGH').kind, 'ignore');
});

test('the right pairing code pairs its sender, with or without an existing owner', () => {
  const fresh = core.classifyUpdate(update(STRANGER, '/start abcd-efgh'), null, 'ABCDEFGH');
  assert.equal(fresh.kind, 'pair');
  assert.equal(fresh.userId, STRANGER);
  assert.equal(fresh.name, '@owner');
  const repair = core.classifyUpdate(update(STRANGER, '/start ABCDEFGH'), OWNER, 'ABCDEFGH');
  assert.equal(repair.kind, 'pair');
});

test('without an issued code nobody can pair', () => {
  assert.equal(core.classifyUpdate(update(STRANGER, '/start ABCDEFGH'), null, null).kind, 'ignore');
  assert.equal(core.classifyUpdate(update(STRANGER, '/start ABCDEFGH'), null, '').kind, 'ignore');
});

test('group chats, bots and non-message updates are ignored', () => {
  const group = update(OWNER, 'hi');
  group.message.chat.type = 'group';
  assert.equal(core.classifyUpdate(group, OWNER, null).kind, 'ignore');
  const bot = update(OWNER, 'hi');
  bot.message.from.is_bot = true;
  assert.equal(core.classifyUpdate(bot, OWNER, null).kind, 'ignore');
  assert.equal(core.classifyUpdate({ update_id: 3, edited_message: {} }, OWNER, null).kind, 'ignore');
});

test('owner messages: commands, text, replies and captions', () => {
  const cmd = core.classifyUpdate(update(OWNER, '/tasks'), OWNER, null);
  assert.equal(cmd.kind, 'command');
  assert.equal(cmd.cmd, 'tasks');

  const plain = core.classifyUpdate(update(OWNER, '  write a post  '), OWNER, null);
  assert.equal(plain.kind, 'message');
  assert.equal(plain.text, 'write a post');
  assert.equal(plain.replyTo, null);

  const reply = core.classifyUpdate(update(OWNER, 'yes', { reply_to_message: { message_id: 7 } }), OWNER, null);
  assert.equal(reply.replyTo, 7);

  const photo = core.classifyUpdate(update(OWNER, undefined, {
    caption: 'use this',
    photo: [
      { file_id: 'small', width: 90, height: 90 },
      { file_id: 'big', width: 1280, height: 960, file_size: 1000 }
    ]
  }), OWNER, null);
  assert.equal(photo.kind, 'message');
  assert.equal(photo.text, 'use this');
  assert.deepEqual(photo.files.map((f) => f.file_id), ['big']);

  assert.equal(core.classifyUpdate(update(OWNER, '   '), OWNER, null).kind, 'ignore');
});

test('mdToTelegramHtml escapes first, then maps the markdown subset', () => {
  assert.equal(core.mdToTelegramHtml('a < b & **c**'), 'a &lt; b &amp; <b>c</b>');
  assert.equal(core.mdToTelegramHtml('run `npm i`'), 'run <code>npm i</code>');
  assert.equal(core.mdToTelegramHtml('[site](https://x.io/a?b=1&c=2)'), '<a href="https://x.io/a?b=1&amp;c=2">site</a>');
  assert.equal(core.mdToTelegramHtml('<script>'), '&lt;script&gt;');
  assert.equal(core.mdToTelegramHtml('```js\nx<1\n```'), '<pre>x&lt;1</pre>');
});

test('splitMessage keeps chunks under the limit and prefers paragraph breaks', () => {
  const para = 'a'.repeat(60);
  const text = Array.from({ length: 10 }, () => para).join('\n\n');
  const chunks = core.splitMessage(text, 200);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 200);
  assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.deepEqual(core.splitMessage('short', 200), ['short']);
  assert.deepEqual(core.splitMessage('', 200), []);
  const noBreaks = core.splitMessage('x'.repeat(450), 200);
  assert.deepEqual(noBreaks.map((c) => c.length), [200, 200, 50]);
});

test('openAsks mirrors waitsOnHuman: blocked + newest unanswered, undismissed entry', () => {
  const tasks = [
    { id: 't1', title: 'A', status: 'blocked', humanQA: [{ q: 'old', a: 'x' }, { q: 'open?', askedAt: '2026-10-27T10:00:00Z' }] },
    { id: 't2', title: 'B', status: 'doing', humanQA: [{ q: 'not blocked' }] },
    { id: 't3', title: 'C', status: 'blocked', humanQA: [{ q: 'gone', dismissedAt: '2026-10-27T10:00:00Z' }] },
    { id: 't4', title: 'D', status: 'blocked' }
  ];
  assert.deepEqual(core.openAsks(tasks), [{ taskId: 't1', title: 'A', q: 'open?', askedAt: '2026-10-27T10:00:00Z' }]);
  assert.deepEqual(core.openAsks(undefined), []);
});

test('askKey is stable per ask and changes when the question changes', () => {
  const a = { taskId: 't1', q: 'open?', askedAt: '2026-10-27T10:00:00Z' };
  assert.equal(core.askKey(a), core.askKey({ ...a }));
  assert.notEqual(core.askKey(a), core.askKey({ ...a, q: 'other?' }));
});

test('applyAnswer fills only the matching open entry, and refuses stale questions', () => {
  const task = { id: 't1', humanQA: [{ q: 'same' , a: 'earlier' }, { q: 'same' }] };
  const next = core.applyAnswer(task, 'same', 'yes', '2026-10-27T11:00:00Z');
  assert.deepEqual(next, [{ q: 'same', a: 'earlier' }, { q: 'same', a: 'yes', answeredAt: '2026-10-27T11:00:00Z' }]);
  assert.equal(core.applyAnswer(task, 'other', 'yes', 'now'), null);
  assert.equal(core.applyAnswer({ id: 't2', humanQA: [{ q: 'x', dismissedAt: 'd' }] }, 'x', 'yes', 'now'), null);
  assert.equal(core.applyAnswer({ id: 't3' }, 'x', 'yes', 'now'), null);
});

test('MessageLedger evicts oldest first and round-trips through JSON', () => {
  const ledger = new core.MessageLedger(2);
  ledger.set(1, { kind: 'task', taskId: 'a' });
  ledger.set(2, { kind: 'task', taskId: 'b' });
  ledger.set(3, { kind: 'ask', taskId: 'c', q: 'q' });
  assert.equal(ledger.get(1), undefined);
  assert.equal(ledger.size, 2);
  const restored = new core.MessageLedger(2, JSON.parse(JSON.stringify(ledger)));
  assert.deepEqual(restored.get(3), { kind: 'ask', taskId: 'c', q: 'q' });
  const dirty = new core.MessageLedger(5, [[1, null], ['x', { taskId: 'a' }], [4, { taskId: 'd' }]]);
  assert.equal(dirty.size, 1);
});

test('formatStatus lists active agents and kanban counts, escaping names', () => {
  const registry = { agents: {
    a: { id: 'a', name: 'Phyllis', role: 'research', status: 'working' },
    b: { id: 'b', name: '<Kelly>', status: 'idle' },
    c: { id: 'c', name: 'Old', status: 'gone', archived: true }
  } };
  const out = core.formatStatus(registry, [{ status: 'todo' }, { status: 'done' }, { status: 'done' }], 'en');
  assert.match(out, /Phyllis<\/b> \(research\): working/);
  assert.match(out, /&lt;Kelly&gt;/);
  assert.doesNotMatch(out, /Old/);
  assert.match(out, /todo 1, doing 0, blocked 0, done 2/);
});

test('formatTasks shows open cards blocked-first and caps the list', () => {
  const tasks = [
    { title: 'later', status: 'todo' },
    { title: 'stuck', status: 'blocked', assignee: 'kelly' },
    { title: 'finished', status: 'done' }
  ];
  const out = core.formatTasks(tasks, 'en');
  assert.ok(out.indexOf('stuck') < out.indexOf('later'));
  assert.doesNotMatch(out, /finished/);
  assert.equal(core.formatTasks([], 'ru'), core.strings('ru').noTasks);
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, status: 'todo' }));
  assert.match(core.formatTasks(many, 'en', 5), /… \+15/);
});

test('formatDone falls back to the description and escapes the title', () => {
  const html = core.formatDone({ title: 'A & B', description: '**ok**' }, 'en');
  assert.equal(html, '✅ <b>A &amp; B</b>\n\n<b>ok</b>');
  assert.equal(core.formatDone({ title: 'Bare' }, 'ru'), '✅ <b>Bare</b>');
});

test('the request protocol embeds the exact reply command and the card id', () => {
  const p = core.buildRequestProtocol({ nodeCommand: 'node', helperPath: 'C:\\md\\md-telegram-reply.cjs', messageId: 42, taskId: 'telegram-abc' });
  assert.match(p, /"node" "C:\\md\\md-telegram-reply\.cjs" --reply-to 42 --text/);
  assert.match(p, /card telegram-abc/);
  assert.match(p, /humanQA/);
});

test('unknown language falls back to Russian', () => {
  assert.equal(core.strings('de'), core.strings('ru'));
});
