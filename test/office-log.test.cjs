'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../src/main/officeLog-core.cjs');
const loadTs = require('./load-ts.cjs');

const { OfficeLog } = loadTs('src/main/officeLog.ts');

test('secrets are masked, their kind stays readable', () => {
  const m = core.maskSecrets;
  assert.equal(m('bot 1234567890:AAH1bcdefghijklmnopqrstuvwxyz0123456 ready'), 'bot 1234567890:*** ready');
  assert.equal(m('GET https://api.telegram.org/bot1234567890:AAH1bcdefghijklmnopqrstuvwxyz0123456/getUpdates'),
    'GET https://api.telegram.org/bot***/getUpdates');
  assert.equal(m('key sk-ant-api03-abcdefghijklmnop'), 'key sk-ant-***');
  assert.equal(m('openai sk-proj-abcdefghijklmnopqrstuv'), 'openai sk-proj-***');
  assert.equal(m('groq gsk_abcdefghijklmnopqrstuv'), 'groq gsk_***');
  assert.equal(m('gh ghp_abcdefghijklmnopqrstuvwxyz'), 'gh ghp_***');
  assert.equal(m('slack xoxb-1234567890-abcdef'), 'slack xoxb-***');
  assert.equal(m('Authorization: Bearer abc.def.ghi-123'), 'Authorization: Bearer ***');
  assert.equal(m('panel http://100.1.2.3:8091/?token=s3cr3tvalue&x=1'), 'panel http://100.1.2.3:8091/?token=***&x=1');
  assert.equal(m('{"botToken":"abcdefgh123","name":"x"}'), '{"botToken":"***","name":"x"}');
});

test('ordinary office lines are left alone', () => {
  const m = core.maskSecrets;
  for (const line of [
    '[telegram] polling started',
    'tokenVelocityPerMin: 200000',
    'session 5f2b1c9e-0d1a-4c55-9a8e-1b2c3d4e5f60 resumed',
    'commit 6bc6d4d07e187461bb8181237f5f817c7cbafadf',
    'at 12:34:56 the breaker reset',
    '"tokens": 1234'
  ]) assert.equal(m(line), line);
});

test('one file per local day', () => {
  assert.equal(core.logFileName(new Date(2026, 9, 7, 23, 59)), 'office-2026-10-07.log');
  assert.equal(core.dayOfLogFile('office-2026-10-07.log').getDate(), 7);
  assert.equal(core.dayOfLogFile('notes.txt'), null);
  assert.equal(core.dayOfLogFile('office-latest.log'), null);
});

test('only our own files older than the kept days are pruned', () => {
  const now = new Date(2026, 9, 27, 10, 0);
  const names = [
    'office-2026-10-27.log', 'office-2026-10-21.log', 'office-2026-10-20.log',
    'office-2026-09-30.log', 'crash.dmp', 'office-2026-10-19.log.bak'
  ];
  assert.deepEqual(core.filesToPrune(names, now, 7), ['office-2026-09-30.log', 'office-2026-10-20.log']);
  assert.deepEqual(core.filesToPrune(names, now, 1),
    ['office-2026-09-30.log', 'office-2026-10-20.log', 'office-2026-10-21.log']);
});

test('lines carry time and level, keep multi-line entries together, and are cut when huge', () => {
  const at = new Date(Date.UTC(2026, 9, 27, 13, 5, 1, 123));
  assert.equal(core.formatLine('warn', 'first\nsecond\n', at), '2026-10-27T13:05:01.123Z [warn] first\n    second\n');
  assert.equal(core.formatLine('nonsense', 'x', at, 'window'), '2026-10-27T13:05:01.123Z [info] (window) x\n');
  const long = core.formatLine('info', 'a'.repeat(core.MAX_LINE_CHARS + 10), at);
  assert.match(long, /… \[cut 10 chars\]\n$/);
});

test('renderer levels: only warnings and errors are kept', () => {
  assert.equal(core.rendererLevel(2), 'warn');
  assert.equal(core.rendererLevel('error'), 'error');
  assert.equal(core.rendererLevel(1), null);
  assert.equal(core.rendererLevel('info'), null);
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-log-'));
}

test('the log mirrors the console into today\'s file, masked', () => {
  const dir = path.join(tmpDir(), 'logs');
  const log = new OfficeLog(dir);
  const printed = [];
  const fake = { log: (...a) => printed.push(a), info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  log.captureConsole(fake);
  fake.log('[telegram] token %s set', '1234567890:AAH1bcdefghijklmnopqrstuvwxyz0123456');
  fake.error(new Error('boom'));
  assert.equal(printed.length, 1, 'the original console still prints');
  const text = fs.readFileSync(log.currentFile, 'utf8');
  assert.match(text, /\[info\] \[telegram\] token 1234567890:\*\*\* set/);
  assert.match(text, /\[error\] Error: boom\n {4,}at /);
  assert.ok(!text.includes('AAH1bcdef'));
});

test('a day\'s file stops growing at its cap with one notice', () => {
  const log = new OfficeLog(tmpDir(), { maxBytesPerDay: 300 });
  for (let i = 0; i < 50; i++) log.write('info', `line ${i} ${'x'.repeat(20)}`);
  const text = fs.readFileSync(log.currentFile, 'utf8');
  assert.equal((text.match(/nothing more is written today/g) || []).length, 1);
  assert.ok(Buffer.byteLength(text) < 500);
});

test('old files are pruned when the day\'s file opens', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'office-2000-01-01.log'), 'old');
  fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'mine');
  new OfficeLog(dir).write('info', 'hello');
  assert.ok(!fs.existsSync(path.join(dir, 'office-2000-01-01.log')));
  assert.ok(fs.existsSync(path.join(dir, 'keep-me.txt')));
});

test('an unwritable folder never throws', () => {
  const file = path.join(tmpDir(), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const log = new OfficeLog(path.join(file, 'logs'));
  assert.doesNotThrow(() => { log.write('error', 'a'); log.write('error', 'b'); });
});
