'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../src/main/backups-core.cjs');
const loadTs = require('./load-ts.cjs');

const { OfficeBackups } = loadTs('src/main/backups.ts');

test('names: local time to the second, reason last, round-trip', () => {
  const at = new Date(2026, 9, 27, 9, 5, 7);
  assert.equal(core.backupName(at, 'daily'), '2026-10-27_090507-daily');
  assert.equal(core.backupName(at, 'bogus'), '2026-10-27_090507-manual');
  const p = core.parseBackupName('2026-10-27_090507-before-restore');
  assert.equal(p.reason, 'before-restore');
  assert.equal(p.at.getTime(), at.getTime());
});

test('only our own names parse, so a restore cannot name another path', () => {
  for (const bad of ['..', '../hive', '2026-10-27_090507-daily/../../x', '2026-10-27-daily', 'C:\\Windows', '']) {
    assert.equal(core.parseBackupName(bad), null, bad);
  }
});

test('what goes in: the hive and roster, not git, deps, backups, locks or huge files', () => {
  assert.ok(core.includeInBackup('hive/tasks.json', 10));
  assert.ok(core.includeInBackup('hive/agents/god/memory.md', 10));
  assert.ok(core.includeInBackup('roster.json', 10));
  assert.ok(!core.includeInBackup('hive/.git/objects/ab/cd', 10));
  assert.ok(!core.includeInBackup('hive/agents/x/node_modules/a.js', 10));
  assert.ok(!core.includeInBackup('hive/backups/2026/god/memory.md', 10));
  assert.ok(!core.includeInBackup('backups/2026-10-27_090507-daily/hive/tasks.json', 10));
  assert.ok(!core.includeInBackup('hive/index.lock', 10));
  assert.ok(!core.includeInBackup('hive/hook.sock', 10));
  assert.ok(!core.includeInBackup('hive/big.bin', core.MAX_FILE_BYTES + 1));
});

test('when one is due', () => {
  const now = new Date(2026, 9, 27, 12, 0);
  const ago = (ms) => new Date(now - ms);
  assert.equal(core.dueReason(null, now, true), 'start');
  assert.equal(core.dueReason(null, now, false), 'daily');
  assert.equal(core.dueReason(ago(10 * 60e3), now, true), null, 'restarted ten minutes after the last one');
  assert.equal(core.dueReason(ago(2 * 3600e3), now, true), 'start');
  assert.equal(core.dueReason(ago(2 * 3600e3), now, false), null);
  assert.equal(core.dueReason(ago(25 * 3600e3), now, false), 'daily');
  assert.equal(core.dueReason(ago(25 * 3600e3), now, true), 'daily');
});

test('retention: last two days whole, then one a day for two weeks, never fewer than three', () => {
  const now = new Date(2026, 9, 27, 12, 0);
  const at = (d, h) => core.backupName(new Date(2026, 9, d, h, 0, 0), 'start');
  const names = [
    at(27, 9), at(27, 8), at(26, 20), at(25, 20), // within 48 h
    at(24, 18), at(24, 9),                        // same day: newest kept
    at(14, 10),                                   // 13 days ago: kept
    at(13, 10), at(1, 10),                        // older than 14 days
    'notes', 'restore-me',                        // not ours
  ];
  assert.deepEqual(core.backupsToPrune(names, now), [at(1, 10), at(13, 10), at(24, 9)]);
  // Very old backups are still kept when they are all there is.
  const old = [at(1, 10), at(2, 10), at(3, 10), at(4, 10)];
  assert.deepEqual(core.backupsToPrune(old, now), [at(1, 10)]);
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-backups-'));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), text); };
  w('hive/tasks.json', '{"tasks":[1]}');
  w('hive/board.md', 'board v1');
  w('hive/agents/god/memory.md', 'memory v1');
  w('hive/.git/HEAD', 'ref: refs/heads/main');
  w('hive/backups/x/god/memory.md', 'reflect copy');
  w('roster.json', '{"agents":["god"]}');
  return { home, w };
}

test('a backup copies the hive and roster, leaves git and reflect copies out, lists newest first', () => {
  const { home } = makeHome();
  const b = new OfficeBackups(() => home);
  const first = b.create('manual', new Date(2026, 9, 27, 10, 0, 0));
  const second = b.create('daily', new Date(2026, 9, 27, 11, 0, 0));
  assert.equal(first.files, 4);
  const dir = path.join(home, 'backups', first.id);
  assert.equal(fs.readFileSync(path.join(dir, 'hive/agents/god/memory.md'), 'utf8'), 'memory v1');
  assert.ok(fs.existsSync(path.join(dir, 'roster.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'hive/.git')));
  assert.ok(!fs.existsSync(path.join(dir, 'hive/backups')));
  assert.deepEqual(b.list().map((x) => x.id), [second.id, first.id]);
  assert.equal(b.list()[1].files, 4);
});

test('runIfDue honours the gaps', () => {
  const { home } = makeHome();
  const b = new OfficeBackups(() => home);
  const t0 = new Date(2026, 9, 27, 10, 0, 0);
  assert.equal(b.runIfDue(true, t0).reason, 'start');
  assert.equal(b.runIfDue(true, new Date(t0.getTime() + 5 * 60e3)), null);
  assert.equal(b.runIfDue(false, new Date(t0.getTime() + 25 * 3600e3)).reason, 'daily');
});

test('restore puts the files back, keeps newer extra files, and can be undone', () => {
  const { home, w } = makeHome();
  const b = new OfficeBackups(() => home);
  const snap = b.create('manual', new Date(2026, 9, 27, 10, 0, 0));
  w('hive/agents/god/memory.md', 'memory v2 (broken)');
  w('hive/agents/god/inbox/new.json', '{}');
  const r = b.restore(snap.id, new Date(2026, 9, 27, 10, 30, 0));
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(home, 'hive/agents/god/memory.md'), 'utf8'), 'memory v1');
  assert.ok(fs.existsSync(path.join(home, 'hive/agents/god/inbox/new.json')));
  const undo = path.join(home, 'backups', r.undo, 'hive/agents/god/memory.md');
  assert.equal(fs.readFileSync(undo, 'utf8'), 'memory v2 (broken)');
});

test('restore refuses anything that is not one of our backups', () => {
  const { home } = makeHome();
  const b = new OfficeBackups(() => home);
  assert.deepEqual(b.restore('../hive'), { ok: false, error: 'not a backup' });
  assert.deepEqual(b.restore('2026-10-27_100000-manual'), { ok: false, error: 'backup not found' });
});

test('no office folder yet: nothing happens', () => {
  const b = new OfficeBackups(() => null);
  assert.deepEqual(b.list(), []);
  assert.equal(b.create('manual'), null);
  assert.equal(b.runIfDue(true), null);
});
