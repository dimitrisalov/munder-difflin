// The folders the boss reads without a permission prompt (boss-dirs-core.cjs):
// on the PC (29.10) Mia's work in D:\AI\work\design and her folder
// D:\AI\office\studio were missing, so Theo stopped on a read prompt again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bossReadDirs } = require('../src/main/boss-dirs-core.cjs');

test("the agents' folders and the folders that hold them, archived agents too", () => {
  const dirs = bossReadDirs({
    platform: 'linux',
    home: '/home/user',
    ownCwd: '/ai/floor',
    registeredRepos: ['/ai/work/research'],
    agents: [
      { cwd: '/ai/floor', isGod: true },
      { cwd: '/ai/work/research' },
      { cwd: '/ai/work/content' },
      { cwd: '/ai/office/studio' }, // archived at the boss's start: still counted
    ],
  });
  assert.deepEqual(dirs.sort(), ['/ai/office', '/ai/work']);
});

test('never a drive root, the home folder or above it, or the folder above the boss', () => {
  const dirs = bossReadDirs({
    platform: 'linux',
    home: '/home/user',
    ownCwd: '/srv/floor',
    agents: [
      { cwd: '/project' },          // parent is the root
      { cwd: '/home/user/app' },    // parent is home
      { cwd: '/srv/research' },     // parent holds the boss's own folder
    ],
  });
  assert.deepEqual(dirs.sort(), ['/home/user/app', '/project', '/srv/research']);
});

test('Windows: case-insensitive, the boss own folder dropped', () => {
  const dirs = bossReadDirs({
    platform: 'win32',
    home: 'C:\\Users\\User',
    ownCwd: 'D:\\AI\\floor',
    registeredRepos: ['D:\\AI\\Floor'],
    agents: [{ cwd: 'D:\\AI\\work\\design' }],
  });
  if (process.platform === 'win32') {
    assert.deepEqual(dirs, ['D:\\AI\\work']);
  } else {
    // On POSIX the backslash paths are single relative names; only check that
    // the boss's own folder is never listed.
    assert.ok(!dirs.some((d) => d.toLowerCase().endsWith('d:\\ai\\floor')));
  }
});
