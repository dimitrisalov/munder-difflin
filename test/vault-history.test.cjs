// VaultHistory (vault.ts) with real git: snapshots of the vault into a history
// kept outside it, nothing written into the vault, Obsidian's window state left
// out, a note restorable from the history.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const { VaultHistory } = loadTs('src/main/vault.ts');

const hasGit = (() => { try { execFileSync('git', ['--version']); return true; } catch { return false; } })();

test('snapshots the vault into a history outside it', { skip: !hasGit && 'git not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'));
  try {
    const vault = join(dir, 'Мой vault');
    mkdirSync(join(vault, 'Grok'), { recursive: true });
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    writeFileSync(join(vault, 'Grok', 'Рынок.md'), '# Рынок\n');
    writeFileSync(join(vault, '.obsidian', 'app.json'), '{}');
    writeFileSync(join(vault, '.obsidian', 'workspace.json'), '{"open":1}');
    const gitDir = join(dir, 'history.git');
    let cfg = { path: vault };
    const h = new VaultHistory(() => gitDir, () => cfg);

    const st = h.status();
    assert.equal(st.exists, true);
    assert.equal(st.notes, 1);

    const first = await h.snapshot();
    assert.deepEqual([first.ok, first.changed], [true, 2], first.error);
    assert.deepEqual(readdirSync(vault).sort(), ['.obsidian', 'Grok'], 'nothing written into the vault');

    assert.equal((await h.snapshot()).changed, 0, 'no change, no commit');

    writeFileSync(join(vault, 'Grok', 'Рынок.md'), '# Рынок\nагент дописал\n');
    writeFileSync(join(vault, '.obsidian', 'workspace.json'), '{"open":2}');
    const second = await h.snapshot();
    assert.equal(second.changed, 1, 'window state is not history');
    assert.equal(h.status().lastChange, 'vault: +0 ~1 -0 — Рынок');

    const git = (...a) => execFileSync('git', ['--git-dir', gitDir, '--work-tree', vault, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' });
    assert.equal(git('log', '--oneline').trim().split('\n').length, 2);
    git('checkout', 'HEAD~1', '--', 'Grok/Рынок.md');
    assert.equal(require('node:fs').readFileSync(join(vault, 'Grok', 'Рынок.md'), 'utf8'), '# Рынок\n', 'restored');

    cfg = { path: vault, history: false };
    writeFileSync(join(vault, 'new.md'), 'x');
    assert.equal((await h.snapshot()).changed, 0, 'history off');
    cfg = { path: join(dir, 'gone') };
    const missing = await h.snapshot();
    assert.equal(missing.ok, false);
    assert.equal(existsSync(join(dir, 'gone')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
