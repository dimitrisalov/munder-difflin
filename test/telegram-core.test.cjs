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
  assert.match(p, /in the language the owner wrote in/);
});

test('unknown language falls back to Russian', () => {
  assert.equal(core.strings('de').help, core.strings('ru').help);
  assert.equal(core.strings('de').chatAck, core.strings('ru').chatAck);
});

test('the texts name the boss the owner knows, escaped, defaulting to the app default', () => {
  assert.equal(core.strings('en', 'Theo').chatAck, '📨 Passed to Theo.');
  assert.equal(core.strings('ru', 'Theo').chatAck, '📨 Передал Theo.');
  assert.match(core.strings('en', 'Theo').help, /Write to Theo as you would to a CEO/);
  assert.match(core.strings('ru', 'Theo').answerSaved('x'), /передан Theo\.$/);
  assert.match(core.strings('ru', 'Theo').help, /Пиши Theo как руководителю/);
  for (const lang of ['ru', 'en']) {
    const S = core.strings(lang, 'Theo');
    const all = Object.values(S).map((v) => (typeof v === 'function' ? v('x') : typeof v === 'string' ? v : '')).join('\n');
    assert.doesNotMatch(all, /Michael/, lang);
  }
  assert.match(core.strings('en').chatAck, new RegExp(core.DEFAULT_BOSS));
  assert.match(core.strings('en', '  ').chatAck, new RegExp(core.DEFAULT_BOSS));
  assert.match(core.strings('en', 'A<b>').chatAck, /A&lt;b&gt;/);
});

test('detectLang: the language the owner wrote in', () => {
  assert.equal(core.detectLang('please make a pitch deck for Kettle'), 'en');
  assert.equal(core.detectLang('сделай питч-дек для Kettle'), 'ru');
  // Russian with English terms in it is still Russian.
  assert.equal(core.detectLang('сделай deck для Kettle про pricing strategy'), 'ru');
  // English quoting a little Russian is still English.
  assert.equal(core.detectLang("also responded me 'принято, передал' in russian though i texted in english"), 'en');
  // Links, commands, mentions and code do not count.
  assert.equal(core.detectLang('глянь https://example.com/some/long/english/path'), 'ru');
  assert.equal(core.detectLang('/status'), undefined);
  assert.equal(core.detectLang('посмотри `npm run build --verbose`'), 'ru');
  // Too little to tell.
  assert.equal(core.detectLang('ok'), undefined);
  assert.equal(core.detectLang('👍 42'), undefined);
  assert.equal(core.detectLang(''), undefined);
  assert.equal(core.detectLang(undefined), undefined);
});

test('fmtTokens: compact millions and thousands per language', () => {
  assert.equal(core.fmtTokens(1_234_567, 'ru'), '1,2 млн');
  assert.equal(core.fmtTokens(1_234_567, 'en'), '1.2M');
  assert.equal(core.fmtTokens(850_000, 'ru'), '850 тыс.');
  assert.equal(core.fmtTokens(850_000, 'en'), '850k');
  assert.equal(core.fmtTokens(42, 'en'), '42');
});

test('formatLimitAlert: warning shows the share, overrun says agents are held back', () => {
  const warn = core.formatLimitAlert({ scope: 'office', period: '5h', used: 2_500_000, limit: 3_000_000 }, 'warn', 'en');
  assert.match(warn, /Token limit: 83%/);
  assert.match(warn, /Office in 5 hours: 2.5M of 3M/);
  const over = core.formatLimitAlert({ scope: 'agent', name: '<Kelly>', period: 'day', used: 1_100_000, limit: 1_000_000 }, 'over', 'en');
  assert.match(over, /Token limit reached/);
  assert.match(over, /Agent &lt;Kelly&gt; in a day/);
  assert.match(over, /held back/);
});

test('formatLimits: office periods with and without limits, agents by name, hint when nothing is set', () => {
  const usage = {
    '5h': { floor: { work: 1_200_000 }, agents: { k: { work: 400_000 } } },
    day: { floor: { work: 2_000_000 }, agents: { k: { work: 900_000 } } },
    week: { floor: { work: 5_000_000 }, agents: {} },
    month: { floor: { work: 9_000_000 }, agents: {} }
  };
  const out = core.formatLimits({ config: { office: { '5h': 3_000_000 }, agents: { k: { day: 1_000_000 } } }, usage, names: { k: 'Kelly' } }, 'en');
  assert.match(out, /in 5 hours: 1.2M of 3M \(40%\)/);
  assert.match(out, /in a day: 2M\n/);
  assert.match(out, /<b>Kelly<\/b>: in a day 900k of 1M/);
  const none = core.formatLimits({ config: {}, usage }, 'ru');
  assert.match(none, /Лимиты не заданы/);
});

test('extractVoice: voice notes, audio files and round video notes', () => {
  assert.deepEqual(core.extractVoice({ voice: { file_id: 'v', duration: 3, mime_type: 'audio/ogg', file_size: 9000 } }),
    { file_id: 'v', name: 'voice.ogg', mime: 'audio/ogg', size: 9000, duration: 3 });
  assert.equal(core.extractVoice({ audio: { file_id: 'a', file_name: 'memo.m4a', mime_type: 'audio/mp4' } }).name, 'memo.m4a');
  assert.equal(core.extractVoice({ video_note: { file_id: 'n' } }).mime, 'video/mp4');
  assert.equal(core.extractVoice({ text: 'hi' }), null);
});

test('a voice-only message from the owner is a message with a voice and no text', () => {
  const d = core.classifyUpdate(update(OWNER, undefined, { voice: { file_id: 'v1', duration: 4 } }), OWNER, null);
  assert.equal(d.kind, 'message');
  assert.equal(d.text, '');
  assert.equal(d.voice.file_id, 'v1');
});

test('button presses: owner only, private chat, our data format only', () => {
  const press = (fromId, data, chatType = 'private') => ({
    update_id: 9,
    callback_query: { id: 'cb', data, from: { id: fromId }, message: { message_id: 77, chat: { id: fromId, type: chatType } } }
  });
  const ok = core.classifyUpdate(press(OWNER, 'a:abcdef1234:2'), OWNER, null);
  assert.deepEqual(ok, { kind: 'callback', callbackId: 'cb', chatId: OWNER, messageId: 77, action: 'answer', key: 'abcdef1234', option: 2 });
  assert.equal(core.classifyUpdate(press(OWNER, 'd:abcdef1234'), OWNER, null).action, 'dismiss');
  assert.equal(core.classifyUpdate(press(STRANGER, 'a:abcdef1234:1'), OWNER, null).kind, 'ignore');
  assert.equal(core.classifyUpdate(press(OWNER, 'a:abcdef1234:1', 'group'), OWNER, null).kind, 'ignore');
  assert.equal(core.classifyUpdate(press(OWNER, 'rm -rf'), OWNER, null).kind, 'ignore');
});

test('parseOptions: numbered lines become options, markdown stripped, need at least two', () => {
  assert.deepEqual(core.parseOptions('**Publish?**\n\n1. Yes, now\n2) Wait for `Monday`\n- not an option'), ['Yes, now', 'Wait for Monday']);
  assert.deepEqual(core.parseOptions('1. Only one'), []);
  assert.equal(core.parseOptions(Array.from({ length: 12 }, (_, i) => `${i + 1}. o${i}`).join('\n')).length, 8);
});

test('askKeyboard: one button per option plus dismiss, data fits Telegram limits', () => {
  const key = core.askShortKey({ taskId: 't1', q: 'q?', askedAt: '2026-10-27T10:00:00Z' });
  assert.match(key, /^[0-9a-f]{10}$/);
  const kb = core.askKeyboard(key, ['Yes', 'x'.repeat(200)], 'en');
  assert.equal(kb.inline_keyboard.length, 3);
  assert.equal(kb.inline_keyboard[0][0].callback_data, `a:${key}:1`);
  assert.ok(kb.inline_keyboard[1][0].text.length <= 60);
  assert.equal(kb.inline_keyboard[2][0].callback_data, `d:${key}`);
  for (const row of kb.inline_keyboard) assert.ok(Buffer.byteLength(row[0].callback_data) <= 64);
  assert.deepEqual(core.parseCallbackData(kb.inline_keyboard[0][0].callback_data), { action: 'answer', key, option: 1 });
});

test('the request protocol tells agents about files and one-tap options', () => {
  const p = core.buildRequestProtocol({ nodeCommand: 'node', helperPath: 'h.cjs', messageId: 1, taskId: 't' });
  assert.match(p, /--file <absolute path>/);
  assert.match(p, /one tap buttons/);
});

// ─── conversations with the boss ────────────────────────────────────────────

test('pickConversation: a reply continues, a recent message continues, a pause or /new starts anew', () => {
  const MIN = 60_000;
  const last = { id: 'conv-aaaa', at: 0 };
  assert.deepEqual(core.pickConversation({ entry: { kind: 'chat', conv: 'conv-bbbb' }, last, now: 5 * 60 * MIN, newId: 'conv-new1' }), { conv: 'conv-bbbb', via: 'reply' });
  // A reply to a card's message: that card's conversation, or a new one carrying the card.
  assert.deepEqual(core.pickConversation({ entry: { kind: 'task', taskId: 't1' }, taskConv: 'conv-cccc', last, now: 0, newId: 'conv-new1' }), { conv: 'conv-cccc', via: 'reply' });
  assert.deepEqual(core.pickConversation({ entry: { kind: 'task', taskId: 't1' }, last, now: 0, newId: 'conv-new1' }), { conv: 'conv-new1', via: 'card', card: 't1' });
  assert.deepEqual(core.pickConversation({ last, now: 29 * MIN, newId: 'conv-new1' }), { conv: 'conv-aaaa', via: 'recent' });
  assert.deepEqual(core.pickConversation({ last, now: 31 * MIN, newId: 'conv-new1' }), { conv: 'conv-new1', via: 'new' });
  assert.deepEqual(core.pickConversation({ last: null, now: 0, newId: 'conv-new1' }), { conv: 'conv-new1', via: 'new' });
  assert.match(core.newConvId(), /^conv-[0-9a-f]{8}$/);
});

test('a conversation\'s cards and the one a follow-up is written onto', () => {
  const tasks = [
    { id: 'a', title: 'Deck', status: 'done', createdAt: '2026-10-28T10:00:00Z', telegram: { chat_id: 1, message_id: 5, conv: 'conv-x' } },
    { id: 'b', title: 'Logo', status: 'doing', createdAt: '2026-10-28T11:00:00Z', telegram: { chat_id: 1, message_id: 9, conv: 'conv-x' } },
    { id: 'c', title: 'Other', status: 'todo', createdAt: '2026-10-28T09:00:00Z', telegram: { chat_id: 1, message_id: 2, conv: 'conv-y' } },
    { id: 'old', title: 'Legacy', status: 'todo', createdAt: '2026-10-27T09:00:00Z', telegram: { chat_id: 1, message_id: 1 } },
  ];
  assert.deepEqual(core.conversationCards(tasks, 'conv-x').map((t) => t.id), ['a', 'b']);
  assert.deepEqual(core.conversationCards(tasks, 'conv-new', ['old']).map((t) => t.id), ['old']);
  assert.equal(core.openCardOf(core.conversationCards(tasks, 'conv-x')).id, 'b');
  assert.equal(core.openCardOf([tasks[0]]), null);
  assert.equal(core.appendOwnerNote('Brief.\n', 'make it blue', '28.10, 14:05'), 'Brief.\n\n— Owner, 28.10, 14:05 (Telegram): make it blue');
  assert.equal(core.appendOwnerNote('', ' hi ', 't'), '— Owner, t (Telegram): hi');
});

test('the chat protocol: answer yourself, not every message is a task, one card per job', () => {
  const base = { nodeCommand: 'node', helperPath: 'C:\\md\\md-telegram-reply.cjs', messageId: 42, conv: 'conv-ab12' };
  const p = core.buildChatProtocol({ ...base, cards: [] });
  assert.match(p, /ANSWER THEM YOURSELF/);
  assert.match(p, /"node" "C:\\md\\md-telegram-reply\.cjs" --reply-to 42 --text/);
  assert.match(p, /NOT EVERY MESSAGE IS A TASK/);
  assert.match(p, /HAS NO CARD YET/);
  assert.match(p, /--new-task "<short title>" --conv conv-ab12 --reply-to 42/);
  assert.match(p, /--task <card id>/);
  const q = core.buildChatProtocol({ ...base, cards: [{ id: 'telegram-1', key: 'OF-12', title: 'Deck', status: 'doing' }], noted: 'OF-12' });
  assert.match(q, /ALREADY HAS A CARD: OF-12 \(telegram-1\) "Deck" — doing\. The owner's message was added to OF-12\./);
  assert.match(q, /never open another card for the same job/);
});

test('the ledger keeps conversation entries across a restart', () => {
  const l = new core.MessageLedger(10, [[5, { kind: 'chat', conv: 'conv-1' }], [6, { kind: 'task', taskId: 't' }], [7, { kind: 'chat' }]]);
  assert.deepEqual(l.get(5), { kind: 'chat', conv: 'conv-1' });
  assert.deepEqual(l.get(6), { kind: 'task', taskId: 't' });
  assert.equal(l.get(7), undefined);
});
