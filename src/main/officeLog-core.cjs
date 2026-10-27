'use strict';
/**
 * officeLog-core.cjs — the decisions behind the office log file: which file a
 * line goes to, what it looks like, what secrets are masked out of it, and
 * which old files are pruned. PURE (no fs, no electron) so `node --test` covers
 * it; officeLog.ts does the I/O.
 *
 * The office used to log only to stdout. Started from a shortcut (or anything
 * without a terminal), that went nowhere, so a silent Telegram bot or a stuck
 * agent left no trace to read afterwards.
 */

const FILE_PREFIX = 'office-';
const FILE_SUFFIX = '.log';
/** Days of log files kept, today included. */
const DEFAULT_KEEP_DAYS = 7;
/** A day's file stops growing past this — a logging loop must not fill the disk. */
const DEFAULT_MAX_BYTES_PER_DAY = 20 * 1024 * 1024;
/** One line longer than this is cut (a dumped payload, a huge stack). */
const MAX_LINE_CHARS = 8000;

const MASK = '***';

// Each rule keeps the recognisable head and masks the secret part. Order
// matters only where patterns overlap (sk-ant- before the generic sk-).
const SECRET_RULES = [
  // Telegram bot token: <bot id>:<35 chars>.
  [/\b(\d{6,12}):[A-Za-z0-9_-]{30,}/g, `$1:${MASK}`],
  // Telegram API URLs carry the token in the path: /bot<token>/method.
  [/(\/bot)\d{6,12}:[A-Za-z0-9_-]+/g, `$1${MASK}`],
  [/\b(sk-ant-)[A-Za-z0-9_-]{8,}/g, `$1${MASK}`],
  [/\b(sk-(?:proj-)?)[A-Za-z0-9_-]{16,}/g, `$1${MASK}`],
  [/\b(gsk_)[A-Za-z0-9]{16,}/g, `$1${MASK}`],
  [/\b(gh[pousr]_)[A-Za-z0-9]{20,}/g, `$1${MASK}`],
  [/\b(github_pat_)[A-Za-z0-9_]{20,}/g, `$1${MASK}`],
  [/\b(xox[abprs]-)[A-Za-z0-9-]{10,}/g, `$1${MASK}`],
  [/\b(hf_)[A-Za-z0-9]{20,}/g, `$1${MASK}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`],
  // Tokens passed in a URL query (the mobile panel link, webhooks).
  [/([?&](?:token|key|api_key|apikey|access_token|secret)=)[^&\s"']+/gi, `$1${MASK}`],
  // "token": "…" / apiKey: '…' in dumped objects.
  [/((?:"|')?(?:token|botToken|apiKey|api_key|secret|password|authorization)(?:"|')?\s*[:=]\s*(?:"|'))[^"'\s]{6,}((?:"|'))/gi, `$1${MASK}$2`],
];

/** Mask anything that looks like a credential. */
function maskSecrets(text) {
  let out = String(text);
  for (const [re, repl] of SECRET_RULES) out = out.replace(re, repl);
  return out;
}

function pad(n) { return n < 10 ? `0${n}` : String(n); }

/** Local calendar day of `date` as YYYY-MM-DD — one file per local day. */
function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function logFileName(date) {
  return `${FILE_PREFIX}${dayKey(date)}${FILE_SUFFIX}`;
}

/** The day a log file belongs to, or null for any other file in the folder. */
function dayOfLogFile(name) {
  const m = /^office-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Log files older than `keepDays` (today counts as one), oldest first. Only
 *  our own `office-YYYY-MM-DD.log` names are ever returned. */
function filesToPrune(names, now, keepDays = DEFAULT_KEEP_DAYS) {
  const keep = Math.max(1, Math.floor(keepDays));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keep - 1));
  return names
    .map((name) => ({ name, day: dayOfLogFile(name) }))
    .filter((f) => f.day && f.day < cutoff)
    .sort((a, b) => a.day - b.day)
    .map((f) => f.name);
}

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/** One log line: ISO time, level, an optional source, the masked message. */
function formatLine(level, message, date, source) {
  const lvl = LEVELS.has(level) ? level : 'info';
  let msg = maskSecrets(message).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (msg.length > MAX_LINE_CHARS) msg = `${msg.slice(0, MAX_LINE_CHARS)}… [cut ${msg.length - MAX_LINE_CHARS} chars]`;
  // Continuation lines are indented so one entry stays visually one entry.
  msg = msg.replace(/\n/g, '\n    ');
  return `${date.toISOString()} [${lvl}]${source ? ` (${source})` : ''} ${msg}\n`;
}

/** Map an Electron renderer console level (0 verbose … 3 error, or the newer
 *  string names) to ours; null for levels not worth keeping. */
function rendererLevel(level) {
  if (level === 2 || level === 'warning') return 'warn';
  if (level === 3 || level === 'error') return 'error';
  return null;
}

module.exports = {
  DEFAULT_KEEP_DAYS,
  DEFAULT_MAX_BYTES_PER_DAY,
  MAX_LINE_CHARS,
  maskSecrets,
  dayKey,
  logFileName,
  dayOfLogFile,
  filesToPrune,
  formatLine,
  rendererLevel,
};
