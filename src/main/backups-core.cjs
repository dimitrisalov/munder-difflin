'use strict';
/**
 * backups-core.cjs — the decisions behind office backups: what a backup is
 * called, which files go in, when one is due, and which old ones are pruned.
 * PURE (no fs, no electron) so `node --test` covers it; backups.ts copies.
 *
 * A backup is a plain folder under <harnessHome>/backups/<name>/ holding the
 * hive (agents' memory, tasks, tickets, board, registry, messages) and the
 * floor roster — everything the office needs to pick up where it was. The
 * hive's own git history lives in the same folder as the hive, so it does not
 * survive the folder being lost or mangled; a copy elsewhere does.
 */

/** Why a backup was made. 'before-restore' is taken automatically so a
 *  restore can itself be undone. */
const REASONS = ['start', 'daily', 'manual', 'before-restore'];
/** Every backup from this many hours is kept as is. */
const KEEP_ALL_HOURS = 48;
/** After that, the newest backup of each day is kept for this many days. */
const KEEP_DAYS = 14;
/** Never prune below this many backups, however old they are. */
const MIN_KEEP = 3;
/** A single file bigger than this is left out (a stray dump, a model file). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** A new 'start' backup is skipped when the newest one is younger than this. */
const START_MIN_GAP_MS = 60 * 60 * 1000;
/** A 'daily' backup is due when the newest one is older than this. */
const DAILY_GAP_MS = 24 * 60 * 60 * 1000;

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-(start|daily|manual|before-restore)$/;

function pad(n) { return n < 10 ? `0${n}` : String(n); }

/** Folder name for a backup taken at `date` (local time) for `reason`. Second
 *  precision keeps two quick manual backups apart. */
function backupName(date, reason) {
  const r = REASONS.includes(reason) ? reason : 'manual';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${r}`;
}

/** { at, reason } for one of our backup folders, null for anything else —
 *  which is also what keeps a restore request from naming an arbitrary path. */
function parseBackupName(name) {
  const m = NAME_RE.exec(String(name));
  if (!m) return null;
  const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (Number.isNaN(at.getTime())) return null;
  return { at, reason: m[7] };
}

/** Is a file (path relative to the harness home, '/'-separated) part of a
 *  backup? Leaves out git internals, dependency folders, backups themselves
 *  (ours, and the memory snapshots reflect.ts keeps in hive/backups), locks
 *  and sockets, and oversized files. */
function includeInBackup(relPath, sizeBytes) {
  const parts = String(relPath).split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((p) => p === '.git' || p === 'node_modules')) return false;
  if (parts[0] === 'backups' || (parts[0] === 'hive' && parts[1] === 'backups')) return false;
  const leaf = parts[parts.length - 1];
  if (/\.(lock|sock|tmp)$/i.test(leaf)) return false;
  if (typeof sizeBytes === 'number' && sizeBytes > MAX_FILE_BYTES) return false;
  return true;
}

/** Which reason, if any, calls for a backup now, given the newest one's time. */
function dueReason(newestAt, now, startingUp) {
  if (!newestAt) return startingUp ? 'start' : 'daily';
  const age = now - newestAt;
  if (age >= DAILY_GAP_MS) return 'daily';
  if (startingUp && age >= START_MIN_GAP_MS) return 'start';
  return null;
}

/** Backup folders to delete: everything from the last KEEP_ALL_HOURS stays,
 *  then the newest of each day for KEEP_DAYS, never fewer than MIN_KEEP in all.
 *  Names that are not ours are never returned. */
function backupsToPrune(names, now) {
  const items = names
    .map((name) => ({ name, info: parseBackupName(name) }))
    .filter((x) => x.info)
    .sort((a, b) => b.info.at - a.info.at); // newest first
  const keep = new Set();
  const daysSeen = new Set();
  const dayCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (KEEP_DAYS - 1));
  for (const { name, info } of items) {
    if (now - info.at <= KEEP_ALL_HOURS * 3600 * 1000) { keep.add(name); continue; }
    if (info.at < dayCutoff) continue;
    const day = `${info.at.getFullYear()}-${info.at.getMonth()}-${info.at.getDate()}`;
    if (!daysSeen.has(day)) { daysSeen.add(day); keep.add(name); }
  }
  for (const { name } of items.slice(0, MIN_KEEP)) keep.add(name);
  return items.filter((x) => !keep.has(x.name)).map((x) => x.name).reverse();
}

module.exports = {
  REASONS,
  KEEP_DAYS,
  MIN_KEEP,
  MAX_FILE_BYTES,
  START_MIN_GAP_MS,
  DAILY_GAP_MS,
  backupName,
  parseBackupName,
  includeInBackup,
  dueReason,
  backupsToPrune,
};
