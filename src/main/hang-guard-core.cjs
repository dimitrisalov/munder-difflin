'use strict';
/**
 * hang-guard-core.cjs — notices an agent stuck inside ONE tool call and says
 * what to do about it. PURE (no fs, no electron) so `node --test` covers it;
 * index.ts feeds it the hook stream, asks it on a beat, and acts.
 *
 * Seen live 2026-10-28: Phyllis ran a Bash command (curl + ffmpeg on Windows)
 * that never returned. Claude Code's own Bash timeout did not end it, and for
 * 30 minutes she could not read her inbox, so three messages and the training
 * that depended on her stood still until the whole office was restarted. The
 * crash watchdog could not help (nothing crashed) and neither could the circuit
 * breaker (a hung call spends no tokens and repeats nothing).
 *
 * The signal: a PreToolUse with no matching PostToolUse, and no hook event at
 * all from that agent for `hangMinutes` — while its terminal is still drawing
 * (Claude Code animates a spinner and a timer while a tool runs). A quiet
 * terminal with an "open" call means the CLI is idle at its prompt (the owner
 * pressed Esc, which fires no Stop), not hung, so it is left alone. So is an
 * agent waiting on a permission prompt. A subagent's own tool calls arrive
 * under the parent's id, so a long but busy Task call keeps resetting the clock.
 *
 * The ladder, once per hang: interrupt (Esc into the terminal; the agent gets
 * an inbox message saying what happened and how to avoid it, the boss is
 * told) → if the agent still shows no turn ESCALATE_AFTER_MS later, the owner
 * hears about it. Any turn hook from the agent ends the episode.
 */

/** Default minutes of silence inside one tool call before it is interrupted.
 *  Claude Code's Bash tool gives up on its own after 10 minutes at most, so a
 *  call still open after 15 has outlived every timeout that should have ended it. */
const DEFAULT_HANG_MINUTES = 15;
const MAX_HANG_MINUTES = 240;
/** After the interrupt: this long without a turn and the owner is told. */
const ESCALATE_AFTER_MS = 5 * 60_000;
/** The terminal must have drawn something this recently for an open call to
 *  count as running (the tool spinner redraws every second or so). */
const TERMINAL_ALIVE_MS = 2 * 60_000;
/** Open calls remembered per agent (parallel calls, a subagent's calls). */
const MAX_OPEN = 32;

/** Hook events that end every open call: a turn boundary or a new session. */
const RESETS = new Set(['Stop', 'StopFailure', 'UserPromptSubmit', 'SessionStart', 'SessionEnd']);
/** Telemetry riding the hook socket, not a lifecycle boundary: says nothing
 *  about whether a call is still running. */
const IGNORED = new Set(['Status', 'CostSample']);

/** Settings as stored → minutes before a hung call is interrupted (0 = off).
 *  Part of the agent watchdog: switching the watchdog off switches this off. */
function hangMinutes(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.enabled === false) return 0;
  if (r.hangMinutes === undefined || r.hangMinutes === null || r.hangMinutes === '') return DEFAULT_HANG_MINUTES;
  const n = Math.round(Number(r.hangMinutes));
  return Number.isFinite(n) && n >= 0 && n <= MAX_HANG_MINUTES ? n : DEFAULT_HANG_MINUTES;
}

/** A permission / approval prompt (same reading as workerWake's classifyHook). */
function needsHuman(message) {
  const msg = String(message || '').toLowerCase();
  if (!msg || msg.includes('waiting for your input') || msg.includes('is idle') || msg.includes('waiting for input')) return false;
  return msg.includes('permission') || msg.includes('approve') || msg.includes('confirm') || msg.includes('needs your');
}

/** One line saying which call it was: the command, URL, file or task. */
function describeCall(toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  const pick = i.command ?? i.url ?? i.file_path ?? i.path ?? i.notebook_path ?? i.description ?? i.prompt ?? i.query ?? i.pattern ?? '';
  const one = String(pick).replace(/\s+/g, ' ').trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

class HangGuard {
  constructor() {
    /** agentId → { open: [{ tool, detail, since }], lastHookAt, waitingHuman, episode } */
    this.agents = new Map();
  }

  _state(agentId) {
    let s = this.agents.get(agentId);
    if (!s) { s = { open: [], lastHookAt: 0, waitingHuman: false, episode: null }; this.agents.set(agentId, s); }
    return s;
  }

  /**
   * Feed one hook event. Returns the episode that just ended, if this event
   * shows an interrupted agent taking a turn again (for the log), else null.
   */
  note(agentId, event, info = {}, at = Date.now()) {
    if (!agentId || !event || IGNORED.has(event)) return null;
    const s = this._state(agentId);
    s.lastHookAt = at;
    if (event === 'Notification') {
      if (needsHuman(info.message)) s.waitingHuman = true;
      return null;
    }
    s.waitingHuman = false;
    if (event === 'PreToolUse') {
      s.open.push({ tool: String(info.toolName || 'tool'), detail: describeCall(info.toolName, info.toolInput), since: at });
      if (s.open.length > MAX_OPEN) s.open.shift();
    } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const i = s.open.findIndex((c) => c.tool === String(info.toolName || 'tool'));
      s.open.splice(i >= 0 ? i : 0, 1);
    } else if (RESETS.has(event)) {
      s.open = [];
    }
    const ended = s.episode;
    s.episode = null;
    return ended;
  }

  /**
   * What to do this beat. `facts`: [{ agentId, name?, lastOutputAt, skip? }]
   * for live agents (skip = paused or halted by the operator). Returns
   * [{ agentId, name, kind: 'interrupt'|'escalate', tool, detail, minutes }].
   */
  check(facts, now, minutes) {
    const out = [];
    if (!(minutes > 0)) return out;
    const limitMs = minutes * 60_000;
    for (const f of Array.isArray(facts) ? facts : []) {
      const s = this.agents.get(f.agentId);
      if (!s || s.open.length === 0 || s.waitingHuman || f.skip) continue;
      const call = s.open[0];
      const base = { agentId: f.agentId, name: f.name || f.agentId, tool: call.tool, detail: call.detail };
      if (!s.episode) {
        if (now - s.lastHookAt < limitMs) continue;
        // An idle prompt with a call left open (Esc fires no Stop) is not a hang.
        if (!(f.lastOutputAt > 0) || now - f.lastOutputAt > TERMINAL_ALIVE_MS) continue;
        s.episode = { interruptedAt: now, escalated: false, since: s.lastHookAt };
        out.push({ ...base, kind: 'interrupt', minutes: Math.round((now - s.lastHookAt) / 60_000) });
      } else if (!s.episode.escalated && now - s.episode.interruptedAt >= ESCALATE_AFTER_MS) {
        s.episode.escalated = true;
        out.push({ ...base, kind: 'escalate', minutes: Math.round((now - s.episode.since) / 60_000) });
      }
    }
    return out;
  }

  /** The agent's terminal is gone: drop everything known about it. */
  forget(agentId) { this.agents.delete(agentId); }
}

// ─── texts ──────────────────────────────────────────────────────────────────

const callLine = (o) => `${o.tool}${o.detail ? ` (${o.detail})` : ''}`;

/** Inbox message for the agent whose call was interrupted. */
function agentNotice(o) {
  return [
    `Your ${callLine(o)} call ran for ${o.minutes} minutes without returning, so the office's hang guard interrupted it (Esc).`,
    'What to do now:',
    '1. If it started a process that may still be running (a download, a conversion, a server), check and stop it before going on (`tasklist` / `taskkill` on Windows, `ps` / `kill` elsewhere).',
    '2. Do not run it again as it was. Give every download, conversion and network call a time limit (`curl --max-time 120 …`, `timeout 300 <command>`), split a big job into small steps, or run it in the background and check on it.',
    '3. Carry on with your task. If it cannot be done without that call, tell god what blocks you.'
  ].join('\n');
}

/** Inbox message for the boss about someone else's hang. */
function bossNotice(o) {
  return `${o.name}'s ${callLine(o)} call ran for ${o.minutes} minutes without returning; the hang guard interrupted it and told ${o.name} how to go on. Nothing for you to do unless ${o.name} stays silent or asks for help — then check their cards and re-dispatch if needed.`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram HTML for the owner when the interrupt did not bring the agent back. */
function formatHang(o, lang) {
  const name = escapeHtml(o.name || o.agentId || '?');
  const call = `<code>${escapeHtml(o.tool)}</code>${o.detail ? `: <code>${escapeHtml(o.detail)}</code>` : ''}`;
  if (lang === 'en') {
    return `⚠️ <b>${name} is stuck</b>\nOne command has been running for ${o.minutes} min: ${call}\n`
      + 'I pressed Esc and it did not help. Restart this agent in the office (Restart on its card) or restart the office.';
  }
  return `⚠️ <b>${name} завис</b>\nОдна команда идёт уже ${o.minutes} мин: ${call}\n`
    + 'Я нажал Esc, это не помогло. Перезапусти агента в окне офиса (Restart на его карточке) или весь офис.';
}

module.exports = {
  DEFAULT_HANG_MINUTES,
  ESCALATE_AFTER_MS,
  TERMINAL_ALIVE_MS,
  hangMinutes,
  describeCall,
  HangGuard,
  agentNotice,
  bossNotice,
  formatHang
};
