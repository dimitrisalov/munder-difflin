'use strict';
/**
 * watchdog-core.cjs — the agent watchdog's decisions: is an exit a crash, may
 * the agent be brought back now (and after how long), and what to tell the
 * owner when it may not. PURE (no fs, no electron) so `node --test` covers it;
 * index.ts schedules the revive and the renderer runs it.
 *
 * An agent whose CLI dies (a provider panic, an out-of-memory kill) used to
 * stay dead with "process exited" in its terminal until someone clicked
 * Restart. Now it comes back on its own with --resume, a few times an hour at
 * most, so a crash loop can't burn tokens or hide a real problem.
 */

const DEFAULTS = Object.freeze({
  /** Revives allowed per agent in any rolling hour. */
  maxPerHour: 3,
  /** Wait before the 1st, 2nd, 3rd… revive within that hour. */
  delaysMs: Object.freeze([5_000, 30_000, 120_000]),
});
const HOUR_MS = 60 * 60 * 1000;

/** A crash, as opposed to the agent's own clean exit: a non-zero code, or a
 *  signal (node-pty reports exitCode 0 for a process killed by a signal). */
function isCrash(exitCode, signal) {
  return (typeof signal === 'number' && signal !== 0) || (typeof exitCode === 'number' && exitCode !== 0);
}

/** Settings as stored (or absent) → a sane watchdog config. */
function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const max = Math.round(Number(r.maxPerHour));
  return {
    enabled: r.enabled !== false,
    maxPerHour: Number.isFinite(max) && max >= 0 && max <= 20 ? max : DEFAULTS.maxPerHour,
  };
}

/**
 * May this agent be revived now? `history` is when its earlier revives were
 * scheduled (ms). Returns { revive: true, delayMs, attempt } or
 * { revive: false, reason, recent }.
 */
function decide(history, now, cfg) {
  const c = sanitize(cfg);
  const recent = (Array.isArray(history) ? history : []).filter((t) => typeof t === 'number' && now - t < HOUR_MS);
  if (!c.enabled) return { revive: false, reason: 'off', recent: recent.length };
  if (recent.length >= c.maxPerHour) return { revive: false, reason: 'too-many', recent: recent.length };
  const delays = DEFAULTS.delaysMs;
  return { revive: true, delayMs: delays[Math.min(recent.length, delays.length - 1)], attempt: recent.length + 1 };
}

/** The history to keep: only the last hour matters. */
function prune(history, now) {
  return (Array.isArray(history) ? history : []).filter((t) => typeof t === 'number' && now - t < HOUR_MS);
}

// CSI / OSC escape sequences and lone control characters, as a TUI paints them.
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

/** The last few readable lines a dying process printed, for a message. */
function crashExcerpt(tail, maxChars = 400) {
  const text = String(tail || '').replace(ANSI_RE, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => /[A-Za-zА-Яа-я0-9]/.test(l));
  const picked = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0 && picked.length < 6; i--) {
    const l = lines[i].trim();
    if (size + l.length > maxChars) break;
    picked.unshift(l);
    size += l.length + 1;
  }
  return picked.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram HTML for "agent keeps crashing, not reviving it any more". */
function formatGiveUp(o, lang) {
  const name = escapeHtml(o.name || o.agentId || '?');
  const code = o.signal ? `signal ${o.signal}` : `code ${o.exitCode}`;
  const excerpt = o.excerpt ? `\n\n<pre>${escapeHtml(o.excerpt)}</pre>` : '';
  if (lang === 'en') {
    return `⚠️ <b>${name} keeps crashing</b> (${code}): ${o.recent} restarts in the last hour. `
      + `I am not restarting it again on my own — press Restart in the office when it is fixed.${excerpt}`;
  }
  return `⚠️ <b>${name} падает снова и снова</b> (${code}): за последний час перезапусков — ${o.recent}. `
    + `Сам больше не поднимаю: когда разберёмся, нажми Restart в окне офиса.${excerpt}`;
}

module.exports = { DEFAULTS, isCrash, sanitize, decide, prune, crashExcerpt, formatGiveUp };
