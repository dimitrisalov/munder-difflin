// An agent stopped on a question in its terminal → the owner hears about it in
// Telegram with buttons (needs-you-core.cjs), seen live 28.10 when Theo waited
// on "Allow this read outside the working directories?" with nobody at the PC.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/main/needs-you-core.cjs');
const tg = require('../src/main/telegram-core.cjs');

const PERM = 'Claude needs your permission to use Read';

test('a permission question is due after the delay, once; any later hook ends it', () => {
  const n = new core.NeedsYou();
  n.note('god', 'PreToolUse', undefined, 0);
  n.note('god', 'Notification', PERM, 1000);
  assert.deepEqual(n.due(1000 + core.DELAY_MS - 1), []);
  const [w] = n.due(1000 + core.DELAY_MS);
  assert.equal(w.agentId, 'god');
  assert.equal(w.message, PERM);
  assert.match(w.key, /^[A-Za-z0-9]{10}$/);
  assert.deepEqual(n.due(1000 + core.DELAY_MS * 3), [], 'told once');
  n.sent('god', [55]);
  assert.equal(n.byKey(w.key).agentId, 'god');
  // A status tick is not an answer; the tool running is.
  assert.equal(n.note('god', 'Status', undefined, 90_000), null);
  const ended = n.note('god', 'PostToolUse', undefined, 95_000);
  assert.deepEqual(ended.messageIds, [55]);
  assert.equal(n.byKey(w.key), null);
});

test('answered before the delay: never sent, nothing to clean up', () => {
  const n = new core.NeedsYou();
  n.note('k', 'Notification', PERM, 0);
  assert.equal(n.note('k', 'PreToolUse', undefined, 5000), null);
  assert.deepEqual(n.due(10 * core.DELAY_MS), []);
});

test('idle notices are not questions; agents without a terminal are skipped', () => {
  const n = new core.NeedsYou();
  n.note('a', 'Notification', 'Claude is waiting for your input', 0);
  assert.deepEqual(n.due(core.DELAY_MS * 2), []);
  n.note('b', 'Notification', PERM, 0);
  assert.deepEqual(n.due(core.DELAY_MS * 2, new Set(['a'])), []);
  assert.equal(n.due(core.DELAY_MS * 2, new Set(['b'])).length, 1);
  n.forget('b');
  assert.equal(n.agents.size, 0);
});

const ESC = '\x1b';
const TAIL = [
  `${ESC}[2J${ESC}[1;1H${ESC}[38;5;245m╭──────────────────────────────────────────────╮`,
  `${ESC}[2;1H│ Read file                                     │`,
  `${ESC}[3;1H│   Read(D:\\AI\\work\\design\\job1\\out\\slides\\01.png)   │`,
  `${ESC}[4;1H│                                              │`,
  `${ESC}[5;1H│ ${ESC}[1mAllow this read outside the working directories?${ESC}[22m │`,
  `${ESC}[6;1H│ ${ESC}[36m❯ 1. Yes${ESC}[39m                                  │`,
  `${ESC}[7;1H│   2. Yes, allow reading from design\\ during this session │`,
  `${ESC}[8;1H│   3. No, and tell Claude what to do differently (esc) │`,
  `${ESC}[9;1H╰──────────────────────────────────────────────╯`,
].join('');

test('the question, its options and the action are read off the terminal', () => {
  const p = core.promptFromTail(`older output, a done step?\r\n${TAIL}`);
  assert.equal(p.question, 'Allow this read outside the working directories?');
  assert.deepEqual(p.options, ['Yes', 'Yes, allow reading from design\\ during this session', 'No, and tell Claude what to do differently']);
  assert.equal(p.detail, 'Read(D:\\AI\\work\\design\\job1\\out\\slides\\01.png)');
  assert.deepEqual(core.promptFromTail('nothing to ask here'), { question: '', options: [], detail: '' });
  assert.deepEqual(core.promptFromTail(undefined), { question: '', options: [], detail: '' });
});

test('the Telegram message and its buttons', () => {
  const prompt = core.promptFromTail(TAIL);
  const ru = core.formatNeedsYou({ agentId: 'god', name: 'Theo', message: PERM, prompt }, 'ru');
  assert.match(ru, /⏸ <b>Theo ждёт твоего ответа<\/b>/);
  assert.match(ru, /<pre>Read\(D:\\AI\\work\\design\\job1\\out\\slides\\01\.png\)\nAllow this read outside the working directories\?\n1\. Yes\n2\./);
  assert.match(ru, /терминал Theo/);
  assert.match(core.formatNeedsYou({ agentId: 'x', name: 'A<b>', prompt: { question: '', options: [], detail: '' } }, 'en'), /A&lt;b&gt; is waiting for your answer/);
  const kb = core.needsYouKeyboard('abcdef1234', prompt, 'ru');
  assert.deepEqual(kb.inline_keyboard.map((r) => r[0].callback_data), ['ny:abcdef1234:y', 'ny:abcdef1234:n']);
  assert.equal(kb.inline_keyboard[0][0].text, '✅ Yes');
  assert.equal(core.needsYouKeyboard('abcdef1234', { options: [] }, 'ru').inline_keyboard[0][0].text, '✅ Да');
  // The bot decodes the presses.
  assert.deepEqual(tg.parseCallbackData('ny:abcdef1234:y'), { action: 'prompt', key: 'abcdef1234', choice: 'yes' });
  assert.deepEqual(tg.parseCallbackData('ny:abcdef1234:n'), { action: 'prompt', key: 'abcdef1234', choice: 'no' });
  assert.equal(tg.parseCallbackData('ny:abc:x'), null);
  assert.match(tg.strings('ru').promptSent(true), /«да»/);
});
