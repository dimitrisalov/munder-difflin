/**
 * VaultHistory — every change to the owner's Obsidian vault, kept.
 *
 * Agents may add and edit any note (the owner's choice, 17.11), so the office
 * snapshots the vault every SNAPSHOT_MS into a git history stored in userData,
 * outside the vault: `git --git-dir <history> --work-tree <vault>`, so no .git
 * ever lands in iCloud. Restoring a note is `git --git-dir … checkout <rev> --
 * <note>`. Decisions and texts: vault-core.cjs.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface VaultCore {
  SNAPSHOT_MS: number;
  EXCLUDES: string[];
  sanitizeVault: (raw: unknown) => { path: string | null; history: boolean };
  isNote: (relPath: string) => boolean;
  summarize: (nameStatus: string) => { total: number; message: string };
  vaultPromptLine: (vaultPath: string) => string;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const vaultCore = require('./vault-core.cjs') as VaultCore;

export interface VaultStatus {
  path: string | null;
  /** The folder is there (iCloud for Windows has synced it). */
  exists: boolean;
  notes: number;
  history: boolean;
  lastSnapshotAt?: number;
  lastChange?: string;
  error?: string;
}

/** Count notes, skipping hidden folders; stops early on a huge tree. */
function countNotes(root: string, limit = 50_000): number {
  let n = 0;
  const walk = (dir: string, rel: string): void => {
    if (n >= limit) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, `${rel}${name}/`);
      else if (vaultCore.isNote(`${rel}${name}`)) n++;
    }
  };
  walk(root, '');
  return n;
}

export class VaultHistory {
  private lastSnapshotAt?: number;
  private lastChange?: string;
  private lastError?: string;
  private running = false;

  constructor(
    private readonly getGitDir: () => string,
    private readonly getConfig: () => unknown
  ) {}

  private get gitDir(): string { return this.getGitDir(); }

  private settings(): { path: string | null; history: boolean } {
    return vaultCore.sanitizeVault(this.getConfig());
  }

  private git(vault: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
    return new Promise((resolve) => {
      execFile('git', [
        '--git-dir', this.gitDir, '--work-tree', vault,
        '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false',
        '-c', 'user.name=Office', '-c', 'user.email=office@localhost',
        ...args
      ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (e, stdout, stderr) => {
        resolve({ ok: !e, out: String(stdout ?? ''), err: String(stderr ?? '') || (e ? e.message : '') });
      });
    });
  }

  status(): VaultStatus {
    const s = this.settings();
    const exists = !!s.path && existsSync(s.path);
    return {
      path: s.path, exists, notes: exists && s.path ? countNotes(s.path) : 0, history: s.history,
      lastSnapshotAt: this.lastSnapshotAt, lastChange: this.lastChange, error: this.lastError
    };
  }

  /** Take one snapshot if anything changed. Never throws. */
  async snapshot(): Promise<{ ok: boolean; changed: number; error?: string }> {
    const s = this.settings();
    if (!s.path || !s.history) return { ok: true, changed: 0 };
    if (!existsSync(s.path)) { this.lastError = 'vault folder not found'; return { ok: false, changed: 0, error: this.lastError }; }
    if (this.running) return { ok: true, changed: 0 };
    this.running = true;
    try {
      if (!existsSync(join(this.gitDir, 'HEAD'))) {
        mkdirSync(this.gitDir, { recursive: true });
        const init = await this.git(s.path, ['init', '-q']);
        if (!init.ok) { this.lastError = `git init: ${init.err.trim()}`; return { ok: false, changed: 0, error: this.lastError }; }
      }
      mkdirSync(join(this.gitDir, 'info'), { recursive: true });
      writeFileSync(join(this.gitDir, 'info', 'exclude'), `${vaultCore.EXCLUDES.join('\n')}\n`);
      const add = await this.git(s.path, ['add', '-A']);
      if (!add.ok) { this.lastError = `git add: ${add.err.trim()}`; return { ok: false, changed: 0, error: this.lastError }; }
      const diff = await this.git(s.path, ['diff', '--cached', '--name-status']);
      const sum = vaultCore.summarize(diff.out);
      this.lastSnapshotAt = Date.now();
      this.lastError = undefined;
      if (sum.total === 0) return { ok: true, changed: 0 };
      const commit = await this.git(s.path, ['commit', '-q', '-m', sum.message]);
      if (!commit.ok) { this.lastError = `git commit: ${commit.err.trim()}`; return { ok: false, changed: 0, error: this.lastError }; }
      this.lastChange = sum.message;
      return { ok: true, changed: sum.total };
    } finally {
      this.running = false;
    }
  }
}
