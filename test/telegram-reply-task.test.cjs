// The reply helper opens a conversation's card through the loopback endpoint
// (--new-task), without the bot token and without sending anything to the chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { TelegramReplyServer } = loadTs('src/main/telegram.ts');
const HELPER = join(__dirname, '..', 'resources', 'md-telegram-reply.cjs');

function run(args, cfg) {
  return new Promise((resolve) => {
    execFile(process.execPath, [HELPER, ...args, '--config', cfg], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('--new-task opens the card for a conversation and prints its key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-reply-'));
  const calls = [];
  const server = new TelegramReplyServer({
    token: 'secret-token',
    getBotToken: () => 'bot-token',
    getOwnerChatId: () => 42,
    onNewTask: (o) => { calls.push(o); return { ok: true, taskId: 'telegram-abc123', key: 'OF-14' }; }
  });
  const r = await server.start();
  try {
    const cfg = join(dir, 'telegram-reply.json');
    writeFileSync(cfg, JSON.stringify({ port: r.port, token: 'secret-token' }));
    const ok = await run(['--new-task', 'Pitch deck for the office', '--conv', 'conv-ab12cd34', '--reply-to', '77', '--description', 'Ten slides, Russian.'], cfg);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /Card OF-14 opened \(id telegram-abc123\)/);
    assert.deepEqual(calls, [{ title: 'Pitch deck for the office', description: 'Ten slides, Russian.', conv: 'conv-ab12cd34', replyTo: 77 }]);

    const noConv = await run(['--new-task', 'X'], cfg);
    assert.notEqual(noConv.code, 0);
    assert.match(noConv.stderr, /--conv/);
    const badConv = await run(['--new-task', 'X', '--conv', 'nope'], cfg);
    assert.notEqual(badConv.code, 0);
    assert.match(badConv.stderr, /conversation id/);
    assert.equal(calls.length, 1, 'nothing opened for bad calls');

    const wrongToken = join(dir, 'bad.json');
    writeFileSync(wrongToken, JSON.stringify({ port: r.port, token: 'nope-nope-no' }));
    const denied = await run(['--new-task', 'X', '--conv', 'conv-ab12cd34'], wrongToken);
    assert.notEqual(denied.code, 0);
  } finally {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
