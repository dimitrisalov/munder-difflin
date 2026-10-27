/**
 * Office backups — the I/O half. Copies the hive and the floor roster into
 * <harnessHome>/backups/<name>/, lists and prunes them, and restores one. Every
 * decision (names, what goes in, when, what is pruned) is in backups-core.cjs.
 * No electron import: the caller supplies the home folder and relaunches.
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync
} from 'node:fs';
import { join, relative, sep } from 'node:path';

interface BackupsCore {
  backupName: (date: Date, reason: string) => string;
  parseBackupName: (name: string) => { at: Date; reason: string } | null;
  includeInBackup: (relPath: string, sizeBytes?: number) => boolean;
  dueReason: (newestAt: Date | null, now: Date, startingUp: boolean) => string | null;
  backupsToPrune: (names: string[], now: Date) => string[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const backupsCore = require('./backups-core.cjs') as BackupsCore;

export type BackupReason = 'start' | 'daily' | 'manual' | 'before-restore';

export interface BackupInfo {
  id: string;
  at: string;
  reason: string;
  files: number;
  bytes: number;
}

interface Manifest { version: 1; at: string; reason: string; files: number; bytes: number; skipped: number }

/** Top-level things a backup carries, relative to the harness home. */
const ROOTS = ['hive', 'roster.json'] as const;

export class OfficeBackups {
  constructor(private readonly home: () => string | null) {}

  private dir(): string | null {
    const h = this.home();
    return h ? join(h, 'backups') : null;
  }

  /** Our backups, newest first. */
  list(): BackupInfo[] {
    const dir = this.dir();
    if (!dir || !existsSync(dir)) return [];
    const out: BackupInfo[] = [];
    for (const name of readdirSync(dir)) {
      const info = backupsCore.parseBackupName(name);
      if (!info) continue;
      let m: Partial<Manifest> = {};
      try { m = JSON.parse(readFileSync(join(dir, name, 'manifest.json'), 'utf8')) as Manifest; } catch { /* manifest-less: still listed */ }
      out.push({ id: name, at: info.at.toISOString(), reason: info.reason, files: m.files ?? 0, bytes: m.bytes ?? 0 });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /** Take a backup if one is due (see dueReason); returns it, or null. */
  runIfDue(startingUp: boolean, now = new Date()): BackupInfo | null {
    const newest = this.list()[0];
    const reason = backupsCore.dueReason(newest ? new Date(newest.at) : null, now, startingUp);
    return reason ? this.create(reason as BackupReason, now) : null;
  }

  /** Copy the hive and roster into a new backup folder. Written under a
   *  `.partial` name and renamed at the end, so a crash mid-copy never leaves
   *  something that looks like a finished backup. */
  create(reason: BackupReason, now = new Date()): BackupInfo | null {
    const home = this.home();
    const dir = this.dir();
    if (!home || !dir || !existsSync(join(home, 'hive'))) return null;
    const name = backupsCore.backupName(now, reason);
    const target = join(dir, name);
    const partial = `${target}.partial`;
    mkdirSync(partial, { recursive: true });
    let files = 0;
    let bytes = 0;
    let skipped = 0;
    const copyTree = (src: string, dst: string, base: string): void => {
      let st;
      try { st = statSync(src); } catch { return; }
      const rel = relative(base, src).split(sep).join('/');
      if (st.isDirectory()) {
        if (rel && !backupsCore.includeInBackup(`${rel}/x`)) { skipped++; return; }
        for (const entry of readdirSync(src)) copyTree(join(src, entry), join(dst, entry), base);
        return;
      }
      if (!st.isFile()) return;
      if (!backupsCore.includeInBackup(rel, st.size)) { skipped++; return; }
      try {
        mkdirSync(join(dst, '..'), { recursive: true });
        copyFileSync(src, dst);
        files++;
        bytes += st.size;
      } catch { skipped++; /* locked or vanished mid-copy */ }
    };
    for (const root of ROOTS) copyTree(join(home, root), join(partial, root), home);
    const manifest: Manifest = { version: 1, at: now.toISOString(), reason, files, bytes, skipped };
    writeFileSync(join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2));
    renameSync(partial, target);
    this.prune(now);
    return { id: name, at: manifest.at, reason, files, bytes };
  }

  /** Delete backups past the retention rules, and stale `.partial` folders. */
  prune(now = new Date()): void {
    const dir = this.dir();
    if (!dir || !existsSync(dir)) return;
    const names = readdirSync(dir);
    for (const name of backupsCore.backupsToPrune(names, now)) {
      try { rmSync(join(dir, name), { recursive: true, force: true }); } catch { /* in use */ }
    }
    for (const name of names) {
      if (name.endsWith('.partial') && backupsCore.parseBackupName(name.slice(0, -'.partial'.length))) {
        try { rmSync(join(dir, name), { recursive: true, force: true }); } catch { /* in use */ }
      }
    }
  }

  /** Put a backup's files back over the live hive and roster. A
   *  'before-restore' backup is taken first, so this can be undone. Files that
   *  are newer than the backup and absent from it are left alone. The caller
   *  must stop the agents first and relaunch after. */
  restore(id: string, now = new Date()): { ok: true; undo: string | null } | { ok: false; error: string } {
    const home = this.home();
    const dir = this.dir();
    if (!home || !dir) return { ok: false, error: 'no office folder' };
    if (!backupsCore.parseBackupName(id)) return { ok: false, error: 'not a backup' };
    const src = join(dir, id);
    if (!existsSync(join(src, 'manifest.json'))) return { ok: false, error: 'backup not found' };
    const undo = this.create('before-restore', now);
    const copyBack = (from: string, to: string): void => {
      let st;
      try { st = statSync(from); } catch { return; }
      if (st.isDirectory()) {
        for (const entry of readdirSync(from)) copyBack(join(from, entry), join(to, entry));
        return;
      }
      mkdirSync(join(to, '..'), { recursive: true });
      copyFileSync(from, to);
    };
    try {
      for (const root of ROOTS) copyBack(join(src, root), join(home, root));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, undo: undo?.id ?? null };
  }
}
